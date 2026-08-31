import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import type { InternalMediaList } from "@photostream/contracts";
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
const objectStoreRoute = /^http:\/\/(?:localhost|127\.0\.0\.1):3002\/objects\//u;
let browser: Browser;
let context: BrowserContext;
let page: Page;
let csrfToken: string | undefined;

function webpChunkTypes(bytes: Buffer): readonly string[] {
  if (
    bytes.byteLength < 12 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WEBP"
  ) {
    throw new Error("Derived fixture is not a WebP container");
  }
  const chunks: string[] = [];
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const type = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    chunks.push(type);
    offset += 8 + size + (size % 2);
  }
  return chunks;
}

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

async function syntheticImage(
  currentPage: Page,
  contentType: "image/jpeg" | "image/png" = "image/png",
): Promise<string> {
  await currentPage.goto(appUrl("/compatibility"));
  return currentPage.evaluate((type) => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 48;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Canvas unavailable");
    context.fillStyle = "#1d4ed8";
    context.fillRect(0, 0, 64, 48);
    context.fillStyle = "#ffffff";
    context.fillRect(8, 8, 48, 32);
    return canvas.toDataURL(type, 0.9).split(",", 2)[1] ?? "";
  }, contentType);
}

async function selectSyntheticFile(
  input: Locator,
  options: { readonly base64: string; readonly name: string },
): Promise<void> {
  await input.evaluate((element, fixture) => {
    const bytes = Uint8Array.from(atob(fixture.base64), (character) => character.charCodeAt(0));
    const file = new File([bytes], fixture.name, {
      type: "image/png",
      lastModified: 1_787_830_000_000,
    });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const fileInput = element as HTMLInputElement;
    fileInput.files = transfer.files;
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
  }, options);
}

async function selectPaddedSyntheticFile(
  input: Locator,
  options: { readonly base64: string; readonly name: string; readonly totalBytes: number },
): Promise<void> {
  await input.evaluate((element, fixture) => {
    const bytes = Uint8Array.from(atob(fixture.base64), (character) => character.charCodeAt(0));
    if (fixture.totalBytes < bytes.byteLength) throw new Error("Fixture size is too small");
    const padding = new Uint8Array(fixture.totalBytes - bytes.byteLength);
    const file = new File([bytes, padding], fixture.name, {
      type: "image/png",
      lastModified: 1_787_830_100_000,
    });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const fileInput = element as HTMLInputElement;
    fileInput.files = transfer.files;
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
  }, options);
}

test.beforeAll(async () => {
  const cdpUrl = process.env.BROWSER_CDP_URL;
  if (cdpUrl === undefined) {
    browser = await chromium.launch();
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
});

test("photo travels browser to object store and becomes visible after password unlock", async () => {
  test.skip(csrfToken === undefined, "E2E test account is not configured");
  const writeHeaders = {
    origin: baseUrl,
    "x-csrf-token": csrfToken as string,
    "idempotency-key": crypto.randomUUID(),
  };
  const created = await context.request.post(appUrl("/api/v1/albums"), {
    data: {
      title: `浏览器直传 ${Date.now()}`,
      description: "确定性非人物夹具",
      publishMode: "auto",
    },
    headers: writeHeaders,
  });
  expect(created.status()).toBe(201);
  const createdAlbum = (await created.json()) as {
    album: { id: string; slug: string; title: string };
    generatedPassword: string;
  };
  const started = await context.request.post(
    appUrl(`/api/v1/albums/${createdAlbum.album.id}/start`),
    {
      headers: {
        origin: baseUrl,
        "x-csrf-token": csrfToken as string,
      },
    },
  );
  expect(started.status()).toBe(200);

  const fixtureBase64 = await syntheticImage(page, "image/jpeg");
  const viewer = await browser.newContext();
  const viewerPage = await viewer.newPage();
  const objectResponses: string[] = [];
  let connected: () => void = () => undefined;
  const sseConnected = new Promise<void>((resolve) => {
    connected = resolve;
  });
  viewerPage.on("response", (response) => {
    const url = new URL(response.url());
    if (url.port === "3002" && url.pathname.startsWith("/objects/")) {
      objectResponses.push(response.url());
    }
    if (url.pathname.endsWith(`/api/v1/public/albums/${createdAlbum.album.slug}/events`)) {
      connected();
    }
  });
  try {
    await viewerPage.goto(appUrl(`/g/${createdAlbum.album.slug}`));
    await viewerPage.getByLabel("相册口令").fill(createdAlbum.generatedPassword);
    const unlock = viewerPage.getByRole("button", { name: "进入相册" });
    await expectReactHydrated(unlock);
    await unlock.click();
    await expect(viewerPage.getByText("还没有已发布影像")).toBeVisible();
    await sseConnected;

    await page.goto(appUrl(`/studio/albums/${createdAlbum.album.id}/upload`));
    const input = page.locator("#photo-files");
    await expectReactHydrated(input);
    await input.setInputFiles({
      name: "synthetic-stage-2.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from(fixtureBase64, "base64"),
    });
    const task = page.locator('[data-slot="card"]').filter({ hasText: "synthetic-stage-2.jpg" });
    await expect(
      task.locator('[data-slot="card-description"]').getByText("完成", { exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(task.getByText("已发布", { exact: true })).toBeVisible();

    const newMedia = viewerPage.getByRole("button", { name: "有 1 条新影像" });
    await expect(newMedia).toBeVisible({ timeout: 15_000 });
    await newMedia.click();
    const photoButton = viewerPage.getByRole("button", { name: "打开活动照片" });
    await expect(photoButton).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => objectResponses.length).toBeGreaterThan(0);
    expect(
      objectResponses.every((url) => url.includes("signature=") && url.includes("expires=")),
    ).toBe(true);
    await photoButton.click();
    await expect(viewerPage.getByRole("dialog", { name: "活动照片预览" })).toBeVisible();
  } finally {
    await viewer.close();
  }
});

test("failed direct upload survives reload and resumes only missing objects", async () => {
  test.skip(csrfToken === undefined, "E2E test account is not configured");
  const created = await context.request.post(appUrl("/api/v1/albums"), {
    data: {
      title: `恢复测试 ${Date.now()}`,
      description: "中断后重新选择同一文件",
      publishMode: "auto",
    },
    headers: {
      origin: baseUrl,
      "x-csrf-token": csrfToken as string,
      "idempotency-key": crypto.randomUUID(),
    },
  });
  expect(created.status()).toBe(201);
  const album = (await created.json()) as { album: { id: string } };
  expect(
    (
      await context.request.post(appUrl(`/api/v1/albums/${album.album.id}/start`), {
        headers: { origin: baseUrl, "x-csrf-token": csrfToken as string },
      })
    ).status(),
  ).toBe(200);

  const fixtureBase64 = await syntheticImage(page);
  await page.goto(appUrl(`/studio/albums/${album.album.id}/upload`));
  const input = page.locator("#photo-files");
  await expectReactHydrated(input);
  let aborted = 0;
  await page.route(objectStoreRoute, async (route) => {
    if (/\/960\.(?:webp|jpg)$/u.test(new URL(route.request().url()).pathname)) {
      aborted += 1;
      await route.abort("connectionfailed");
    } else {
      await route.continue();
    }
  });
  await selectSyntheticFile(input, {
    base64: fixtureBase64,
    name: "synthetic-recovery.png",
  });
  const failedTask = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "synthetic-recovery.png" });
  await expect(
    failedTask.locator('[data-slot="card-description"]').getByText("失败", { exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  expect(aborted).toBe(3);

  await page.unroute(objectStoreRoute);
  await page.reload();
  await expect(page.getByText(/发现 1 个可恢复任务/u)).toBeVisible();
  const resumedInput = page.locator("#photo-files");
  await expectReactHydrated(resumedInput);
  const resumedPuts: string[] = [];
  const capturePut = (request: { method(): string; url(): string }) => {
    if (request.method() === "PUT" && objectStoreRoute.test(request.url()))
      resumedPuts.push(request.url());
  };
  page.on("request", capturePut);
  await selectSyntheticFile(resumedInput, {
    base64: fixtureBase64,
    name: "synthetic-recovery.png",
  });
  const resumedTask = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "synthetic-recovery.png" });
  await expect(
    resumedTask.locator('[data-slot="card-description"]').getByText("完成", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/发现 1 个可恢复任务/u)).toHaveCount(0);
  page.off("request", capturePut);
  expect(resumedPuts.some((url) => /\/480\.(?:webp|jpg)\?/u.test(url))).toBe(false);
});

test("large original uses fixed multipart parts while previews stay single PUT", async () => {
  test.skip(csrfToken === undefined, "E2E test account is not configured");
  const created = await context.request.post(appUrl("/api/v1/albums"), {
    data: {
      title: `分片测试 ${Date.now()}`,
      description: "17MiB 非人物合成夹具",
      publishMode: "auto",
    },
    headers: {
      origin: baseUrl,
      "x-csrf-token": csrfToken as string,
      "idempotency-key": crypto.randomUUID(),
    },
  });
  expect(created.status()).toBe(201);
  const album = (await created.json()) as { album: { id: string } };
  expect(
    (
      await context.request.post(appUrl(`/api/v1/albums/${album.album.id}/start`), {
        headers: { origin: baseUrl, "x-csrf-token": csrfToken as string },
      })
    ).status(),
  ).toBe(200);

  const multipartPuts: string[] = [];
  page.on("response", (response) => {
    if (response.request().method() === "PUT" && response.url().includes("/multipart/")) {
      multipartPuts.push(response.url());
    }
  });
  const fixtureBase64 = await syntheticImage(page);
  await page.goto(appUrl(`/studio/albums/${album.album.id}/upload`));
  const input = page.locator("#photo-files");
  await expectReactHydrated(input);
  await selectPaddedSyntheticFile(input, {
    base64: fixtureBase64,
    name: "synthetic-multipart.png",
    totalBytes: 17 * 1024 * 1024,
  });
  const task = page.locator('[data-slot="card"]').filter({ hasText: "synthetic-multipart.png" });
  await expect(
    task.locator('[data-slot="card-description"]').getByText("完成", { exact: true }),
  ).toBeVisible({ timeout: 45_000 });
  expect(multipartPuts).toHaveLength(3);
  expect(multipartPuts.every((url) => /\/parts\/[123]\?/u.test(url))).toBe(true);
});

test("queue pause waits between objects and explicit cancel removes local recovery", async () => {
  test.skip(csrfToken === undefined, "E2E test account is not configured");
  const created = await context.request.post(appUrl("/api/v1/albums"), {
    data: {
      title: `队列控制 ${Date.now()}`,
      description: "暂停、继续与取消",
      publishMode: "auto",
    },
    headers: {
      origin: baseUrl,
      "x-csrf-token": csrfToken as string,
      "idempotency-key": crypto.randomUUID(),
    },
  });
  expect(created.status()).toBe(201);
  const album = (await created.json()) as { album: { id: string } };
  expect(
    (
      await context.request.post(appUrl(`/api/v1/albums/${album.album.id}/start`), {
        headers: { origin: baseUrl, "x-csrf-token": csrfToken as string },
      })
    ).status(),
  ).toBe(200);

  const fixtureBase64 = await syntheticImage(page);
  await page.goto(appUrl(`/studio/albums/${album.album.id}/upload`));
  const input = page.locator("#photo-files");
  await expectReactHydrated(input);
  let releaseUploads: () => void = () => undefined;
  const uploadGate = new Promise<void>((resolve) => {
    releaseUploads = resolve;
  });
  let observedUpload: () => void = () => undefined;
  const firstUpload = new Promise<void>((resolve) => {
    observedUpload = resolve;
  });
  await page.route(objectStoreRoute, async (route) => {
    observedUpload();
    await uploadGate;
    await route.continue();
  });
  await selectSyntheticFile(input, { base64: fixtureBase64, name: "synthetic-controls.png" });
  await firstUpload;
  await page.getByRole("button", { name: "暂停全部" }).first().click();
  await expect(page.getByRole("button", { name: "继续队列" }).first()).toBeVisible();
  releaseUploads();
  const task = page.locator('[data-slot="card"]').filter({ hasText: "synthetic-controls.png" });
  await expect(
    task.locator('[data-slot="card-description"]').getByText("上传 1920 灯箱图", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 15_000 });
  await page.unroute(objectStoreRoute);
  await page.getByRole("button", { name: "继续队列" }).first().click();
  await expect(
    task.locator('[data-slot="card-description"]').getByText("完成", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });

  let releaseCancel: () => void = () => undefined;
  const cancelGate = new Promise<void>((resolve) => {
    releaseCancel = resolve;
  });
  let observedCancelUpload: () => void = () => undefined;
  const cancelUpload = new Promise<void>((resolve) => {
    observedCancelUpload = resolve;
  });
  let controlPlaneCancelCompleted = false;
  page.on("response", (response) => {
    if (
      response.request().method() === "POST" &&
      /\/api\/v1\/uploads\/[0-9a-f-]{36}\/cancel$/u.test(new URL(response.url()).pathname) &&
      response.status() === 200
    ) {
      controlPlaneCancelCompleted = true;
    }
  });
  await page.route(objectStoreRoute, async (route) => {
    observedCancelUpload();
    await cancelGate;
    await route.abort("connectionfailed").catch(() => undefined);
  });
  await selectSyntheticFile(input, { base64: fixtureBase64, name: "synthetic-cancel.png" });
  await cancelUpload;
  const cancelledTask = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "synthetic-cancel.png" });
  await cancelledTask.getByRole("button", { name: "取消" }).click();
  releaseCancel();
  await expect(
    cancelledTask.locator('[data-slot="card-description"]').getByText("已取消", { exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => controlPlaneCancelCompleted).toBe(true);
  await page.unroute(objectStoreRoute);
  await page.reload();
  await expect(page.getByText(/发现 1 个可恢复任务/u)).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        await navigator.serviceWorker.ready;
        return navigator.serviceWorker.controller !== null;
      }),
    )
    .toBe(true);
  const cachedPaths = await page.evaluate(async () => {
    const paths: string[] = [];
    for (const key of await caches.keys()) {
      for (const request of await (await caches.open(key)).keys()) {
        paths.push(new URL(request.url).pathname);
      }
    }
    return paths;
  });
  expect(cachedPaths).toContain("/offline");
  expect(
    cachedPaths.some(
      (path) =>
        path.startsWith("/api/") ||
        path.startsWith("/g/") ||
        path.startsWith("/studio/") ||
        path.startsWith("/assets/models/"),
    ),
  ).toBe(false);
  await context.setOffline(true);
  try {
    await page.goto(appUrl(`/studio/albums/${album.album.id}/upload`));
    await expect(page.getByRole("alert").getByText("当前处于离线状态")).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});

test("ignored local photo fixtures decode and strip metadata through the real worker", async () => {
  test.setTimeout(10 * 60 * 1_000);
  const fixtureDirectory = process.env.LOCAL_PHOTO_FIXTURE_DIR;
  test.skip(fixtureDirectory === undefined, "LOCAL_PHOTO_FIXTURE_DIR is not configured");
  test.skip(csrfToken === undefined, "E2E test account is not configured");
  const directory = resolve(fixtureDirectory as string);
  const entries = (await readdir(directory, { withFileTypes: true })).filter(
    (entry) => entry.isFile() && /\.jpe?g$/iu.test(entry.name),
  );
  const ranked = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      return { path, bytes: (await stat(path)).size };
    }),
  );
  ranked.sort((left, right) => left.bytes - right.bytes);
  const sampleCount = Math.min(12, ranked.length);
  const selected = Array.from(
    new Map(
      Array.from({ length: sampleCount }, (_, index) => {
        const position =
          sampleCount === 1 ? 0 : Math.round((index * (ranked.length - 1)) / (sampleCount - 1));
        const item = ranked[position];
        return item === undefined ? ["missing", null] : [item.path, item];
      }),
    ).values(),
  ).filter((item) => item !== null);
  expect(selected).toHaveLength(sampleCount);

  const created = await context.request.post(appUrl("/api/v1/albums"), {
    data: {
      title: `本地样片管线 ${Date.now()}`,
      description: "Git 外授权样片聚合验证",
      publishMode: "auto",
    },
    headers: {
      origin: baseUrl,
      "x-csrf-token": csrfToken as string,
      "idempotency-key": crypto.randomUUID(),
    },
  });
  expect(created.status()).toBe(201);
  const album = (await created.json()) as {
    album: { id: string };
  };
  expect(
    (
      await context.request.post(appUrl(`/api/v1/albums/${album.album.id}/start`), {
        headers: { origin: baseUrl, "x-csrf-token": csrfToken as string },
      })
    ).status(),
  ).toBe(200);

  await page.goto(appUrl(`/studio/albums/${album.album.id}/upload`));
  const input = page.locator("#photo-files");
  await expectReactHydrated(input);
  const durations: number[] = [];
  for (const [index, fixture] of selected.entries()) {
    const label = `local-fixture-${String(index + 1).padStart(2, "0")}.jpg`;
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
    durations.push(performance.now() - startedAt);
  }

  const mediaResponse = await context.request.get(
    appUrl(`/api/v1/albums/${album.album.id}/media?limit=100`),
  );
  expect(mediaResponse.status()).toBe(200);
  const media = (await mediaResponse.json()) as InternalMediaList;
  expect(media.items).toHaveLength(sampleCount);
  const derivedBytes: number[] = [];
  let originalsWithExif = 0;
  for (const item of media.items) {
    expect(item).toMatchObject({ width: 6_240, height: 4_160, ingestStatus: "ready" });
    expect(item.variants).toHaveLength(4);
    for (const variant of item.variants) {
      const response = await context.request.get(variant.url);
      expect(response.status()).toBe(200);
      const bytes = await response.body();
      if (variant.kind === "photo_original") {
        if (bytes.includes(Buffer.from("Exif\0\0", "ascii"))) originalsWithExif += 1;
        continue;
      }
      expect(variant.contentType).toBe("image/webp");
      expect(webpChunkTypes(bytes)).not.toEqual(expect.arrayContaining(["EXIF", "XMP ", "ICCP"]));
      derivedBytes.push(bytes.byteLength);
    }
  }
  expect(originalsWithExif).toBe(sampleCount);
  durations.sort((left, right) => left - right);
  derivedBytes.sort((left, right) => left - right);
  process.stdout.write(
    `${JSON.stringify({
      localPhotoFixtures: sampleCount,
      pipelineMedianMs: Math.round(durations[Math.floor(durations.length / 2)] ?? 0),
      pipelineP95Ms: Math.round(durations[Math.floor((durations.length - 1) * 0.95)] ?? 0),
      derivedMedianBytes: derivedBytes[Math.floor(derivedBytes.length / 2)] ?? 0,
      derivedMaxBytes: derivedBytes.at(-1) ?? 0,
      exifStripped: sampleCount * 3,
    })}\n`,
  );
});
