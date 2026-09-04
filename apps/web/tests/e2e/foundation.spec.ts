import AxeBuilder from "@axe-core/playwright";
import {
  type Browser,
  type BrowserContext,
  chromium,
  expect,
  type Locator,
  type Page,
  test,
} from "@playwright/test";

let browser: Browser;
let context: BrowserContext;
let page: Page;
let ownsBrowser = false;
const baseUrl = process.env.E2E_APP_ORIGIN ?? "http://localhost:3000";
let csrfToken: string | undefined;
let liveAlbum:
  | {
      readonly id: string;
      readonly slug: string;
      readonly title: string;
      readonly password: string;
    }
  | undefined;

function appUrl(path: string): string {
  return new URL(path, baseUrl).href;
}

test.beforeAll(async () => {
  const cdpUrl = process.env.BROWSER_CDP_URL;
  if (cdpUrl === undefined) {
    browser = await chromium.launch();
    ownsBrowser = true;
  } else {
    browser = await chromium.connectOverCDP(cdpUrl);
  }
  context = await browser.newContext();
  page = await context.newPage();
  const username = process.env.E2E_USERNAME;
  const password = process.env.E2E_PASSWORD;
  if (username !== undefined && password !== undefined) {
    const login = await context.request.post(appUrl("/api/v1/auth/login"), {
      data: { username, password },
      headers: { origin: baseUrl },
    });
    expect(login.status()).toBe(200);
    csrfToken = ((await login.json()) as { csrfToken: string }).csrfToken;
  }
});

test.afterAll(async () => {
  await page.close();
  await context.close();
  if (ownsBrowser) {
    await browser.close();
  }
});

async function expectNoAxeViolations(currentPage: Page): Promise<void> {
  const results = await new AxeBuilder({ page: currentPage })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

async function expectReactHydrated(locator: Locator): Promise<void> {
  await expect
    .poll(async () =>
      locator.evaluate((element) =>
        Object.keys(element).some((key) => key.startsWith("__reactProps$")),
      ),
    )
    .toBe(true);
}

async function ensureLiveAlbum() {
  if (liveAlbum !== undefined) return liveAlbum;
  if (csrfToken === undefined) {
    throw new Error("E2E test account is not configured");
  }
  const title = `壳层验收 ${Date.now()}`;
  const created = await context.request.post(appUrl("/api/v1/albums"), {
    data: { title, description: "非人物自动化夹具", publishMode: "review" },
    headers: {
      origin: baseUrl,
      "x-csrf-token": csrfToken,
      "idempotency-key": crypto.randomUUID(),
    },
  });
  expect(created.status()).toBe(201);
  const result = (await created.json()) as {
    album: { id: string; slug: string; title: string };
    generatedPassword: string;
  };
  const started = await context.request.post(appUrl(`/api/v1/albums/${result.album.id}/start`), {
    headers: { origin: baseUrl, "x-csrf-token": csrfToken },
  });
  expect(started.status()).toBe(200);
  liveAlbum = {
    id: result.album.id,
    slug: result.album.slug,
    title: result.album.title,
    password: result.generatedPassword,
  };
  return liveAlbum;
}

test("Tailwind compatibility surface renders semantic tokens without accessibility errors", async () => {
  await page.goto(appUrl("/compatibility"));
  await expect(page.getByRole("heading", { level: 1, name: "中学部影像直播" })).toBeVisible();
  await expect(page.locator("[data-compat-media]")).toHaveCount(12);
  await expectNoAxeViolations(page);
});

test("document responses use unique CSP nonces and security headers", async () => {
  const first = await context.request.get(appUrl("/compatibility"));
  const second = await context.request.get(appUrl("/compatibility"));
  const firstPolicy = first.headers()["content-security-policy"] ?? "";
  const secondPolicy = second.headers()["content-security-policy"] ?? "";
  const firstNonce = /'nonce-([^']+)'/u.exec(firstPolicy)?.[1];
  const secondNonce = /'nonce-([^']+)'/u.exec(secondPolicy)?.[1];

  expect(firstNonce).toMatch(/^[A-Za-z0-9+/=]{16,256}$/u);
  expect(secondNonce).toMatch(/^[A-Za-z0-9+/=]{16,256}$/u);
  expect(secondNonce).not.toBe(firstNonce);
  expect(firstPolicy.match(/script-src [^;]+/u)?.[0]).not.toContain("'unsafe-inline'");
  expect(firstPolicy).toContain("media-src 'none'");
  expect(firstPolicy).toContain("object-src 'none'");
  expect(firstPolicy).toContain("frame-ancestors 'none'");
  expect(first.headers()["strict-transport-security"]).toBe("max-age=31536000");
  expect(first.headers()["x-content-type-options"]).toBe("nosniff");
  expect(first.headers()["x-frame-options"]).toBe("DENY");

  const response = await page.goto(appUrl("/compatibility"));
  const documentPolicy = response?.headers()["content-security-policy"] ?? "";
  const documentNonce = /'nonce-([^']+)'/u.exec(documentPolicy)?.[1];
  expect(documentNonce).toBeDefined();
  expect(
    await page.evaluate(
      (nonce) =>
        [...document.scripts]
          .filter((script) => script.text.length > 0)
          .every((script) => script.nonce === nonce),
      documentNonce,
    ),
  ).toBe(true);
});

test("Base UI dialog restores keyboard focus", async () => {
  await page.goto(appUrl("/ui-foundation"));
  const trigger = page.getByRole("button", { name: "打开对话框" });
  await expectReactHydrated(trigger);
  await trigger.click();
  await expect(page.getByRole("dialog", { name: "确认界面状态" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();

  await trigger.focus();
  await trigger.press("Enter");
  await expect(page.getByRole("dialog", { name: "确认界面状态" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expectNoAxeViolations(page);
});

test("public gallery shell exposes its primary landmarks", async () => {
  test.skip(
    process.env.E2E_USERNAME === undefined || process.env.E2E_PASSWORD === undefined,
    "E2E test account is not configured",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  const album = await ensureLiveAlbum();
  const unlock = await context.request.post(appUrl(`/api/v1/public/albums/${album.slug}/unlock`), {
    data: { password: album.password },
    headers: { origin: baseUrl },
  });
  expect(unlock.status()).toBe(200);

  await page.goto(appUrl(`/g/${album.slug}`));
  await expect(page.getByRole("heading", { level: 1, name: album.title })).toBeVisible();
  await expectNoAxeViolations(page);
});

test("unauthenticated visitors cannot open the workbench", async () => {
  const isolatedContext = await browser.newContext();
  const isolatedPage = await isolatedContext.newPage();
  try {
    await isolatedPage.goto(appUrl("/studio"));
    await expect(isolatedPage).toHaveURL(/\/login$/u);
    await expect(
      isolatedPage.getByRole("heading", { level: 1, name: "内部人员登录" }),
    ).toBeVisible();
  } finally {
    await isolatedContext.close();
  }
});

test("authenticated studio and upload shells expose their primary landmarks", async () => {
  test.skip(csrfToken === undefined, "E2E test account is not configured");

  await page.goto(appUrl("/studio"));
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("heading", { name: "首页" })).toBeVisible();
  await expectNoAxeViolations(page);

  const album = await ensureLiveAlbum();
  await page.goto(appUrl(`/studio/albums/${album.id}/upload`));
  await expect(page.getByRole("heading", { level: 1, name: album.title })).toBeVisible();
  await expect(page.getByRole("heading", { name: "上传队列" })).toBeVisible();
  await expectNoAxeViolations(page);
});

test("5000 item gallery keeps the mounted DOM bounded while scrolling", async () => {
  await page.setViewportSize({ width: 1_280, height: 800 });
  await page.goto(appUrl("/verification/gallery-capacity"));
  await expect(page.getByRole("heading", { level: 1, name: "5,000 项窗口化网格" })).toBeVisible();
  await expect(page.locator('[data-virtualized="true"]')).toBeAttached();
  const mounted = page.locator("[data-media-id]");
  await expect.poll(() => mounted.count()).toBeGreaterThan(0);
  expect(await mounted.count()).toBeLessThan(100);

  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight }));
  await expect(
    page.locator('[data-media-id="00000000-0000-7000-8000-000000000001"]'),
  ).toBeAttached();
  expect(await mounted.count()).toBeLessThan(100);
});
