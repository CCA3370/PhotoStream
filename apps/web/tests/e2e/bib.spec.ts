import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import type { BibMediaState, InternalMediaList } from "@photostream/contracts";
import {
  type Browser,
  type BrowserContext,
  chromium,
  expect,
  type Locator,
  type Page,
  test,
} from "@playwright/test";

const baseUrl = process.env.E2E_APP_ORIGIN ?? "http://localhost:3000";
const assetVersion = "ppocrv6-tiny-0.4.2-ff6ab415-1e13b227";
let browser: Browser;
let context: BrowserContext;
let page: Page;
let csrfToken: string | undefined;
let ownsBrowser = false;

function appUrl(path: string): string {
  return new URL(path, baseUrl).href;
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

async function expectNoAxeViolations(currentPage: Page): Promise<void> {
  const results = await new AxeBuilder({ page: currentPage })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

async function numberedJpeg(currentPage: Page): Promise<Buffer> {
  await currentPage.goto(appUrl("/compatibility"));
  const base64 = await currentPage.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 960;
    canvas.height = 640;
    const canvasContext = canvas.getContext("2d");
    if (canvasContext === null) throw new Error("Canvas unavailable");
    canvasContext.fillStyle = "#ffffff";
    canvasContext.fillRect(0, 0, canvas.width, canvas.height);
    canvasContext.fillStyle = "#111827";
    canvasContext.font = "bold 190px Arial, sans-serif";
    canvasContext.textAlign = "center";
    canvasContext.textBaseline = "middle";
    canvasContext.fillText("101999", canvas.width / 2, canvas.height / 2);
    return canvas.toDataURL("image/jpeg", 0.96).split(",", 2)[1] ?? "";
  });
  return Buffer.from(base64, "base64");
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
  await page?.close();
  await context?.close();
  if (ownsBrowser) await browser?.close();
});

test("local OCR remains optional while confirmed bib search completes the password-gated flow", async () => {
  test.setTimeout(240_000);
  test.skip(csrfToken === undefined, "E2E test account is not configured");
  const unique = Date.now();
  const fixtureName = `synthetic-bib-101999-${unique}.jpg`;
  const writeHeaders = {
    origin: baseUrl,
    "x-csrf-token": csrfToken as string,
  };
  const created = await context.request.post(appUrl("/api/v1/albums"), {
    data: {
      title: `号码闭环 ${unique}`,
      description: "确定性非人物号码夹具",
      publishMode: "auto",
    },
    headers: { ...writeHeaders, "idempotency-key": crypto.randomUUID() },
  });
  expect(created.status()).toBe(201);
  const album = (await created.json()) as {
    album: { id: string; slug: string };
    generatedPassword: string;
  };
  expect(
    (
      await context.request.post(appUrl(`/api/v1/albums/${album.album.id}/start`), {
        headers: writeHeaders,
      })
    ).status(),
  ).toBe(200);
  const gradeId = crypto.randomUUID();
  const classId = crypto.randomUUID();
  const updated = await context.request.put(appUrl(`/api/v1/albums/${album.album.id}/bib-config`), {
    headers: writeHeaders,
    data: {
      recognitionEnabled: true,
      searchEnabled: true,
      modelVersion: assetVersion,
      patterns: [
        {
          totalLength: 6,
          sortOrder: 0,
          enabled: true,
          constraints: [
            {
              startPosition: 1,
              width: 3,
              sortOrder: 0,
              ranges: [{ start: "101", end: "112" }],
            },
          ],
        },
      ],
      attributeOptions: [
        { id: gradeId, dimension: "grade", displayName: "初一", sortOrder: 0, enabled: true },
        { id: classId, dimension: "class", displayName: "一班", sortOrder: 0, enabled: true },
      ],
      mappings: [
        {
          dimension: "grade",
          startPosition: 1,
          width: 1,
          ranges: [{ start: "1", end: "1" }],
          outputOptionId: gradeId,
          sortOrder: 0,
        },
        {
          dimension: "class",
          startPosition: 2,
          width: 2,
          ranges: [{ start: "01", end: "01" }],
          outputOptionId: classId,
          sortOrder: 0,
        },
      ],
    },
  });
  expect(updated.status()).toBe(200);

  const observedUrls: string[] = [];
  const assetCacheHeaders = new Map<string, string>();
  const recordRequest = (request: { url(): string }) => observedUrls.push(request.url());
  const recordResponse = (response: { headers(): Record<string, string>; url(): string }) => {
    if (response.url().includes("/assets/models/bib-ocr/")) {
      assetCacheHeaders.set(response.url(), response.headers()["cache-control"] ?? "");
    }
  };
  page.on("request", recordRequest);
  page.on("response", recordResponse);
  try {
    const fixture = await numberedJpeg(page);
    await page.goto(appUrl(`/studio/albums/${album.album.id}/upload`));
    const input = page.locator("#photo-files");
    await expectReactHydrated(input);
    await input.setInputFiles({
      name: fixtureName,
      mimeType: "image/jpeg",
      buffer: fixture,
    });
    const task = page.locator('[data-slot="card"]').filter({ hasText: fixtureName }).last();
    await expect(
      task.locator('[data-slot="card-description"]').getByText("完成", { exact: true }),
    ).toBeVisible({ timeout: 45_000 });
    await expect(task.getByText("OCR 已完成", { exact: true }).first()).toBeVisible({
      timeout: 180_000,
    });
    await task.getByLabel("手工添加号码").fill("101999");
    await task.getByRole("button", { name: "手工确认号码" }).click();
    await expect(task.getByText("有确认号码", { exact: true })).toBeVisible();
    await expect(task.getByText("初一", { exact: true })).toBeVisible();
    await expect(task.getByText("一班", { exact: true })).toBeVisible();

    const assetRequests = observedUrls.filter((url) => url.includes("/assets/models/bib-ocr/"));
    expect(assetRequests.some((url) => url.endsWith("/sdk/runtime.mjs"))).toBe(true);
    expect(assetRequests.some((url) => url.endsWith("/det.tar"))).toBe(true);
    expect(assetRequests.some((url) => url.endsWith("/rec.tar"))).toBe(true);
    expect(assetRequests.some((url) => /ort-wasm-.*\.wasm$/u.test(url))).toBe(true);
    expect(assetCacheHeaders.size).toBeGreaterThan(0);
    expect([...assetCacheHeaders.values()].every((value) => value.includes("immutable"))).toBe(
      true,
    );
    expect(
      observedUrls.some(
        (url) => url.includes("paddle-model-ecology") || url.includes("cdn.jsdelivr.net"),
      ),
    ).toBe(false);
    expect(observedUrls.some((url) => url.includes("101999"))).toBe(false);

    const viewer = await browser.newContext();
    const viewerPage = await viewer.newPage();
    try {
      await viewerPage.goto(appUrl(`/g/${album.album.slug}`));
      await viewerPage.getByLabel("相册口令").fill(album.generatedPassword);
      const unlock = viewerPage.getByRole("button", { name: "进入相册" });
      await expectReactHydrated(unlock);
      await unlock.click();
      const searchInput = viewerPage.getByLabel("输入号码找照片");
      await expect(searchInput).toBeVisible();
      await searchInput.fill("101999");
      await viewerPage.getByRole("button", { name: "查找照片" }).click();
      await expect(viewerPage.getByRole("button", { name: "打开活动照片" })).toBeVisible();
      expect(new URL(viewerPage.url()).search).not.toContain("101999");
      await expectNoAxeViolations(viewerPage);
      await viewerPage.reload();
      await expect(viewerPage.getByLabel("输入号码找照片")).toHaveValue("");
    } finally {
      await viewer.close();
    }

    await page.goto(appUrl(`/studio/albums/${album.album.id}/settings`));
    const bibTab = page.getByRole("tab", { name: "号码规则" });
    await expectReactHydrated(bibTab);
    await bibTab.click();
    await expect(page.getByText(/规则版本 \d+ · 映射版本 \d+/u)).toBeVisible();
    await expect(page.getByRole("button", { name: "保存号码规则与映射" })).toBeVisible();
    await expectNoAxeViolations(page);
  } finally {
    page.off("request", recordRequest);
    page.off("response", recordResponse);
  }
});

test("ignored local photo fixtures complete an unlabeled OCR smoke run", async () => {
  test.setTimeout(10 * 60 * 1_000);
  const fixtureDirectory = process.env.LOCAL_PHOTO_FIXTURE_DIR;
  test.skip(fixtureDirectory === undefined, "LOCAL_PHOTO_FIXTURE_DIR is not configured");
  test.skip(csrfToken === undefined, "E2E test account is not configured");
  const directory = resolve(fixtureDirectory as string);
  const ranked = await Promise.all(
    (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /\.jpe?g$/iu.test(entry.name))
      .map(async (entry) => {
        const path = resolve(directory, entry.name);
        return { path, bytes: (await stat(path)).size };
      }),
  );
  ranked.sort((left, right) => left.bytes - right.bytes);
  const selected = [ranked[0], ranked[Math.floor(ranked.length / 2)], ranked.at(-1)].filter(
    (item) => item !== undefined,
  );
  expect(selected).toHaveLength(3);

  const writeHeaders = {
    origin: baseUrl,
    "x-csrf-token": csrfToken as string,
  };
  const created = await context.request.post(appUrl("/api/v1/albums"), {
    data: {
      title: `本地样片 OCR 烟测 ${Date.now()}`,
      description: "Git 外无标注样片，仅验证执行与耗时",
      publishMode: "auto",
    },
    headers: { ...writeHeaders, "idempotency-key": crypto.randomUUID() },
  });
  expect(created.status()).toBe(201);
  const album = (await created.json()) as { album: { id: string } };
  expect(
    (
      await context.request.post(appUrl(`/api/v1/albums/${album.album.id}/start`), {
        headers: writeHeaders,
      })
    ).status(),
  ).toBe(200);
  const configured = await context.request.put(
    appUrl(`/api/v1/albums/${album.album.id}/bib-config`),
    {
      headers: writeHeaders,
      data: {
        recognitionEnabled: true,
        searchEnabled: false,
        modelVersion: assetVersion,
        patterns: Array.from({ length: 12 }, (_, index) => ({
          totalLength: index + 1,
          sortOrder: index,
          enabled: true,
          constraints: [],
        })),
        attributeOptions: [],
        mappings: [],
      },
    },
  );
  expect(configured.status()).toBe(200);

  await page.goto(appUrl(`/studio/albums/${album.album.id}/upload`));
  const input = page.locator("#photo-files");
  await expectReactHydrated(input);
  const durations: number[] = [];
  for (const [index, fixture] of selected.entries()) {
    const label = `local-ocr-smoke-${String(index + 1).padStart(2, "0")}.jpg`;
    const startedAt = performance.now();
    await input.setInputFiles({
      name: label,
      mimeType: "image/jpeg",
      buffer: await readFile(fixture.path),
    });
    const task = page.locator('[data-slot="card"]').filter({ hasText: label });
    await expect(
      task.locator('[data-slot="card-description"]').getByText("完成", { exact: true }),
    ).toBeVisible({ timeout: 90_000 });
    await expect(task.getByText("OCR 已完成", { exact: true }).first()).toBeVisible({
      timeout: 180_000,
    });
    durations.push(performance.now() - startedAt);
  }

  const mediaResponse = await context.request.get(
    appUrl(`/api/v1/albums/${album.album.id}/media?limit=100`),
  );
  const media = (await mediaResponse.json()) as InternalMediaList;
  expect(media.items).toHaveLength(3);
  const candidateCounts: number[] = [];
  for (const item of media.items) {
    const response = await context.request.get(appUrl(`/api/v1/media/${item.id}/bib`));
    expect(response.status()).toBe(200);
    const state = (await response.json()) as BibMediaState;
    expect(state.review.ocrStatus).toBe("completed");
    candidateCounts.push(state.tags.length);
  }
  durations.sort((left, right) => left - right);
  candidateCounts.sort((left, right) => left - right);
  process.stdout.write(
    `${JSON.stringify({
      localOcrSmokeFixtures: selected.length,
      ocrPipelineMedianMs: Math.round(durations[Math.floor(durations.length / 2)] ?? 0),
      ocrPipelineObservedMaxMs: Math.round(durations.at(-1) ?? 0),
      candidateCounts,
      accuracyAssessed: false,
    })}\n`,
  );
});
