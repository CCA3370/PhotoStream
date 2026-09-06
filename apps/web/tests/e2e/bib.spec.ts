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

test("local-first OCR keeps manual confirmation authoritative while recognition finishes", async () => {
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
  let releaseOcrAssets: () => void = () => undefined;
  const ocrAssetGate = new Promise<void>((resolve) => {
    releaseOcrAssets = resolve;
  });
  page.on("request", recordRequest);
  page.on("response", recordResponse);
  await page.route("**/assets/models/bib-ocr/**", async (route) => {
    await ocrAssetGate;
    await route.continue();
  });
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
    await expect(page.locator('[data-local-photo-id][data-ocr-status="processing"]')).toHaveCount(1, {
      timeout: 45_000,
    });

    await page.goto(appUrl(`/studio/albums/${album.album.id}/review`));
    const pendingCard = page.locator('[data-bib-ocr-pending="true"]').first();
    await expect(pendingCard).toBeVisible();
    const blockedBibButton = pendingCard.getByRole("button", { name: "号码识别中" });
    await expect(blockedBibButton).toBeDisabled();

    await pendingCard.getByRole("button", { name: "查看大图" }).click();
    await expect(page.getByText("号码识别中", { exact: true })).toBeVisible();
    await expect(page.getByText("正在识别号码，可直接手动输入并确认。", { exact: true })).toBeVisible();
    const manualInput = page.getByLabel("确认号码，多个号码用英文逗号分隔");
    await manualInput.fill("101999");
    await page.getByRole("button", { name: "确认", exact: true }).click();
    await expect(page.getByRole("button", { name: "修改号码确认" }).first()).toBeVisible();

    releaseOcrAssets();
    await page.getByRole("button", { name: "关闭审核图片查看器" }).click();
    const completedCard = page.locator('[data-bib-ocr-pending="false"]').first();
    await expect(completedCard).toBeVisible({ timeout: 180_000 });
    await expect(completedCard.getByRole("button", { name: "修改号码确认" })).toBeEnabled();
    await completedCard.getByRole("button", { name: "发布" }).click();
    await expect(completedCard.getByRole("button", { name: "隐藏" })).toBeVisible({ timeout: 90_000 });

    let mediaId: string | null = null;
    await expect
      .poll(async () => {
        const response = await context.request.get(
          appUrl(`/api/v1/albums/${album.album.id}/media?limit=100`),
        );
        const media = (await response.json()) as InternalMediaList;
        mediaId = media.items[0]?.id ?? null;
        return media.items.length;
      })
      .toBe(1);
    expect(mediaId).not.toBeNull();
    await expect
      .poll(async () => {
        const response = await context.request.get(appUrl(`/api/v1/media/${mediaId as string}/bib`));
        const state = (await response.json()) as BibMediaState;
        return {
          decision: state.review.decision,
          confirmed: state.tags
            .filter((tag) => tag.status === "confirmed")
            .map((tag) => tag.number),
        };
      })
      .toEqual({ decision: "numbers_confirmed", confirmed: ["101999"] });

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
      const findPhotos = viewerPage.getByRole("button", { name: "找照片", exact: true });
      await expectReactHydrated(findPhotos);
      await findPhotos.click();
      const searchInput = viewerPage.getByLabel("输入号码找照片");
      await expect(searchInput).toBeVisible();
      await searchInput.fill("101999");
      await viewerPage.getByRole("button", { name: "查找", exact: true }).click();
      await expect(viewerPage.getByRole("button", { name: "打开活动照片" })).toBeVisible();
      expect(new URL(viewerPage.url()).search).not.toContain("101999");
      await expectNoAxeViolations(viewerPage);
      await viewerPage.reload();
      const reloadedFindPhotos = viewerPage.getByRole("button", { name: "找照片", exact: true });
      await expectReactHydrated(reloadedFindPhotos);
      await reloadedFindPhotos.click();
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
    releaseOcrAssets();
    await page.unroute("**/assets/models/bib-ocr/**");
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
    await expect(page.locator('[data-local-photo-id][data-ocr-status="completed"]').first()).toBeVisible({
      timeout: 180_000,
    });
    durations.push(performance.now() - startedAt);
  }

  await page.goto(appUrl(`/studio/albums/${album.album.id}/review`));
  await expect(page.locator('[data-bib-ocr-pending="false"]')).toHaveCount(3);
  for (let remaining = 3; remaining > 0; remaining -= 1) {
    const publishButton = page.getByRole("button", { name: "发布" }).first();
    await expect(publishButton).toBeVisible();
    await publishButton.click();
    await expect.poll(() => page.getByRole("button", { name: "发布" }).count()).toBe(remaining - 1);
  }

  const mediaResponse = await context.request.get(
    appUrl(`/api/v1/albums/${album.album.id}/media?limit=100`),
  );
  const media = (await mediaResponse.json()) as InternalMediaList;
  expect(media.items).toHaveLength(3);
  const candidateCounts: number[] = [];
  for (const item of media.items) {
    await expect
      .poll(async () => {
        const response = await context.request.get(appUrl(`/api/v1/media/${item.id}/bib`));
        const state = (await response.json()) as BibMediaState;
        if (state.review.ocrStatus === "completed") candidateCounts.push(state.tags.length);
        return state.review.ocrStatus;
      })
      .toBe("completed");
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
