import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { createDatabase, createPool, migrateDatabase, schema } from "@photostream/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PasswordHasher } from "../auth/types.js";
import { loadConfig } from "../config.js";
import { LocalObjectStorage } from "./object-storage.js";
import { PhotoService } from "./service.js";
import { PhotoShareService } from "./share-service.js";

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

maybeDescribe("single-photo sharing", () => {
  const pool = createPool(databaseUrl ?? "");
  const database = createDatabase(pool);
  const storage = new LocalObjectStorage({
    baseUrl: config.LOCAL_OBJECT_BASE_URL,
    secret: config.LOCAL_OBJECT_SECRET as string,
  });
  const photoService = new PhotoService({
    database,
    storage,
    passwordHasher: fakeHasher,
    config,
  });
  const shareService = new PhotoShareService({ database, storage, photoService });
  let adminId = "";

  beforeAll(async () => {
    await migrateDatabase(
      pool,
      fileURLToPath(new URL("../../../../packages/db/drizzle", import.meta.url)),
    );
  });

  beforeEach(async () => {
    await database.delete(schema.liveEvents);
    await database.delete(schema.analyticsEvents);
    await database.delete(schema.analyticsDaily);
    await database.delete(schema.deletionTaskObjects);
    await database.delete(schema.deletionTasks);
    await database.delete(schema.mediaBatchRequests);
    await database.delete(schema.operationRequests);
    await database.delete(schema.photoShares);
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

    const [admin] = await database
      .insert(schema.users)
      .values({
        username: "share-admin",
        normalizedUsername: "share-admin",
        displayName: "分享测试管理员",
        role: "admin",
        passwordHash: "hash:admin-password",
        mustChangePassword: false,
      })
      .returning({ id: schema.users.id });
    if (admin === undefined) throw new Error("Failed to create share test admin");
    adminId = admin.id;
  });

  afterAll(async () => pool.end());

  it("lets a capability open only its bound photo and invalidates it with accessVersion", async () => {
    const [album] = await database
      .insert(schema.albums)
      .values({
        slug: "share-album-one",
        title: "分享测试相册",
        description: "",
        state: "live",
        access: "password",
        publishMode: "review",
        passwordHash: "hash:album-password",
        idempotencyKey: "share-album-idempotency",
        createdBy: adminId,
      })
      .returning({
        id: schema.albums.id,
        slug: schema.albums.slug,
        accessVersion: schema.albums.accessVersion,
      });
    if (album === undefined) throw new Error("Failed to create share test album");

    const now = new Date();
    const [media] = await database
      .insert(schema.media)
      .values({
        albumId: album.id,
        uploaderId: adminId,
        ingestStatus: "ready",
        publicationStatus: "published",
        width: 1_920,
        height: 1_080,
        mediaType: "image/jpeg",
        totalBytes: 4_000_000,
        publishSequence: 1,
        publishedAt: now,
      })
      .returning({ id: schema.media.id });
    if (media === undefined) throw new Error("Failed to create share test media");

    await database.insert(schema.mediaVariants).values([
      {
        mediaId: media.id,
        kind: "photo_960",
        objectKey: `albums/${album.id}/media/${media.id}/photo_960.webp`,
        format: "webp",
        contentType: "image/webp",
        width: 960,
        height: 540,
        expectedBytes: 100_000,
        bytes: 100_000,
        etag: "share-960",
        verified: true,
        completedAt: now,
      },
      {
        mediaId: media.id,
        kind: "photo_1920",
        objectKey: `albums/${album.id}/media/${media.id}/photo_1920.webp`,
        format: "webp",
        contentType: "image/webp",
        width: 1_920,
        height: 1_080,
        expectedBytes: 400_000,
        bytes: 400_000,
        etag: "share-1920",
        verified: true,
        completedAt: now,
      },
      {
        mediaId: media.id,
        kind: "photo_original",
        objectKey: `albums/${album.id}/media/${media.id}/original.jpg`,
        format: "jpeg",
        contentType: "image/jpeg",
        width: 1_920,
        height: 1_080,
        expectedBytes: 4_000_000,
        bytes: 4_000_000,
        etag: "share-original",
        verified: true,
        completedAt: now,
      },
    ]);

    await expect(
      shareService.createShare({
        slug: album.slug,
        visitorToken: undefined,
        mediaId: media.id,
      }),
    ).rejects.toMatchObject({ code: "ALBUM_PASSWORD_INVALID" });

    const visitor = await photoService.unlockAlbum(album.slug, "album-password");
    const share = await shareService.createShare({
      slug: album.slug,
      visitorToken: visitor.rawToken,
      mediaId: media.id,
    });

    const shared = await shareService.getSharedMedia({
      slug: album.slug,
      mediaId: media.id,
      shareId: share.shareId,
    });
    expect(shared.id).toBe(media.id);
    expect(shared.variants.map((variant) => variant.kind).sort()).toEqual([
      "photo_1920",
      "photo_960",
    ]);
    expect(shared.downloads).toEqual({
      preview: false,
      original: false,
      originalBytes: null,
    });
    expect(JSON.stringify(shared)).not.toContain("photo_original");

    const refreshed = await shareService.refreshSharedVariant({
      slug: album.slug,
      mediaId: media.id,
      shareId: share.shareId,
      kind: "photo_1920",
    });
    expect(refreshed.bytes).toBe(400_000);
    expect(refreshed.url).toContain("http://127.0.0.1:3002");

    await expect(
      photoService.listPublicMedia({
        slug: album.slug,
        visitorToken: share.shareId,
        cursor: undefined,
        categoryId: undefined,
        limit: 60,
      }),
    ).rejects.toMatchObject({ code: "ALBUM_PASSWORD_INVALID" });

    await expect(
      shareService.getSharedMedia({
        slug: album.slug,
        mediaId: randomUUID(),
        shareId: share.shareId,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await database
      .update(schema.albums)
      .set({ accessVersion: album.accessVersion + 1 })
      .where(eq(schema.albums.id, album.id));

    await expect(
      shareService.getSharedMedia({
        slug: album.slug,
        mediaId: media.id,
        shareId: share.shareId,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
