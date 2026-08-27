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

test("Tailwind compatibility surface renders semantic tokens without accessibility errors", async () => {
  await page.goto(appUrl("/compatibility"));
  await expect(page.getByRole("heading", { level: 1, name: "中学部影像直播" })).toBeVisible();
  await expect(page.locator("[data-compat-media]")).toHaveCount(12);
  await expectNoAxeViolations(page);
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
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto(appUrl("/g/demo"));
  await expect(page.getByRole("heading", { level: 1, name: "春季运动会" })).toBeVisible();
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
  const username = process.env.E2E_USERNAME;
  const password = process.env.E2E_PASSWORD;
  test.skip(username === undefined || password === undefined, "E2E test account is not configured");

  const login = await context.request.post(appUrl("/api/v1/auth/login"), {
    data: { username, password },
    headers: { origin: baseUrl },
  });
  expect(login.status()).toBe(200);

  await page.goto(appUrl("/studio"));
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("heading", { name: "活动总览" })).toBeVisible();
  await expectNoAxeViolations(page);

  await page.goto(appUrl("/studio/albums/demo/upload"));
  await expect(page.getByRole("heading", { level: 1, name: "春季运动会" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "上传队列" })).toBeVisible();
  await expectNoAxeViolations(page);
});
