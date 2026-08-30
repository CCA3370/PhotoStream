import { fileURLToPath } from "node:url";

import type { MediaBatchRequest } from "@photostream/contracts";
import { createDatabase, createPool, migrateDatabase, schema } from "@photostream/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PasswordHasher } from "../auth/types.js";
import { UserAdminService } from "../auth/user-admin-service.js";
import { loadConfig } from "../config.js";
import type { CdnInvalidator } from "./cdn-invalidator.js";
import type { ObjectMetadata, ObjectStorage, SignedPut } from "./object-storage.js";
import { OperationsService } from "./operations-service.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl !== undefined && new URL(databaseUrl).pathname !== "/photostream_test") {
  throw new Error("TEST_DATABASE_URL must target the dedicated photostream_test database");
}
const maybeDescribe = databaseUrl === undefined ? describe.skip : describe;

const config = loadConfig({
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: "3001",
  APP_ORIGIN: "http://localhost:3000",
  MEDIA_BASE_URL: "https://cdn.cloverta.top",
  DATABASE_URL: databaseUrl ?? "postgresql://invalid/photostream_test",
  SESSION_SECRET_CURRENT: "s".repeat(32),
  CSRF_SECRET: "c".repeat(32),
  CURSOR_SIGNING_SECRET: "u".repeat(32),
  VISITOR_SESSION_SECRET: "v".repeat(32),
  ALBUM_PASSWORD_GENERATION_SECRET: "a".repeat(32),
  USER_PASSWORD_GENERATION_SECRET: "w".repeat(32),
  ANALYTICS_HMAC_SECRET: "n".repeat(32),
  LOCAL_OBJECT_SECRET: "o".repeat(32),
  LOCAL_OBJECT_BASE_URL: "http://127.0.0.1:3002",
});

const fakeHasher: PasswordHasher = {
  async hash(value) {
    return `hash:${value}`;
  },
  async verify(hash, value) {
    return hash === `hash:${value}`;
  },
};

class FakeStorage implements ObjectStorage {
  readonly objects = new Map<string, ObjectMetadata>();
  readonly failDeleteOnce = new Set<string>();

  signPut(options: {
    readonly key: string;
    readonly contentType: string;
    readonly bytes: number;
    readonly expiresAt: Date;
  }): SignedPut {
    return {
      url: `https://objects.invalid/${options.key}`,
      headers: { "content-type": options.contentType },
      expiresAt: options.expiresAt,
    };
  }

  signRead(options: { readonly key: string; readonly expiresAt: Date }): string {
    return `https://cdn.cloverta.top/${options.key}?expires=${options.expiresAt.getTime()}`;
  }

  signMultipartPart(options: {
    readonly uploadId: string;
    readonly partNumber: number;
    readonly contentType: string;
    readonly bytes: number;
    readonly expiresAt: Date;
  }): SignedPut {
    return {
      url: `https://objects.invalid/${options.uploadId}/${options.partNumber}`,
      headers: { "content-type": options.contentType },
      expiresAt: options.expiresAt,
    };
  }

  async completeMultipart(): Promise<void> {
    throw new Error("not used");
  }

  async head(key: string): Promise<ObjectMetadata | null> {
    return this.objects.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    if (this.failDeleteOnce.delete(key)) throw new Error("synthetic delete failure");
    this.objects.delete(key);
  }
}

class FakeCdn implements CdnInvalidator {
  failNext = false;
  readonly invalidations: string[][] = [];

  async invalidate(paths: readonly string[]): Promise<void> {
    this.invalidations.push([...paths]);
    if (this.failNext) {
      this.failNext = false;
      throw new Error("synthetic CDN failure");
    }
  }
}

maybeDescribe("stage 3 operations", () => {
  const pool = createPool(databaseUrl ?? "");
  const database = createDatabase(pool);
  const storage = new FakeStorage();
  const cdn = new FakeCdn();
  const service = new OperationsService({ database, storage, cdnInvalidator: cdn, config });
  const userService = new UserAdminService({ database, passwordHasher: fakeHasher, config });
  let adminId = "";
  let reviewerId = "";
  let uploaderId = "";
  let albumId = "";
  let otherAlbumId = "";
  let categoryId = "";

  beforeAll(async () => {
    await migrateDatabase(
      pool,
      fileURLToPath(new URL("../../../../packages/db/drizzle", import.meta.url)),
    );
  });

  beforeEach(async () => {
    storage.objects.clear();
    storage.failDeleteOnce.clear();
    cdn.failNext = false;
    cdn.invalidations.length = 0;
    await database.delete(schema.liveEvents);
    await database.delete(schema.analyticsEvents);
    await database.delete(schema.analyticsDaily);
    await database.delete(schema.deletionTaskObjects);
    await database.delete(schema.deletionTasks);
    await database.delete(schema.mediaBatchRequests);
    await database.delete(schema.operationRequests);
    await database.delete(schema.uploadParts);
    await database.delete(schema.mediaVariants);
    await database.delete(schema.uploadIntents);
    await database.delete(schema.media);
    await database.delete(schema.visitorSessions);
    await database.delete(schema.categories);
    await database.delete(schema.albums);
    await database.delete(schema.auditLogs);
    await database.delete(schema.sessions);
    await database.delete(schema.users);
    const users = await database
      .insert(schema.users)
      .values([
        {
          username: "admin",
          normalizedUsername: "admin",
          displayName: "管理员",
          role: "admin",
          passwordHash: "hash:admin-password",
          mustChangePassword: false,
        },
        {
          username: "reviewer",
          normalizedUsername: "reviewer",
          displayName: "审核员",
          role: "reviewer",
          passwordHash: "hash:reviewer-password",
          mustChangePassword: false,
        },
        {
          username: "uploader",
          normalizedUsername: "uploader",
          displayName: "上传者",
          role: "uploader",
          passwordHash: "hash:uploader-password",
          mustChangePassword: false,
        },
      ])
      .returning({ id: schema.users.id, role: schema.users.role });
    adminId = users.find((user) => user.role === "admin")?.id ?? "";
    reviewerId = users.find((user) => user.role === "reviewer")?.id ?? "";
    uploaderId = users.find((user) => user.role === "uploader")?.id ?? "";
    const albums = await database
      .insert(schema.albums)
      .values([
        {
          slug: "operations-album-one",
          title: "运营相册",
          description: "",
          state: "live",
          access: "public",
          publishMode: "review",
          idempotencyKey: "operations-album-one-key",
          createdBy: adminId,
        },
        {
          slug: "operations-album-two",
          title: "另一相册",
          description: "",
          state: "live",
          access: "public",
          publishMode: "review",
          idempotencyKey: "operations-album-two-key",
          createdBy: adminId,
        },
      ])
      .returning({ id: schema.albums.id, title: schema.albums.title });
    albumId = albums.find((album) => album.title === "运营相册")?.id ?? "";
    otherAlbumId = albums.find((album) => album.title === "另一相册")?.id ?? "";
    const [category] = await database
      .insert(schema.categories)
      .values({
        albumId: otherAlbumId,
        name: "跨相册分类",
        idempotencyKey: "operations-category-key",
        createdBy: adminId,
      })
      .returning({ id: schema.categories.id });
    categoryId = category?.id ?? "";
  });

  afterAll(async () => pool.end());

  it("returns stable per-item batch results and never replays successful mutations", async () => {
    const media = await database
      .insert(schema.media)
      .values([
        {
          albumId,
          uploaderId,
          ingestStatus: "preview_ready",
          publicationStatus: "pending_review",
          width: 100,
          height: 100,
          mediaType: "image/jpeg",
          totalBytes: 100,
        },
        {
          albumId,
          uploaderId,
          ingestStatus: "uploading_preview",
          publicationStatus: "draft",
          width: 100,
          height: 100,
          mediaType: "image/jpeg",
          totalBytes: 100,
        },
      ])
      .returning({ id: schema.media.id });
    const missingId = "019d0000-0000-7000-8000-000000009999";
    const input: MediaBatchRequest = {
      action: "publish",
      mediaIds: [media[0]?.id ?? "", media[1]?.id ?? "", missingId],
    };
    const first = await service.applyBatch({
      actor: { id: reviewerId, role: "reviewer" },
      input,
      idempotencyKey: "batch-publish-idempotency",
      requestId: "batch-request-1",
    });
    expect(first.items.map((item) => [item.ok, item.code])).toEqual([
      [true, null],
      [false, "STATE_CONFLICT"],
      [false, "MEDIA_NOT_FOUND"],
    ]);
    const auditBeforeRetry = await database.select().from(schema.auditLogs);
    const retried = await service.applyBatch({
      actor: { id: reviewerId, role: "reviewer" },
      input,
      idempotencyKey: "batch-publish-idempotency",
      requestId: "batch-request-2",
    });
    expect(retried).toEqual(first);
    expect(await database.select().from(schema.auditLogs)).toHaveLength(auditBeforeRetry.length);
    await expect(
      service.applyBatch({
        actor: { id: reviewerId, role: "reviewer" },
        input: { action: "hide", mediaIds: [media[0]?.id ?? ""] },
        idempotencyKey: "batch-publish-idempotency",
        requestId: "batch-request-3",
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const categoryResult = await service.applyBatch({
      actor: { id: reviewerId, role: "reviewer" },
      input: { action: "change_category", mediaIds: [media[0]?.id ?? ""], categoryId },
      idempotencyKey: "batch-category-idempotency",
      requestId: "batch-category",
    });
    expect(categoryResult.items[0]).toMatchObject({ ok: false, code: "BAD_REQUEST" });

    const [sameAlbumCategory] = await database
      .insert(schema.categories)
      .values({
        albumId,
        name: "本相册分类",
        idempotencyKey: "same-album-category-key",
        createdBy: adminId,
      })
      .returning({ id: schema.categories.id });
    if (sameAlbumCategory === undefined) throw new Error("category fixture missing");
    const successfulCategory = await service.applyBatch({
      actor: { id: reviewerId, role: "reviewer" },
      input: {
        action: "change_category",
        mediaIds: [media[0]?.id ?? ""],
        categoryId: sameAlbumCategory.id,
      },
      idempotencyKey: "batch-category-success-idempotency",
      requestId: "batch-category-success",
    });
    expect(successfulCategory.items[0]?.ok).toBe(true);
    expect(
      (await database.select().from(schema.liveEvents)).some(
        (event) => event.type === "media.updated" && event.mediaId === media[0]?.id,
      ),
    ).toBe(true);
  });

  it("serializes concurrent reviewers so one media receives one publication sequence", async () => {
    const [media] = await database
      .insert(schema.media)
      .values({
        albumId,
        uploaderId,
        ingestStatus: "preview_ready",
        publicationStatus: "pending_review",
        width: 100,
        height: 100,
        mediaType: "image/jpeg",
        totalBytes: 100,
      })
      .returning({ id: schema.media.id });
    if (media === undefined) throw new Error("media fixture missing");

    const [reviewerResult, adminResult] = await Promise.all([
      service.applyBatch({
        actor: { id: reviewerId, role: "reviewer" },
        input: { action: "publish", mediaIds: [media.id] },
        idempotencyKey: "concurrent-reviewer-publication",
        requestId: "concurrent-reviewer-request",
      }),
      service.applyBatch({
        actor: { id: adminId, role: "admin" },
        input: { action: "publish", mediaIds: [media.id] },
        idempotencyKey: "concurrent-admin-publication",
        requestId: "concurrent-admin-request",
      }),
    ]);
    expect(reviewerResult.items[0]?.ok).toBe(true);
    expect(adminResult.items[0]?.ok).toBe(true);

    const [storedMedia] = await database
      .select({ publishSequence: schema.media.publishSequence })
      .from(schema.media)
      .where(eq(schema.media.id, media.id));
    const [storedAlbum] = await database
      .select({ publishSequence: schema.albums.publishSequence })
      .from(schema.albums)
      .where(eq(schema.albums.id, albumId));
    expect(storedMedia?.publishSequence).toBe(1);
    expect(storedAlbum?.publishSequence).toBe(1);
    expect(
      (await database.select().from(schema.liveEvents)).filter(
        (event) => event.type === "media.published" && event.mediaId === media.id,
      ),
    ).toHaveLength(1);
    expect(
      (await database.select().from(schema.auditLogs)).filter(
        (entry) => entry.action === "media.published" && entry.targetId === media.id,
      ),
    ).toHaveLength(1);
  });

  it("keeps failed deletion recoverable until objects and CDN invalidation both succeed", async () => {
    const [media] = await database
      .insert(schema.media)
      .values({
        albumId,
        uploaderId,
        ingestStatus: "ready",
        publicationStatus: "published",
        width: 100,
        height: 100,
        mediaType: "image/jpeg",
        totalBytes: 300,
        publishSequence: 1,
        publishedAt: new Date(),
      })
      .returning({ id: schema.media.id });
    if (media === undefined) throw new Error("media fixture missing");
    const keys = ["media/delete/480.webp", "media/delete/original.jpg"];
    await database.insert(schema.mediaVariants).values([
      {
        mediaId: media.id,
        kind: "photo_480",
        objectKey: keys[0] as string,
        format: "webp",
        contentType: "image/webp",
        width: 100,
        height: 100,
        expectedBytes: 100,
        bytes: 100,
        verified: true,
      },
      {
        mediaId: media.id,
        kind: "photo_original",
        objectKey: keys[1] as string,
        format: "jpeg",
        contentType: "image/jpeg",
        width: 100,
        height: 100,
        expectedBytes: 200,
        bytes: 200,
        verified: true,
      },
    ]);
    for (const key of keys) {
      storage.objects.set(key, { bytes: 1, contentType: "image/jpeg", etag: key });
    }
    storage.failDeleteOnce.add(keys[1] as string);
    const now = new Date();
    const failedObjects = await service.requestDeletion({
      actor: { id: adminId, role: "admin", authenticatedAt: now },
      mediaId: media.id,
      confirmation: "运营相册",
      requestId: "delete-request",
      now,
    });
    expect(failedObjects).toMatchObject({
      status: "failed",
      lastErrorCode: "OBJECT_DELETE_FAILED",
    });
    expect(
      (await database.select().from(schema.media).where(eq(schema.media.id, media.id)))[0]
        ?.publicationStatus,
    ).toBe("hidden");
    expect(await database.select().from(schema.mediaVariants)).toHaveLength(2);

    cdn.failNext = true;
    const failedCdn = await service.retryDeletion({
      actor: { id: adminId, role: "admin", authenticatedAt: now },
      taskId: failedObjects.id,
      now: new Date(now.getTime() + 1_000),
    });
    expect(failedCdn).toMatchObject({ status: "failed", lastErrorCode: "CDN_INVALIDATION_FAILED" });
    expect(await database.select().from(schema.mediaVariants)).toHaveLength(2);

    const completed = await service.retryDeletion({
      actor: { id: adminId, role: "admin", authenticatedAt: now },
      taskId: failedObjects.id,
      now: new Date(now.getTime() + 2_000),
    });
    expect(completed.status).toBe("completed");
    expect(await database.select().from(schema.mediaVariants)).toHaveLength(0);
    expect(
      (await database.select().from(schema.media).where(eq(schema.media.id, media.id)))[0]
        ?.publicationStatus,
    ).toBe("deleted");
    expect(
      (await database.select().from(schema.deletionTaskObjects)).every(
        (object) => object.objectKey === null && object.status === "deleted",
      ),
    ).toBe(true);
    expect(JSON.stringify(await database.select().from(schema.auditLogs))).not.toContain(
      "media/delete",
    );
  });

  it("enforces download switches and keeps anonymous analytics unlinkable from raw visitors", async () => {
    const [media] = await database
      .insert(schema.media)
      .values({
        albumId,
        uploaderId,
        ingestStatus: "ready",
        publicationStatus: "published",
        width: 100,
        height: 100,
        mediaType: "image/jpeg",
        totalBytes: 200,
        publishSequence: 1,
        publishedAt: new Date(),
      })
      .returning({ id: schema.media.id });
    if (media === undefined) throw new Error("media fixture missing");
    await database.insert(schema.mediaVariants).values({
      mediaId: media.id,
      kind: "photo_1920",
      objectKey: "media/download/1920.webp",
      format: "webp",
      contentType: "image/webp",
      width: 100,
      height: 100,
      expectedBytes: 200,
      bytes: 200,
      verified: true,
    });
    await expect(
      service.issueDownload({
        slug: "operations-album-one",
        visitorToken: undefined,
        mediaId: media.id,
        kind: "preview",
        visitorId: "raw-visitor-token",
        idempotencyKey: "download-disabled-key",
      }),
    ).rejects.toMatchObject({ code: "DOWNLOAD_DISABLED" });
    await database
      .update(schema.albums)
      .set({ previewDownloadEnabled: true })
      .where(eq(schema.albums.id, albumId));
    const issued = await service.issueDownload({
      slug: "operations-album-one",
      visitorToken: undefined,
      mediaId: media.id,
      kind: "preview",
      visitorId: "raw-visitor-token",
      idempotencyKey: "download-success-key",
    });
    expect(issued.url).toContain("expires=");
    expect(issued.url).not.toContain("photo_original");
    await service.recordOpen({
      slug: "operations-album-one",
      visitorToken: undefined,
      visitorId: "raw-visitor-token",
    });
    const analytics = await database.select().from(schema.analyticsEvents);
    expect(JSON.stringify(analytics)).not.toContain("raw-visitor-token");
    expect(new Set(analytics.map((event) => event.visitorDigest)).size).toBe(1);
    const statistics = await service.albumStatistics({ id: reviewerId, role: "reviewer" }, albumId);
    expect(statistics).toMatchObject({ downloads: 1, opens: 1, uniqueVisitors: 1 });
    await service.recordAnalytics({
      albumId,
      visitorId: "old-visitor",
      eventType: "open",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(await service.cleanupAnalytics(new Date("2026-02-15T00:00:00.000Z"))).toBe(1);
  });

  it("creates members idempotently, revokes changed sessions and guards the last admin", async () => {
    const created = await userService.createUser({
      actor: { id: adminId, role: "admin" },
      input: { username: "photo.user", displayName: "摄影老师", role: "reviewer" },
      idempotencyKey: "create-user-idempotency",
      requestId: "create-user",
    });
    expect(created.generatedTemporaryPassword).toHaveLength(21);
    expect(
      await userService.createUser({
        actor: { id: adminId, role: "admin" },
        input: { username: "photo.user", displayName: "摄影老师", role: "reviewer" },
        idempotencyKey: "create-user-idempotency",
        requestId: "create-user-retry",
      }),
    ).toEqual(created);
    await expect(
      userService.createUser({
        actor: { id: adminId, role: "admin" },
        input: { username: "another.user", displayName: "另一位老师", role: "uploader" },
        idempotencyKey: "create-user-idempotency",
        requestId: "create-user-conflict",
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await database.insert(schema.sessions).values({
      tokenHash: "f".repeat(64),
      userId: created.user.id,
      idleExpiresAt: new Date(Date.now() + 60_000),
      absoluteExpiresAt: new Date(Date.now() + 120_000),
    });
    expect(
      await userService.updateUser({
        actor: { id: adminId, role: "admin" },
        userId: created.user.id,
        input: { role: "reviewer", isActive: true },
        requestId: "update-user-noop",
      }),
    ).toMatchObject({ role: "reviewer", isActive: true });
    expect((await database.select().from(schema.sessions))[0]?.revokedAt).toBeNull();
    const updated = await userService.updateUser({
      actor: { id: adminId, role: "admin" },
      userId: created.user.id,
      input: { role: "uploader", isActive: false },
      requestId: "update-user",
    });
    expect(updated).toMatchObject({ role: "uploader", isActive: false });
    expect((await database.select().from(schema.sessions))[0]?.revokedAt).not.toBeNull();
    await expect(
      userService.updateUser({
        actor: { id: adminId, role: "admin" },
        userId: adminId,
        input: { isActive: false },
        requestId: "disable-last-admin",
      }),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });
    const now = new Date();
    const temporary = await userService.resetPassword({
      actor: { id: adminId, role: "admin", authenticatedAt: now },
      userId: created.user.id,
      idempotencyKey: "reset-user-password-key",
      requestId: "reset-user",
      now,
    });
    expect(temporary).toHaveLength(21);
    await expect(
      userService.resetPassword({
        actor: {
          id: adminId,
          role: "admin",
          authenticatedAt: new Date(now.getTime() - 16 * 60 * 1_000),
        },
        userId: created.user.id,
        idempotencyKey: "stale-reset-password-key",
        requestId: "stale-reset",
        now,
      }),
    ).rejects.toMatchObject({ code: "RECENT_AUTH_REQUIRED" });
  });
});
