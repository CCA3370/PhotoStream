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

const baseUrl = process.env.E2E_APP_ORIGIN ?? "http://localhost:3000";
let browser: Browser;
let context: BrowserContext;
let page: Page;
let csrfToken: string | undefined;
let ownsBrowser = false;

function appUrl(path: string): string {
  return new URL(path, baseUrl).href;
}

function internalWriteHeaders(idempotencyKey?: string): Record<string, string> {
  if (csrfToken === undefined) throw new Error("E2E test account is not configured");
  return {
    origin: baseUrl,
    "x-csrf-token": csrfToken,
    ...(idempotencyKey === undefined ? {} : { "idempotency-key": idempotencyKey }),
  };
}

function publicWriteHeaders(idempotencyKey: string): Record<string, string> {
  return { origin: baseUrl, "idempotency-key": idempotencyKey };
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

async function syntheticJpeg(currentPage: Page): Promise<Buffer> {
  await currentPage.goto(appUrl("/compatibility"));
  const base64 = await currentPage.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 64;
    const canvasContext = canvas.getContext("2d");
    if (canvasContext === null) throw new Error("Canvas unavailable");
    canvasContext.fillStyle = "#166534";
    canvasContext.fillRect(0, 0, 96, 64);
    canvasContext.fillStyle = "#f8fafc";
    canvasContext.fillRect(12, 12, 72, 40);
    return canvas.toDataURL("image/jpeg", 0.9).split(",", 2)[1] ?? "";
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

test("review, downloads, live visibility, deletion, and password rotation form one real flow", async () => {
  test.setTimeout(120_000);
  test.skip(csrfToken === undefined, "E2E test account is not configured");

  const unique = Date.now();
  const title = `运营闭环 ${unique}`;
  const created = await context.request.post(appUrl("/api/v1/albums"), {
    data: { title, description: "确定性非人物运营夹具", publishMode: "review" },
    headers: internalWriteHeaders(crypto.randomUUID()),
  });
  expect(created.status()).toBe(201);
  const album = (await created.json()) as {
    album: { id: string; slug: string; title: string };
    generatedPassword: string;
  };
  const started = await context.request.post(appUrl(`/api/v1/albums/${album.album.id}/start`), {
    headers: internalWriteHeaders(),
  });
  expect(started.status()).toBe(200);

  const viewer = await browser.newContext();
  const viewerPage = await viewer.newPage();
  let resolveSse: () => void = () => undefined;
  const sseConnected = new Promise<void>((resolve) => {
    resolveSse = resolve;
  });
  const publicObjectRequests: string[] = [];
  viewerPage.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.endsWith(`/api/v1/public/albums/${album.album.slug}/events`)) resolveSse();
    if (url.port === "3002" && url.pathname.startsWith("/objects/")) {
      publicObjectRequests.push(url.pathname);
    }
  });

  try {
    await viewerPage.goto(appUrl(`/g/${album.album.slug}`));
    await viewerPage.getByLabel("相册口令").fill(album.generatedPassword);
    const unlock = viewerPage.getByRole("button", { name: "进入相册" });
    await expectReactHydrated(unlock);
    await unlock.click();
    await expect(viewerPage.getByText("还没有已发布影像")).toBeVisible();
    await sseConnected;

    const fixture = await syntheticJpeg(page);
    await page.goto(appUrl(`/studio/albums/${album.album.id}/upload`));
    const fileInput = page.locator("#photo-files");
    await expectReactHydrated(fileInput);
    await fileInput.setInputFiles({
      name: "stage-3-operations.jpg",
      mimeType: "image/jpeg",
      buffer: fixture,
    });
    const uploadCard = page
      .locator('[data-slot="card"]')
      .filter({ hasText: "stage-3-operations.jpg" });
    await expect(
      uploadCard.locator('[data-slot="card-description"]').getByText("完成", { exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(uploadCard.getByText("等待审核", { exact: true })).toBeVisible();
    await expect(viewerPage.getByText("还没有已发布影像")).toBeVisible();

    const listed = await context.request.get(
      appUrl(`/api/v1/albums/${album.album.id}/media?limit=60`),
    );
    expect(listed.status()).toBe(200);
    const internalMedia = (await listed.json()) as {
      items: readonly {
        id: string;
        publicationStatus: string;
        deletionTask: { id: string; status: string } | null;
        variants: readonly unknown[];
      }[];
    };
    expect(internalMedia.items).toHaveLength(1);
    const mediaId = internalMedia.items[0]?.id;
    if (mediaId === undefined) throw new Error("Uploaded media was not listed");

    await page.goto(appUrl(`/studio/albums/${album.album.id}/review`));
    await expect(page.getByRole("combobox", { name: "发布状态筛选" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "摄取状态筛选" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "分类筛选" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "上传者筛选" })).toBeVisible();
    const mediaCard = page.locator('[data-slot="card"]').filter({ hasText: mediaId.slice(-8) });
    const reviewCheckbox = mediaCard.getByRole("checkbox", {
      name: `选择照片 ${mediaId.slice(-8)}`,
    });
    await expectReactHydrated(reviewCheckbox);
    await reviewCheckbox.click();
    await page.getByRole("button", { name: "发布", exact: true }).click();
    await expect(page.getByText("批量结果：成功 1，失败 0")).toBeVisible();
    await expect(mediaCard.getByText("已发布", { exact: true })).toBeVisible();

    const newMedia = viewerPage.getByRole("button", { name: "有 1 条新影像" });
    await expect(newMedia).toBeVisible({ timeout: 15_000 });
    await newMedia.click();
    const publicPhoto = viewerPage.getByRole("button", { name: "打开活动照片" });
    await expect(publicPhoto).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => publicObjectRequests.length).toBeGreaterThan(0);
    expect(publicObjectRequests.some((path) => /\/original\./u.test(path))).toBe(false);

    for (const kind of ["preview", "original"] as const) {
      const disabledDownload = await viewer.request.post(
        appUrl(`/api/v1/public/albums/${album.album.slug}/downloads/${mediaId}/${kind}`),
        { headers: publicWriteHeaders(crypto.randomUUID()) },
      );
      expect(disabledDownload.status()).toBe(403);
      expect((await disabledDownload.json()) as { code: string }).toMatchObject({
        code: "DOWNLOAD_DISABLED",
      });
    }

    await page.goto(appUrl(`/studio/albums/${album.album.id}/settings`));
    const downloadsTab = page.getByRole("tab", { name: "下载" });
    await expectReactHydrated(downloadsTab);
    await downloadsTab.click();
    for (const [name, confirmation] of [
      ["普通图下载", "普通图下载已更新"],
      ["照片原图下载", "照片原图下载已更新"],
    ] as const) {
      const toggle = page.getByRole("switch", { name });
      await expectReactHydrated(toggle);
      await toggle.click();
      await expect(page.getByText(confirmation)).toBeVisible();
    }
    await page.getByRole("tab", { name: "隐私与投诉" }).click();
    await page.getByLabel("隐私说明").fill("仅用于本次校内活动记录，请勿转发。");
    await page.getByLabel("删除/投诉联系方式").fill("校内影像管理员");
    await page.getByRole("button", { name: "保存公开说明" }).click();
    await expect(page.getByText("隐私与投诉信息已更新")).toBeVisible();
    await expectNoAxeViolations(page);

    await viewerPage.reload();
    await expect(viewerPage.getByText("仅用于本次校内活动记录，请勿转发。")).toBeVisible();
    await expect(viewerPage.getByText("校内影像管理员")).toBeVisible();
    await viewerPage.getByRole("button", { name: "打开活动照片" }).click();
    await expect(viewerPage.getByRole("button", { name: /下载普通图/u })).toBeVisible();
    await expect(viewerPage.getByRole("button", { name: /下载原图/u })).toBeVisible();
    await expect(viewerPage.getByText("原图可能包含相机元数据")).toBeVisible();

    const previewKey = crypto.randomUUID();
    const previewResponse = await viewer.request.post(
      appUrl(`/api/v1/public/albums/${album.album.slug}/downloads/${mediaId}/preview`),
      { headers: publicWriteHeaders(previewKey) },
    );
    expect(previewResponse.status()).toBe(200);
    const previewSigned = (await previewResponse.json()) as {
      url: string;
      filename: string;
      bytes: number;
      expiresAt: string;
    };
    const previewUrl = new URL(previewSigned.url);
    expect(previewUrl.searchParams.get("signature")).toMatch(/^[A-Za-z0-9_-]{40,}$/u);
    expect(previewUrl.searchParams.get("expires")).toMatch(/^\d+$/u);
    expect(previewSigned.filename).toContain("preview");
    expect(previewSigned.bytes).toBeGreaterThan(0);
    expect(new Date(previewSigned.expiresAt).getTime() - Date.now()).toBeGreaterThan(240_000);
    const previewRetry = await viewer.request.post(
      appUrl(`/api/v1/public/albums/${album.album.slug}/downloads/${mediaId}/preview`),
      { headers: publicWriteHeaders(previewKey) },
    );
    expect(await previewRetry.json()).toEqual(previewSigned);

    const originalResponse = await viewer.request.post(
      appUrl(`/api/v1/public/albums/${album.album.slug}/downloads/${mediaId}/original`),
      { headers: publicWriteHeaders(crypto.randomUUID()) },
    );
    expect(originalResponse.status()).toBe(200);
    expect((await originalResponse.json()) as { filename: string }).toMatchObject({
      filename: expect.stringContaining("original"),
    });
    await viewerPage.keyboard.press("Escape");

    await page.goto(appUrl(`/studio/albums/${album.album.id}/review`));
    const publishedCard = page.locator('[data-slot="card"]').filter({ hasText: mediaId.slice(-8) });
    const selectPublished = publishedCard.getByRole("checkbox", {
      name: `选择照片 ${mediaId.slice(-8)}`,
    });
    await expectReactHydrated(selectPublished);
    await selectPublished.click();
    await page.getByRole("button", { name: "隐藏", exact: true }).click();
    await expect(publishedCard.getByText("已隐藏", { exact: true })).toBeVisible();
    await expect(viewerPage.getByRole("button", { name: "打开活动照片" })).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(viewerPage.getByText("还没有已发布影像")).toBeVisible();

    await selectPublished.click();
    await page.getByRole("button", { name: "恢复", exact: true }).click();
    await expect(publishedCard.getByText("已发布", { exact: true })).toBeVisible();
    await expect(viewerPage.getByRole("button", { name: "打开活动照片" })).toBeVisible({
      timeout: 15_000,
    });

    const deleteTrigger = publishedCard.getByRole("button", { name: "永久删除" });
    await deleteTrigger.click();
    await expect(page.getByRole("alertdialog", { name: "永久删除该媒体？" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(deleteTrigger).toBeFocused();
    await deleteTrigger.click();
    await page.getByLabel(/输入相册标题/u).fill(title);
    await page.getByRole("button", { name: "确认永久删除" }).click();
    await expect(publishedCard.getByText("已删除", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(publishedCard.getByText("删除 completed", { exact: true })).toBeVisible();
    await expect(viewerPage.getByRole("button", { name: "打开活动照片" })).toHaveCount(0, {
      timeout: 15_000,
    });
    const deletedObject = await viewer.request.get(previewSigned.url);
    expect(deletedObject.status()).toBe(404);

    const afterDeletion = await context.request.get(
      appUrl(`/api/v1/albums/${album.album.id}/media?limit=60&publicationStatus=deleted`),
    );
    expect(afterDeletion.status()).toBe(200);
    const deletedList = (await afterDeletion.json()) as {
      items: readonly {
        id: string;
        publicationStatus: string;
        deletionTask: { status: string } | null;
        variants: readonly unknown[];
      }[];
    };
    expect(deletedList.items).toContainEqual(
      expect.objectContaining({
        id: mediaId,
        publicationStatus: "deleted",
        deletionTask: expect.objectContaining({ status: "completed" }),
        variants: [],
      }),
    );

    await page.goto(appUrl(`/studio/albums/${album.album.id}/settings`));
    const accessTab = page.getByRole("tab", { name: "访问与发布" });
    await expectReactHydrated(accessTab);
    await accessTab.click();
    await page.getByRole("button", { name: "更换随机口令并退出旧访客" }).click();
    const passwordAlert = page.getByRole("alert").filter({ hasText: "请立即安全保存新口令" });
    await expect(passwordAlert).toBeVisible();
    const newPassword = (await passwordAlert.locator(".font-mono").textContent())?.trim();
    if (newPassword === undefined || newPassword.length < 12) {
      throw new Error("Rotated album password was not displayed exactly once");
    }

    await viewerPage.reload();
    await expect(viewerPage.getByLabel("相册口令")).toBeVisible();
    await viewerPage.getByLabel("相册口令").fill(album.generatedPassword);
    const rotatedUnlock = viewerPage.getByRole("button", { name: "进入相册" });
    await expectReactHydrated(rotatedUnlock);
    await rotatedUnlock.click();
    await expect(viewerPage.getByText("相册不可用或口令错误")).toBeVisible();
    await viewerPage.getByLabel("相册口令").fill(newPassword);
    await viewerPage.getByRole("button", { name: "进入相册" }).click();
    await expect(viewerPage.getByText("还没有已发布影像")).toBeVisible();
    await expectNoAxeViolations(viewerPage);

    await page.goto(appUrl("/studio/audit"));
    await expect(page.getByText("media.deletion.completed", { exact: true }).first()).toBeVisible();
  } finally {
    await viewer.close();
  }
});

test("member routes enforce roles and administration remains accessible", async () => {
  test.setTimeout(60_000);
  test.skip(csrfToken === undefined, "E2E test account is not configured");

  const unique = Date.now();
  const reviewerUsername = `reviewer-${unique}`;
  const createdReviewer = await context.request.post(appUrl("/api/v1/users"), {
    data: { username: reviewerUsername, displayName: "自动化审核员", role: "reviewer" },
    headers: internalWriteHeaders(crypto.randomUUID()),
  });
  expect(createdReviewer.status()).toBe(201);
  const reviewer = (await createdReviewer.json()) as {
    generatedTemporaryPassword: string;
  };
  const restrictedAlbumResponse = await context.request.post(appUrl("/api/v1/albums"), {
    data: { title: `角色边界 ${unique}`, description: "角色导航夹具", publishMode: "review" },
    headers: internalWriteHeaders(crypto.randomUUID()),
  });
  expect(restrictedAlbumResponse.status()).toBe(201);
  const restrictedAlbum = (await restrictedAlbumResponse.json()) as {
    album: { id: string; title: string };
  };

  const reviewerContext = await browser.newContext();
  try {
    const login = await reviewerContext.request.post(appUrl("/api/v1/auth/login"), {
      data: { username: reviewerUsername, password: reviewer.generatedTemporaryPassword },
      headers: { origin: baseUrl },
    });
    expect(login.status()).toBe(200);
    const reviewerCsrf = ((await login.json()) as { csrfToken: string }).csrfToken;
    const changed = await reviewerContext.request.post(appUrl("/api/v1/auth/change-password"), {
      data: {
        currentPassword: reviewer.generatedTemporaryPassword,
        newPassword: `Reviewer-${unique}!Pass`,
      },
      headers: { origin: baseUrl, "x-csrf-token": reviewerCsrf },
    });
    expect(changed.status()).toBe(200);
    const currentReviewerCsrf = ((await changed.json()) as { csrfToken: string }).csrfToken;

    const forbiddenUserCreate = await reviewerContext.request.post(appUrl("/api/v1/users"), {
      data: { username: `forbidden-${unique}`, displayName: "不应创建", role: "uploader" },
      headers: {
        origin: baseUrl,
        "x-csrf-token": currentReviewerCsrf,
        "idempotency-key": crypto.randomUUID(),
      },
    });
    expect(forbiddenUserCreate.status()).toBe(403);
    const forbiddenDelete = await reviewerContext.request.delete(
      appUrl(`/api/v1/media/${crypto.randomUUID()}`),
      {
        data: { confirmation: "不应执行" },
        headers: { origin: baseUrl, "x-csrf-token": currentReviewerCsrf },
      },
    );
    expect(forbiddenDelete.status()).toBe(403);

    const reviewerPage = await reviewerContext.newPage();
    await reviewerPage.goto(appUrl("/studio"));
    await expect(reviewerPage.getByRole("button", { name: "创建活动" })).toHaveCount(0);
    await expect(reviewerPage.getByRole("link", { name: "成员" })).toHaveCount(0);
    await expect(reviewerPage.getByRole("link", { name: "审计" })).toHaveCount(0);
    await reviewerPage.goto(appUrl(`/studio/albums/${restrictedAlbum.album.id}`));
    await expect(
      reviewerPage.getByRole("heading", { name: restrictedAlbum.album.title }),
    ).toBeVisible();
    await expect(reviewerPage.getByRole("link", { name: "审核", exact: true })).toBeVisible();
    await expect(reviewerPage.getByRole("link", { name: "上传" })).toHaveCount(0);
    await expect(reviewerPage.getByRole("link", { name: "设置/统计" })).toHaveCount(0);
    await expect(reviewerPage.getByLabel("新增一级分类")).toHaveCount(0);
    await expect(reviewerPage.getByRole("button", { name: /开始直播|结束直播|归档/u })).toHaveCount(
      0,
    );
    await reviewerPage.goto(appUrl("/studio/users"));
    await expect(reviewerPage).toHaveURL(/\/forbidden$/u);
    await expect(reviewerPage.getByRole("heading", { name: "没有访问权限" })).toBeVisible();
    await reviewerPage.close();
  } finally {
    await reviewerContext.close();
  }

  await page.goto(appUrl("/studio/users"));
  await expect(page.getByRole("heading", { name: "成员管理" })).toBeVisible();
  const uploaderUsername = `uploader-${unique}`;
  await page.getByLabel("用户名").fill(uploaderUsername);
  await page.getByLabel("显示名").fill("自动化上传者");
  const createMember = page.getByRole("button", { name: "创建成员" });
  await expectReactHydrated(createMember);
  await createMember.click();
  await expect(page.getByText("请把一次性临时密码安全交给本人")).toBeVisible();
  await expect(page.getByText(uploaderUsername)).toBeVisible();
  await expectNoAxeViolations(page);

  await page.goto(appUrl("/studio/audit"));
  await expect(page.getByRole("heading", { name: "审计" })).toBeVisible();
  await expect(page.getByText("user.created", { exact: true }).first()).toBeVisible();
  await expectNoAxeViolations(page);
});
