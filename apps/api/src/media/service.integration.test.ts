import { fileURLToPath } from "node:url";
import type { CreatePhotoUploadRequest, PhotoVariantKind } from "@photostream/contracts";
import { createDatabase, createPool, migrateDatabase, schema } from "@photostream/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { PostgresAuthStore } from "../auth/postgres-store.js";
import type { PasswordHasher } from "../auth/types.js";
import { loadConfig } from "../config.js";
import { LiveEventBroker } from "./live-event-broker.js";
import type { ObjectMetadata, ObjectStorage, SignedPut } from "./object-storage.js";
import { PhotoService } from "./service.js";

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

class FakeObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, ObjectMetadata>();
  readonly multipartParts = new Map<string, ObjectMetadata>();

  signPut(options: {
    readonly key: string;
    readonly contentType: string;
    readonly bytes: number;
    readonly expiresAt: Date;
  }): SignedPut {
    return {
      url: `https://objects.example/${options.key}`,
      headers: { "content-type": options.contentType },
      expiresAt: options.expiresAt,
    };
  }

  signRead(options: { readonly key: string; readonly expiresAt: Date }): string {
    return `https://cdn.example/${options.key}?expires=${options.expiresAt.getTime()}`;
  }

  signMultipartPart(options: {
    readonly uploadId: string;
    readonly partNumber: number;
    readonly contentType: string;
    readonly bytes: number;
    readonly expiresAt: Date;
  }): SignedPut {
    return {
      url: `https://objects.example/multipart/${options.uploadId}/${options.partNumber}`,
      headers: { "content-type": options.contentType },
      expiresAt: options.expiresAt,
    };
  }

  async completeMultipart(options: {
    readonly uploadId: string;
    readonly key: string;
    readonly contentType: string;
    readonly parts: readonly { readonly partNumber: number; readonly etag: string }[];
  }): Promise<void> {
    const metadata = options.parts.map((part) =>
      this.multipartParts.get(`${options.uploadId}:${part.partNumber}`),
    );
    if (
      metadata.some(
        (part, index) =>
          part === undefined ||
          part.etag !== options.parts[index]?.etag ||
          part.contentType !== options.contentType,
      )
    ) {
      throw new Error("Multipart fixture mismatch");
    }
    this.objects.set(options.key, {
      bytes: metadata.reduce((total, part) => total + (part?.bytes ?? 0), 0),
      contentType: options.contentType,
      etag: "f".repeat(64),
    });
  }

  async head(key: string): Promise<ObjectMetadata | null> {
    return this.objects.get(key) ?? null;
  }
}

const photoRequest = (albumId: string): CreatePhotoUploadRequest => ({
  albumId,
  categoryId: null,
  width: 4_000,
  height: 3_000,
  totalBytes: 4_000_000,
  capturedAt: null,
  variants: [
    {
      kind: "photo_480",
      format: "webp",
      contentType: "image/webp",
      width: 480,
      height: 360,
      bytes: 30_000,
    },
    {
      kind: "photo_960",
      format: "webp",
      contentType: "image/webp",
      width: 960,
      height: 720,
      bytes: 100_000,
    },
    {
      kind: "photo_1920",
      format: "webp",
      contentType: "image/webp",
      width: 1_920,
      height: 1_440,
      bytes: 400_000,
    },
    {
      kind: "photo_original",
      format: "jpeg",
      contentType: "image/jpeg",
      width: 4_000,
      height: 3_000,
      bytes: 4_000_000,
    },
  ],
});

const multipartPhotoRequest = (albumId: string): CreatePhotoUploadRequest => {
  const request = photoRequest(albumId);
  const totalBytes = 17 * 1024 * 1024;
  return {
    ...request,
    totalBytes,
    variants: request.variants.map((variant) =>
      variant.kind === "photo_original" ? { ...variant, bytes: totalBytes } : variant,
    ),
  };
};

maybeDescribe("photo vertical slice transactions", () => {
  const pool = createPool(databaseUrl ?? "");
  const database = createDatabase(pool);
  const storage = new FakeObjectStorage();
  const service = new PhotoService({ database, storage, passwordHasher: fakeHasher, config });
  let adminId = "";
  let reviewerId = "";
  let uploaderId = "";

  beforeAll(async () => {
    await migrateDatabase(
      pool,
      fileURLToPath(new URL("../../../../packages/db/drizzle", import.meta.url)),
    );
  });

  beforeEach(async () => {
    storage.objects.clear();
    storage.multipartParts.clear();
    await database.delete(schema.liveEvents);
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
    const inserted = await database
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
    adminId = inserted.find((user) => user.role === "admin")?.id ?? "";
    reviewerId = inserted.find((user) => user.role === "reviewer")?.id ?? "";
    uploaderId = inserted.find((user) => user.role === "uploader")?.id ?? "";
  });

  afterAll(async () => pool.end());

  it("moves one photo through review publication and persistent public replay", async () => {
    const first = await service.createAlbum({
      actor: { id: adminId, role: "admin" },
      input: { title: "运动会", description: "", publishMode: "review" },
      idempotencyKey: "album-idempotency-0001",
      requestId: "request-album-1",
    });
    const retried = await service.createAlbum({
      actor: { id: adminId, role: "admin" },
      input: { title: "运动会", description: "", publishMode: "review" },
      idempotencyKey: "album-idempotency-0001",
      requestId: "request-album-2",
    });
    expect(retried).toEqual(first);
    expect(first.album.access).toBe("password");
    expect(first.album.previewDownloadEnabled).toBe(false);
    await service.startAlbum({
      actor: { id: adminId, role: "admin" },
      albumId: first.album.id,
      requestId: "request-start",
    });

    const intent = await service.createPhotoUpload({
      actor: { id: uploaderId, role: "uploader" },
      input: photoRequest(first.album.id),
      idempotencyKey: "photo-idempotency-0001",
    });
    expect(
      await service.createPhotoUpload({
        actor: { id: uploaderId, role: "uploader" },
        input: photoRequest(first.album.id),
        idempotencyKey: "photo-idempotency-0001",
      }),
    ).toEqual(intent);

    const byKind = new Map(intent.objects.map((object) => [object.kind, object]));
    const complete = async (kind: PhotoVariantKind) => {
      const object = byKind.get(kind);
      if (object === undefined) throw new Error(`Missing ${kind}`);
      storage.objects.set(object.objectKey, {
        bytes: object.expectedBytes,
        contentType: object.contentType,
        etag: `etag-${kind}`,
      });
      return service.completeUploadObject({
        actor: { id: uploaderId, role: "uploader" },
        intentId: intent.id,
        kind,
      });
    };

    expect((await complete("photo_480")).publicationStatus).toBe("draft");
    const preview = await complete("photo_960");
    expect(preview.ingestStatus).toBe("preview_ready");
    expect(preview.publicationStatus).toBe("pending_review");

    await service.publishMedia({
      actor: { id: reviewerId, role: "reviewer" },
      mediaId: intent.mediaId,
      requestId: "request-publish",
    });
    await service.signUpload({
      actor: { id: uploaderId, role: "uploader" },
      intentId: intent.id,
      kind: "photo_1920",
    });
    await complete("photo_1920");
    expect(
      (await service.getUploadIntent({ id: uploaderId, role: "uploader" }, intent.id)).ingestStatus,
    ).toBe("uploading_source");
    const ready = await complete("photo_original");
    expect(ready.ingestStatus).toBe("ready");
    expect(ready.publicationStatus).toBe("published");

    await expect(service.unlockAlbum(first.album.slug, "wrong-password")).rejects.toMatchObject({
      code: "ALBUM_PASSWORD_INVALID",
    });
    const visitor = await service.unlockAlbum(first.album.slug, first.generatedPassword);
    const publicMedia = await service.listPublicMedia({
      slug: first.album.slug,
      visitorToken: visitor.rawToken,
      cursor: undefined,
      categoryId: undefined,
      limit: 60,
    });
    expect(publicMedia.items).toHaveLength(1);
    expect(publicMedia.items[0]?.variants.map((variant) => variant.kind).sort()).toEqual([
      "photo_1920",
      "photo_480",
      "photo_960",
    ]);
    expect(JSON.stringify(publicMedia)).not.toContain("photo_original");

    const replay = await new PhotoService({
      database,
      storage,
      passwordHasher: fakeHasher,
      config,
    }).listLiveEvents({
      slug: first.album.slug,
      visitorToken: visitor.rawToken,
      afterId: 0,
    });
    expect(replay.events.map((event) => event.type)).toEqual(["media.published", "media.updated"]);
  });

  it("rejects another uploader and verifies exact object metadata", async () => {
    const album = await service.createAlbum({
      actor: { id: adminId, role: "admin" },
      input: { title: "自动发布", description: "", publishMode: "auto" },
      idempotencyKey: "album-idempotency-0002",
      requestId: "request-album-auto",
    });
    await service.startAlbum({
      actor: { id: adminId, role: "admin" },
      albumId: album.album.id,
      requestId: "request-start-auto",
    });
    const intent = await service.createPhotoUpload({
      actor: { id: uploaderId, role: "uploader" },
      input: photoRequest(album.album.id),
      idempotencyKey: "photo-idempotency-0002",
    });
    await expect(
      service.getUploadIntent({ id: reviewerId, role: "uploader" }, intent.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const object = intent.objects.find((candidate) => candidate.kind === "photo_480");
    if (object === undefined) throw new Error("Missing preview object");
    storage.objects.set(object.objectKey, {
      bytes: object.expectedBytes + 1,
      contentType: object.contentType,
      etag: "wrong-size",
    });
    await expect(
      service.completeUploadObject({
        actor: { id: uploaderId, role: "uploader" },
        intentId: intent.id,
        kind: "photo_480",
      }),
    ).rejects.toMatchObject({ code: "OBJECT_VERIFICATION_FAILED" });
  });

  it("persists and completes an immutable multipart original", async () => {
    const album = await service.createAlbum({
      actor: { id: adminId, role: "admin" },
      input: { title: "分片原图", description: "", publishMode: "auto" },
      idempotencyKey: "album-idempotency-multipart",
      requestId: "request-album-multipart",
    });
    await service.startAlbum({
      actor: { id: adminId, role: "admin" },
      albumId: album.album.id,
      requestId: "request-start-multipart",
    });
    const intent = await service.createPhotoUpload({
      actor: { id: uploaderId, role: "uploader" },
      input: multipartPhotoRequest(album.album.id),
      idempotencyKey: "photo-idempotency-multipart",
    });
    const original = intent.objects.find((object) => object.kind === "photo_original");
    if (original === undefined || original.multipartUploadId === null) {
      throw new Error("Missing multipart original");
    }
    expect(original.uploadMode).toBe("multipart");
    expect(original.parts.map((part) => part.expectedBytes)).toEqual([
      8 * 1024 * 1024,
      8 * 1024 * 1024,
      1024 * 1024,
    ]);
    await expect(
      service.signUpload({
        actor: { id: uploaderId, role: "uploader" },
        intentId: intent.id,
        kind: "photo_original",
      }),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });

    for (const part of original.parts) {
      const etag = part.partNumber.toString(16).repeat(64).slice(0, 64);
      storage.multipartParts.set(`${original.multipartUploadId}:${part.partNumber}`, {
        bytes: part.expectedBytes,
        contentType: original.contentType,
        etag,
      });
      await service.signUploadPart({
        actor: { id: uploaderId, role: "uploader" },
        intentId: intent.id,
        kind: "photo_original",
        partNumber: part.partNumber,
      });
      await service.completeUploadPart({
        actor: { id: uploaderId, role: "uploader" },
        intentId: intent.id,
        kind: "photo_original",
        partNumber: part.partNumber,
        etag,
      });
    }
    const completed = await service.completeUploadObject({
      actor: { id: uploaderId, role: "uploader" },
      intentId: intent.id,
      kind: "photo_original",
    });
    expect(completed.objects.find((object) => object.kind === "photo_original")?.completed).toBe(
      true,
    );
  });

  it("exposes the runtime REST contract without accepting media bodies", async () => {
    const app = await buildApp({
      config,
      authStore: new PostgresAuthStore(database),
      passwordHasher: fakeHasher,
      photoService: service,
      broker: new LiveEventBroker(),
      logger: false,
    });
    const headers = { host: "localhost:3000", origin: "http://localhost:3000" };
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers,
      payload: { username: "admin", password: "admin-password" },
    });
    expect(login.statusCode).toBe(200);
    const session = login.json<{ csrfToken: string }>();
    const setCookie = login.headers["set-cookie"];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(";", 1)[0];
    if (cookie === undefined) throw new Error("Missing login cookie");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/albums",
      headers: {
        ...headers,
        cookie,
        "x-csrf-token": session.csrfToken,
        "idempotency-key": "http-album-idempotency-1",
      },
      payload: { title: "HTTP 相册", description: "", publishMode: "auto" },
    });
    expect(created.statusCode).toBe(201);
    expect(JSON.stringify(created.json())).not.toContain("passwordHash");

    const binary = await app.inject({
      method: "POST",
      url: "/api/v1/uploads",
      headers: {
        ...headers,
        cookie,
        "x-csrf-token": session.csrfToken,
        "content-type": "image/jpeg",
      },
      payload: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    });
    expect(binary.statusCode).toBe(400);

    const openApi = await app.inject({
      method: "GET",
      url: "/api/v1/openapi.json",
      headers,
    });
    const document = openApi.json<{ paths: Record<string, unknown> }>();
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining([
        "/api/v1/albums",
        "/api/v1/uploads",
        "/api/v1/public/albums/{slug}/media",
        "/api/v1/public/albums/{slug}/events",
      ]),
    );
    await app.close();
  });
});
