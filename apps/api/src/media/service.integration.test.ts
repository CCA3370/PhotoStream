import { fileURLToPath } from "node:url";
import type { CreatePhotoUploadRequest, PhotoVariantKind } from "@photostream/contracts";
import { createDatabase, createPool, migrateDatabase, schema } from "@photostream/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { PostgresAuthStore } from "../auth/postgres-store.js";
import type { PasswordHasher } from "../auth/types.js";
import { UserAdminService } from "../auth/user-admin-service.js";
import { loadConfig } from "../config.js";
import { AlbumDataSaverService } from "./album-data-saver-service.js";
import { MediaEditService } from "./edit-service.js";
import { LiveEventBroker } from "./live-event-broker.js";
import type { ObjectMetadata, ObjectStorage, SignedPut } from "./object-storage.js";
import { OperationsService } from "./operations-service.js";
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

class FakeObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, ObjectMetadata>();
  readonly multipartParts = new Map<string, ObjectMetadata>();
  readonly abortedMultipart = new Set<string>();
  readonly failDeleteOnce = new Set<string>();

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

  async abortMultipart(uploadId: string): Promise<void> {
    this.abortedMultipart.add(uploadId);
    for (const key of this.multipartParts.keys()) {
      if (key.startsWith(`${uploadId}:`)) this.multipartParts.delete(key);
    }
  }

  async head(key: string): Promise<ObjectMetadata | null> {
    return this.objects.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    if (this.failDeleteOnce.delete(key)) throw new Error("synthetic cleanup failure");
    this.objects.delete(key);
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
  const dataSaverService = new AlbumDataSaverService({ database });
  const editService = new MediaEditService({ database, storage });
  const operationsService = new OperationsService({ database, storage, config });
  const userAdminService = new UserAdminService({ database, passwordHasher: fakeHasher, config });
  let adminId = "";
  let operatorId = "";
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
    storage.abortedMultipart.clear();
    storage.failDeleteOnce.clear();
    await database.delete(schema.liveEvents);
    await database.delete(schema.analyticsEvents);
    await database.delete(schema.analyticsDaily);
    await database.delete(schema.deletionTaskObjects);
    await database.delete(schema.deletionTasks);
    await database.delete(schema.mediaBatchRequests);
    await database.delete(schema.operationRequests);
    await database.delete(schema.uploadParts);
    await database.delete(schema.mediaEditStates);
    await database.delete(schema.mediaEditVariants);
    await database.delete(schema.mediaEditRevisions);
    await database.delete(schema.mediaVariants);
    await database.delete(schema.uploadIntents);
    await database.delete(schema.media);
    await database.delete(schema.albumReviewCollaborators);
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
          username: "operator",
          normalizedUsername: "operator",
          displayName: "协作员",
          role: "operator",
          passwordHash: "hash:operator-password",
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
    operatorId = inserted.find((user) => user.role === "operator")?.id ?? "";
    reviewerId = inserted.find((user) => user.role === "reviewer")?.id ?? "";
    uploaderId = inserted.find((user) => user.role === "uploader")?.id ?? "";
  });

  afterAll(async () => pool.end());

  it("exposes scheduled draft metadata, starts it when due, and accepts a custom password", async () => {
    const scheduledStart = new Date("2099-06-01T01:30:00.000Z");
    const created = await service.createAlbum({
      actor: { id: adminId, role: "admin" },
      input: {
        title: "预约直播活动",
        description: "活动尚未开始",
        publishMode: "review",
        scheduledStartAt: scheduledStart.toISOString(),
        password: "school-2026",
      },
      idempotencyKey: "scheduled-album-create-0001",
      requestId: "scheduled-album-create",
    });

    expect(created.generatedPassword).toBe("school-2026");
    expect(created.album).toMatchObject({
      title: "预约直播活动",
      state: "draft",
      scheduledStartAt: scheduledStart.toISOString(),
    });

    const publicBeforeStart = await service.getPublicAlbum(created.album.slug);
    expect(publicBeforeStart.view).toMatchObject({
      title: "预约直播活动",
      description: "活动尚未开始",
      state: "draft",
      scheduledStartAt: scheduledStart.toISOString(),
      accessRequired: false,
      faceSearchAvailable: false,
      bibSearchEnabled: false,
      categories: [],
    });
    await expect(service.unlockAlbum(created.album.slug, "school-2026")).rejects.toMatchObject({
      code: "ALBUM_NOT_FOUND",
    });
    await expect(
      service.listPublicMedia({
        slug: created.album.slug,
        visitorToken: undefined,
        cursor: undefined,
        categoryId: undefined,
        limit: 60,
      }),
    ).rejects.toMatchObject({ code: "ALBUM_NOT_FOUND" });

    expect(
      await service.processScheduledAlbumStarts(50, new Date(scheduledStart.getTime() - 1)),
    ).toBe(0);
    expect(
      await service.processScheduledAlbumStarts(50, new Date(scheduledStart.getTime() + 1)),
    ).toBe(1);

    const started = await service.getAlbum({ id: adminId, role: "admin" }, created.album.id);
    expect(started).toMatchObject({ state: "live", scheduledStartAt: null });

    const publicAfterStart = await service.getPublicAlbum(created.album.slug);
    expect(publicAfterStart.view).toMatchObject({
      state: "live",
      scheduledStartAt: null,
      accessRequired: true,
    });
    const visitor = await service.unlockAlbum(created.album.slug, "school-2026");
    expect(visitor.rawToken).toBeTruthy();

    const [audit] = await database
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, "album.scheduled_started"))
      .limit(1);
    expect(audit).toMatchObject({
      actorUserId: null,
      targetId: created.album.id,
      result: "success",
    });
  });

  it("lets operators upload and fully review media while denying album settings", async () => {
    const created = await service.createAlbum({
      actor: { id: adminId, role: "admin" },
      input: { title: "协作员权限", description: "", publishMode: "review" },
      idempotencyKey: "operator-role-album-0001",
      requestId: "operator-role-album-create",
    });
    await service.startAlbum({
      actor: { id: adminId, role: "admin" },
      albumId: created.album.id,
      requestId: "operator-role-album-start",
    });

    const intent = await service.createPhotoUpload({
      actor: { id: operatorId, role: "operator" },
      input: photoRequest(created.album.id),
      idempotencyKey: "operator-role-upload-0001",
    });
    expect(intent.mediaId).toBeTruthy();

    const [media] = await database
      .insert(schema.media)
      .values({
        albumId: created.album.id,
        uploaderId,
        ingestStatus: "ready",
        publicationStatus: "pending_review",
        width: 100,
        height: 100,
        mediaType: "image/jpeg",
        totalBytes: 100,
      })
      .returning({ id: schema.media.id });
    if (media === undefined) throw new Error("Expected media fixture");

    await service.publishMedia({
      actor: { id: operatorId, role: "operator" },
      mediaId: media.id,
      requestId: "operator-role-publish",
      idempotencyKey: "operator-role-publish-0001",
    });
    const [published] = await database
      .select({ publicationStatus: schema.media.publicationStatus })
      .from(schema.media)
      .where(eq(schema.media.id, media.id))
      .limit(1);
    expect(published?.publicationStatus).toBe("published");

    const collaboration = await service.updateReviewCollaboration({
      actor: { id: operatorId, role: "operator" },
      albumId: created.album.id,
      participantIds: [operatorId, reviewerId],
      requestId: "operator-role-collaboration",
    });
    expect(collaboration.enabled).toBe(true);

    const deletion = await operationsService.requestDeletion({
      actor: { id: operatorId, role: "operator", authenticatedAt: new Date() },
      mediaId: media.id,
      confirmation: created.album.title,
      requestId: "operator-role-delete",
    });
    expect(deletion.mediaId).toBe(media.id);

    expect(
      await dataSaverService.getForAlbum({ id: operatorId, role: "operator" }, created.album.id),
    ).toEqual({ enabled: false });

    await expect(
      dataSaverService.update({
        actor: { id: operatorId, role: "operator" },
        albumId: created.album.id,
        enabled: true,
        requestId: "operator-role-data-saver",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      service.updateAlbum({
        actor: { id: operatorId, role: "operator" },
        albumId: created.album.id,
        input: { description: "不应被允许" },
        requestId: "operator-role-settings",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

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
    expect(first.album.previewDownloadEnabled).toBe(true);
    expect(first.album.originalDownloadEnabled).toBe(true);
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

    await expect(
      service.publishMedia({
        actor: { id: reviewerId, role: "reviewer" },
        mediaId: intent.mediaId,
        requestId: "request-publish-too-early",
        idempotencyKey: "publish-media-too-early",
      }),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });
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
    expect(ready.publicationStatus).toBe("pending_review");
    await service.publishMedia({
      actor: { id: reviewerId, role: "reviewer" },
      mediaId: intent.mediaId,
      requestId: "request-publish",
      idempotencyKey: "publish-media-idempotency",
    });
    expect(
      (await service.getUploadIntent({ id: uploaderId, role: "uploader" }, intent.id))
        .publicationStatus,
    ).toBe("published");

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
    expect(replay.events.map((event) => event.type)).toEqual(["media.published"]);
  });

  it("falls back to base variants if active edit assets are unexpectedly unavailable", async () => {
    const album = await service.createAlbum({
      actor: { id: adminId, role: "admin" },
      input: { title: "Active Edit Fallback", description: "", publishMode: "review" },
      idempotencyKey: "album-active-edit-fallback",
      requestId: "album-active-edit-fallback",
    });
    await service.startAlbum({
      actor: { id: adminId, role: "admin" },
      albumId: album.album.id,
      requestId: "start-active-edit-fallback",
    });
    const intent = await service.createPhotoUpload({
      actor: { id: uploaderId, role: "uploader" },
      input: photoRequest(album.album.id),
      idempotencyKey: "photo-active-edit-fallback",
    });

    for (const object of intent.objects) {
      storage.objects.set(object.objectKey, {
        bytes: object.expectedBytes,
        contentType: object.contentType,
        etag: `etag-${object.kind}`,
      });
      await service.completeUploadObject({
        actor: { id: uploaderId, role: "uploader" },
        intentId: intent.id,
        kind: object.kind,
      });
    }
    await service.publishMedia({
      actor: { id: reviewerId, role: "reviewer" },
      mediaId: intent.mediaId,
      requestId: "publish-active-edit-fallback",
      idempotencyKey: "publish-active-edit-fallback",
    });

    const originalId = (
      await database
        .select({ id: schema.mediaVariants.id, kind: schema.mediaVariants.kind })
        .from(schema.mediaVariants)
        .where(eq(schema.mediaVariants.mediaId, intent.mediaId))
    ).find((variant) => variant.kind === "photo_original")?.id;
    if (originalId === undefined) throw new Error("Missing base original fixture");

    // Simulate abnormal state corruption after a previously valid edit became active:
    // activeRevisionId exists, but its edit variant rows are unexpectedly unavailable.
    const [revision] = await database
      .insert(schema.mediaEditRevisions)
      .values({
        mediaId: intent.mediaId,
        createdBy: reviewerId,
        status: "active",
        basedOnRevisionId: null,
        basedOnGeneration: 0,
        pipelineVersion: "local-edit-v3",
        recipeVersion: 3,
        recipeJson: { exposureEv: 0.1 },
        sourceVariantId: originalId,
        appliedAt: new Date(),
      })
      .returning({ id: schema.mediaEditRevisions.id });
    if (revision === undefined) throw new Error("Missing active edit fixture");
    await database.insert(schema.mediaEditStates).values({
      mediaId: intent.mediaId,
      activeRevisionId: revision.id,
      pendingRevisionId: null,
      generation: 1,
      updatedBy: reviewerId,
    });

    const visitor = await service.unlockAlbum(album.album.slug, album.generatedPassword);
    const publicMedia = await service.listPublicMedia({
      slug: album.album.slug,
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
    expect(publicMedia.items[0]?.downloads).toMatchObject({
      preview: true,
      original: true,
    });

    const public1920 = await service.refreshPublicVariant({
      slug: album.album.slug,
      visitorToken: visitor.rawToken,
      mediaId: intent.mediaId,
      kind: "photo_1920",
    });
    expect(public1920.bytes).toBe(
      intent.objects.find((object) => object.kind === "photo_1920")?.expectedBytes,
    );

    const internal = await service.listInternalMedia(
      { id: reviewerId, role: "reviewer" },
      { albumId: album.album.id, limit: 60 },
    );
    expect(
      internal.items
        .find((item) => item.id === intent.mediaId)
        ?.variants.map((variant) => variant.kind)
        .sort(),
    ).toEqual(["photo_1920", "photo_480", "photo_960"]);

    const internal1920 = await service.refreshInternalVariant(
      { id: reviewerId, role: "reviewer" },
      { mediaId: intent.mediaId, kind: "photo_1920" },
    );
    expect(internal1920.bytes).toBe(public1920.bytes);
  });

  it("defers auto publication while a local edit revision is pending", async () => {
    const album = await service.createAlbum({
      actor: { id: adminId, role: "admin" },
      input: { title: "修图发布门禁", description: "", publishMode: "auto" },
      idempotencyKey: "album-idempotency-edit-gate",
      requestId: "request-album-edit-gate",
    });
    await service.startAlbum({
      actor: { id: adminId, role: "admin" },
      albumId: album.album.id,
      requestId: "request-start-edit-gate",
    });
    const intent = await service.createPhotoUpload({
      actor: { id: uploaderId, role: "uploader" },
      input: photoRequest(album.album.id),
      idempotencyKey: "photo-idempotency-edit-gate",
    });

    const reserved = await editService.createRevision({
      actor: { id: uploaderId, role: "uploader" },
      mediaId: intent.mediaId,
      input: {
        basedOnRevisionId: null,
        basedOnGeneration: 0,
        pipelineVersion: "local-edit-v3",
        recipeVersion: 3,
        recipeJson: { exposureEv: 0.2 },
      },
      requestId: "request-reserve-edit-gate",
    });
    const revisionId = reserved.state.pendingRevisionId;
    if (revisionId === null) throw new Error("pending edit revision missing");

    const complete = async (kind: "photo_480" | "photo_960") => {
      const object = intent.objects.find((candidate) => candidate.kind === kind);
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
    const previewReady = await complete("photo_960");
    expect(previewReady.ingestStatus).toBe("preview_ready");
    expect(previewReady.publicationStatus).toBe("pending_review");

    await expect(
      service.publishMedia({
        actor: { id: reviewerId, role: "reviewer" },
        mediaId: intent.mediaId,
        requestId: "request-publish-edit-gate-blocked",
        idempotencyKey: "publish-edit-gate-blocked",
      }),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });

    await editService.cancelPending({
      actor: { id: uploaderId, role: "uploader" },
      mediaId: intent.mediaId,
      revisionId,
      requestId: "request-cancel-edit-gate",
    });
    await expect(
      service.publishMedia({
        actor: { id: reviewerId, role: "reviewer" },
        mediaId: intent.mediaId,
        requestId: "request-publish-edit-gate-still-incomplete",
        idempotencyKey: "publish-edit-gate-still-incomplete",
      }),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });

    for (const kind of ["photo_1920", "photo_original"] as const) {
      const object = intent.objects.find((candidate) => candidate.kind === kind);
      if (object === undefined) throw new Error(`Missing ${kind}`);
      storage.objects.set(object.objectKey, {
        bytes: object.expectedBytes,
        contentType: object.contentType,
        etag: `etag-${kind}`,
      });
      await service.completeUploadObject({
        actor: { id: uploaderId, role: "uploader" },
        intentId: intent.id,
        kind,
      });
    }

    await service.publishMedia({
      actor: { id: reviewerId, role: "reviewer" },
      mediaId: intent.mediaId,
      requestId: "request-publish-edit-gate",
      idempotencyKey: "publish-edit-gate",
    });
    expect(
      (await service.getUploadIntent({ id: uploaderId, role: "uploader" }, intent.id))
        .publicationStatus,
    ).toBe("published");
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

  it("rolls publication state back when the durable event insert fails", async () => {
    const album = await service.createAlbum({
      actor: { id: adminId, role: "admin" },
      input: { title: "事务回滚", description: "", publishMode: "auto" },
      idempotencyKey: "album-idempotency-outbox",
      requestId: "request-album-outbox",
    });
    await service.startAlbum({
      actor: { id: adminId, role: "admin" },
      albumId: album.album.id,
      requestId: "request-start-outbox",
    });
    const intent = await service.createPhotoUpload({
      actor: { id: uploaderId, role: "uploader" },
      input: photoRequest(album.album.id),
      idempotencyKey: "photo-idempotency-outbox",
    });
    const complete = async (kind: "photo_480" | "photo_960") => {
      const object = intent.objects.find((candidate) => candidate.kind === kind);
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
    await complete("photo_480");
    await pool.query(`
      create function photostream_test_fail_live_event() returns trigger language plpgsql as $$
      begin
        raise exception 'synthetic live event failure';
      end
      $$;
      create trigger photostream_test_fail_live_event
      before insert on live_events
      for each row execute function photostream_test_fail_live_event();
    `);
    try {
      await expect(complete("photo_960")).rejects.toThrow(
        'Failed query: insert into "live_events"',
      );
      const [storedMedia] = await database
        .select()
        .from(schema.media)
        .where(eq(schema.media.id, intent.mediaId));
      const [storedAlbum] = await database
        .select()
        .from(schema.albums)
        .where(eq(schema.albums.id, album.album.id));
      expect(storedMedia).toMatchObject({ publicationStatus: "draft", publishSequence: null });
      expect(storedAlbum?.publishSequence).toBe(0);
      expect(await database.select().from(schema.liveEvents)).toHaveLength(0);
      expect(
        (await database.select().from(schema.mediaVariants)).find(
          (variant) => variant.kind === "photo_960",
        )?.verified,
      ).toBe(false);
    } finally {
      await pool.query(`
        drop trigger if exists photostream_test_fail_live_event on live_events;
        drop function if exists photostream_test_fail_live_event();
      `);
    }
    expect((await complete("photo_960")).publicationStatus).toBe("published");
    expect(await database.select().from(schema.liveEvents)).toHaveLength(1);
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

  it("cancels unpublished uploads and durably removes objects and multipart state", async () => {
    const album = await service.createAlbum({
      actor: { id: adminId, role: "admin" },
      input: { title: "取消上传", description: "", publishMode: "auto" },
      idempotencyKey: "album-idempotency-cancel",
      requestId: "request-album-cancel",
    });
    await service.startAlbum({
      actor: { id: adminId, role: "admin" },
      albumId: album.album.id,
      requestId: "request-start-cancel",
    });
    const intent = await service.createPhotoUpload({
      actor: { id: uploaderId, role: "uploader" },
      input: multipartPhotoRequest(album.album.id),
      idempotencyKey: "photo-idempotency-cancel",
    });
    for (const object of intent.objects) {
      storage.objects.set(object.objectKey, {
        bytes: object.expectedBytes,
        contentType: object.contentType,
        etag: `etag-${object.kind}`,
      });
      if (object.multipartUploadId !== null) {
        storage.multipartParts.set(`${object.multipartUploadId}:1`, {
          bytes: object.parts[0]?.expectedBytes ?? 1,
          contentType: object.contentType,
          etag: "a".repeat(64),
        });
      }
    }

    const edit = await editService.createRevision({
      actor: { id: uploaderId, role: "uploader" },
      mediaId: intent.mediaId,
      input: {
        basedOnRevisionId: null,
        basedOnGeneration: 0,
        pipelineVersion: "local-edit-v3",
        recipeVersion: 3,
        recipeJson: { exposureEv: 0.1 },
      },
      requestId: "cancel-upload-edit-create",
    });
    const editRevisionId = edit.state.pendingRevisionId;
    if (editRevisionId === null) throw new Error("Missing edit revision fixture");
    await editService.prepareRevision({
      actor: { id: uploaderId, role: "uploader" },
      mediaId: intent.mediaId,
      revisionId: editRevisionId,
      input: {
        variants: [
          {
            kind: "photo_480",
            format: "webp",
            contentType: "image/webp",
            width: 480,
            height: 360,
            bytes: 24_000,
          },
          {
            kind: "photo_960",
            format: "webp",
            contentType: "image/webp",
            width: 960,
            height: 720,
            bytes: 80_000,
          },
          {
            kind: "photo_1920",
            format: "webp",
            contentType: "image/webp",
            width: 1_920,
            height: 1_440,
            bytes: 320_000,
          },
          {
            kind: "photo_download",
            format: "jpeg",
            contentType: "image/jpeg",
            width: 4_000,
            height: 3_000,
            bytes: 3_500_000,
          },
        ],
      },
      requestId: "cancel-upload-edit-prepare",
    });
    const editObjects = await database
      .select()
      .from(schema.mediaEditVariants)
      .where(eq(schema.mediaEditVariants.editRevisionId, editRevisionId));
    for (const object of editObjects) {
      storage.objects.set(object.objectKey, {
        bytes: object.expectedBytes,
        contentType: object.contentType,
        etag: `etag-edit-${object.kind}`,
      });
    }

    const cancelled = await service.cancelUpload({
      actor: { id: uploaderId, role: "uploader" },
      intentId: intent.id,
    });
    expect(cancelled).toMatchObject({
      status: "cancelled",
      cleanupStatus: "pending",
      cleanupLastErrorCode: null,
      objects: expect.arrayContaining([expect.objectContaining({ kind: "photo_480" })]),
    });
    await expect(
      service.completeUploadObject({
        actor: { id: uploaderId, role: "uploader" },
        intentId: intent.id,
        kind: "photo_480",
      }),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });
    const firstSweep = new Date(Date.now() + 31 * 60 * 1_000);
    await service.processUploadCleanup(intent.id, firstSweep);
    expect(
      await service.getUploadIntent({ id: uploaderId, role: "uploader" }, intent.id),
    ).toMatchObject({ status: "cancelled", cleanupStatus: "pending", objects: [] });
    expect(storage.objects).toHaveLength(0);
    expect(storage.multipartParts).toHaveLength(0);
    expect(storage.abortedMultipart).toContain(
      intent.objects.find((object) => object.kind === "photo_original")?.multipartUploadId,
    );
    expect(await database.select().from(schema.uploadParts)).toHaveLength(0);
    expect(await database.select().from(schema.mediaVariants)).toHaveLength(0);
    expect(await database.select().from(schema.mediaEditStates)).toHaveLength(0);
    expect(await database.select().from(schema.mediaEditVariants)).toHaveLength(0);
    expect(await database.select().from(schema.mediaEditRevisions)).toHaveLength(0);
    await service.processUploadCleanup(
      intent.id,
      new Date(firstSweep.getTime() + 24 * 60 * 60 * 1_000 + 1),
    );
    expect(
      await service.getUploadIntent({ id: uploaderId, role: "uploader" }, intent.id),
    ).toMatchObject({ status: "cancelled", cleanupStatus: "completed" });
  });

  it("preserves published previews while cleaning cancelled source work", async () => {
    const album = await service.createAlbum({
      actor: { id: adminId, role: "admin" },
      input: { title: "保留直播预览", description: "", publishMode: "auto" },
      idempotencyKey: "album-idempotency-cancel-preview",
      requestId: "request-album-cancel-preview",
    });
    await service.startAlbum({
      actor: { id: adminId, role: "admin" },
      albumId: album.album.id,
      requestId: "request-start-cancel-preview",
    });
    const intent = await service.createPhotoUpload({
      actor: { id: uploaderId, role: "uploader" },
      input: photoRequest(album.album.id),
      idempotencyKey: "photo-idempotency-cancel-preview",
    });
    for (const kind of ["photo_480", "photo_960"] as const) {
      const object = intent.objects.find((candidate) => candidate.kind === kind);
      if (object === undefined) throw new Error(`Missing ${kind}`);
      storage.objects.set(object.objectKey, {
        bytes: object.expectedBytes,
        contentType: object.contentType,
        etag: `etag-${kind}`,
      });
      await service.completeUploadObject({
        actor: { id: uploaderId, role: "uploader" },
        intentId: intent.id,
        kind,
      });
    }
    const source = intent.objects.find((object) => object.kind === "photo_1920");
    if (source === undefined) throw new Error("Missing source fixture");
    storage.objects.set(source.objectKey, {
      bytes: source.expectedBytes,
      contentType: source.contentType,
      etag: "unverified-source",
    });

    const cancelled = await service.cancelUpload({
      actor: { id: uploaderId, role: "uploader" },
      intentId: intent.id,
    });
    expect(cancelled).toMatchObject({
      status: "cancelled",
      cleanupStatus: "pending",
      publicationStatus: "published",
    });
    const firstSweep = new Date(Date.now() + 31 * 60 * 1_000);
    await service.processUploadCleanup(intent.id, firstSweep);
    const swept = await service.getUploadIntent({ id: uploaderId, role: "uploader" }, intent.id);
    expect(swept).toMatchObject({ cleanupStatus: "pending", ingestStatus: "preview_ready" });
    expect(swept.objects.map((object) => object.kind).sort()).toEqual(["photo_480", "photo_960"]);
    expect(storage.objects.has(source.objectKey)).toBe(false);
    const visitor = await service.unlockAlbum(album.album.slug, album.generatedPassword);
    expect(
      await service.listPublicMedia({
        slug: album.album.slug,
        visitorToken: visitor.rawToken,
        cursor: undefined,
        categoryId: undefined,
        limit: 60,
      }),
    ).toMatchObject({ items: [{ id: intent.mediaId }] });
    await service.processUploadCleanup(
      intent.id,
      new Date(firstSweep.getTime() + 24 * 60 * 60 * 1_000 + 1),
    );
    expect(
      await service.getUploadIntent({ id: uploaderId, role: "uploader" }, intent.id),
    ).toMatchObject({ cleanupStatus: "completed", ingestStatus: "preview_ready" });
  });

  it("expires orphaned uploads and retries cleanup failures from persisted state", async () => {
    const album = await service.createAlbum({
      actor: { id: adminId, role: "admin" },
      input: { title: "过期清理", description: "", publishMode: "auto" },
      idempotencyKey: "album-idempotency-expiry",
      requestId: "request-album-expiry",
    });
    await service.startAlbum({
      actor: { id: adminId, role: "admin" },
      albumId: album.album.id,
      requestId: "request-start-expiry",
    });
    const intent = await service.createPhotoUpload({
      actor: { id: uploaderId, role: "uploader" },
      input: photoRequest(album.album.id),
      idempotencyKey: "photo-idempotency-expiry",
    });
    const orphan = intent.objects[0];
    if (orphan === undefined) throw new Error("Missing orphan fixture");
    storage.objects.set(orphan.objectKey, {
      bytes: orphan.expectedBytes,
      contentType: orphan.contentType,
      etag: "orphan",
    });
    storage.failDeleteOnce.add(orphan.objectKey);
    const now = new Date("2026-08-30T12:00:00.000Z");
    await database
      .update(schema.uploadIntents)
      .set({ expiresAt: new Date(now.getTime() - 1) })
      .where(eq(schema.uploadIntents.id, intent.id));

    expect(await service.processExpiredUploadCleanups(10, now)).toBe(0);
    expect(
      await service.getUploadIntent({ id: uploaderId, role: "uploader" }, intent.id),
    ).toMatchObject({
      status: "expired",
      cleanupStatus: "pending",
      cleanupLastErrorCode: null,
    });
    const firstSweep = new Date(now.getTime() + 31 * 60 * 1_000);
    expect(await service.processExpiredUploadCleanups(10, firstSweep)).toBe(1);
    expect(
      await service.getUploadIntent({ id: uploaderId, role: "uploader" }, intent.id),
    ).toMatchObject({
      status: "expired",
      cleanupStatus: "failed",
      cleanupLastErrorCode: "UPLOAD_CLEANUP_FAILED",
    });
    const retrySweep = new Date(firstSweep.getTime() + 61_000);
    expect(await service.processExpiredUploadCleanups(10, retrySweep)).toBe(1);
    expect(
      await service.getUploadIntent({ id: uploaderId, role: "uploader" }, intent.id),
    ).toMatchObject({ status: "expired", cleanupStatus: "pending", objects: [] });
    expect(storage.objects.has(orphan.objectKey)).toBe(false);
    expect(
      await service.processExpiredUploadCleanups(
        10,
        new Date(retrySweep.getTime() + 24 * 60 * 60 * 1_000 + 1),
      ),
    ).toBe(1);
    expect(
      await service.getUploadIntent({ id: uploaderId, role: "uploader" }, intent.id),
    ).toMatchObject({ status: "expired", cleanupStatus: "completed", objects: [] });
  });

  it("filters incomplete and failed media and lists only participating uploaders", async () => {
    const album = await service.createAlbum({
      actor: { id: adminId, role: "admin" },
      input: { title: "筛选相册", description: "", publishMode: "review" },
      idempotencyKey: "album-filter-idempotency",
      requestId: "request-album-filter",
    });
    await database.insert(schema.media).values([
      {
        albumId: album.album.id,
        uploaderId,
        ingestStatus: "uploading_source",
        publicationStatus: "pending_review",
        width: 100,
        height: 100,
        mediaType: "image/jpeg",
        totalBytes: 100,
      },
      {
        albumId: album.album.id,
        uploaderId,
        ingestStatus: "failed",
        publicationStatus: "draft",
        width: 100,
        height: 100,
        mediaType: "image/jpeg",
        totalBytes: 100,
      },
      {
        albumId: album.album.id,
        uploaderId,
        ingestStatus: "ready",
        publicationStatus: "published",
        width: 100,
        height: 100,
        mediaType: "image/jpeg",
        totalBytes: 100,
        publishSequence: 1,
        publishedAt: new Date(),
      },
    ]);

    const incomplete = await service.listInternalMedia(
      { id: reviewerId, role: "reviewer" },
      { albumId: album.album.id, ingestGroup: "incomplete", limit: 60 },
    );
    const failed = await service.listInternalMedia(
      { id: reviewerId, role: "reviewer" },
      { albumId: album.album.id, ingestGroup: "failed", limit: 60 },
    );
    expect(incomplete.items.map((item) => item.ingestStatus)).toEqual(["uploading_source"]);
    expect(failed.items.map((item) => item.ingestStatus)).toEqual(["failed"]);
    expect(
      await service.listAlbumUploaders({ id: reviewerId, role: "reviewer" }, album.album.id),
    ).toEqual([
      expect.objectContaining({ id: uploaderId, username: "uploader", displayName: "上传者" }),
    ]);
  });

  it("splits review work evenly and scopes reviewer queries to their assignment", async () => {
    const album = await service.createAlbum({
      actor: { id: adminId, role: "admin" },
      input: { title: "审核分工相册", description: "", publishMode: "review" },
      idempotencyKey: "album-review-collaboration-idempotency",
      requestId: "album-review-collaboration-create",
    });
    const existing = await database
      .insert(schema.media)
      .values(
        Array.from({ length: 5 }, () => ({
          albumId: album.album.id,
          uploaderId,
          ingestStatus: "ready" as const,
          publicationStatus: "hidden" as const,
          width: 100,
          height: 100,
          mediaType: "image/jpeg",
          totalBytes: 100,
        })),
      )
      .returning({ id: schema.media.id, reviewAssigneeId: schema.media.reviewAssigneeId });
    expect(existing.every((item) => item.reviewAssigneeId === null)).toBe(true);

    const collaboration = await service.updateReviewCollaboration({
      actor: { id: adminId, role: "admin" },
      albumId: album.album.id,
      participantIds: [adminId, reviewerId],
      requestId: "album-review-collaboration-enable",
    });
    expect(collaboration.enabled).toBe(true);
    expect(collaboration.participants).toHaveLength(2);

    const assigned = await database
      .select({
        id: schema.media.id,
        reviewAssigneeId: schema.media.reviewAssigneeId,
      })
      .from(schema.media)
      .where(eq(schema.media.albumId, album.album.id));
    const adminAssigned = assigned.filter((item) => item.reviewAssigneeId === adminId);
    const reviewerAssigned = assigned.filter((item) => item.reviewAssigneeId === reviewerId);
    expect(Math.abs(adminAssigned.length - reviewerAssigned.length)).toBeLessThanOrEqual(1);
    expect(adminAssigned.length + reviewerAssigned.length).toBe(5);

    const mine = await service.listInternalMedia(
      { id: reviewerId, role: "reviewer" },
      { albumId: album.album.id, reviewAssignment: "mine", limit: 60 },
    );
    expect(new Set(mine.items.map((item) => item.id))).toEqual(
      new Set(reviewerAssigned.map((item) => item.id)),
    );

    const selection = await service.listInternalMediaSelection(
      { id: reviewerId, role: "reviewer" },
      { albumId: album.album.id, reviewAssignment: "mine", limit: 1_000 },
    );
    expect(selection.total).toBe(reviewerAssigned.length);
    expect(new Set(selection.items.map((item) => item.id))).toEqual(
      new Set(reviewerAssigned.map((item) => item.id)),
    );

    const reviewerView = await service.getReviewCollaboration(
      { id: reviewerId, role: "reviewer" },
      album.album.id,
    );
    expect(reviewerView.availableParticipants).toEqual([]);
    expect(reviewerView.currentUserParticipating).toBe(true);
    expect(reviewerView.currentUserRemainingCount).toBe(reviewerAssigned.length);
    await expect(
      service.getReviewCollaboration({ id: uploaderId, role: "uploader" }, album.album.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const [publishedByVisibility, reviewedByViewer] = reviewerAssigned;
    if (publishedByVisibility === undefined || reviewedByViewer === undefined) {
      throw new Error("Expected reviewer to receive at least two photos");
    }
    await database
      .update(schema.media)
      .set({ publicationStatus: "published" })
      .where(eq(schema.media.id, publishedByVisibility.id));
    const [publishedSnapshot] = await database
      .select({ reviewedAt: schema.media.reviewedAt })
      .from(schema.media)
      .where(eq(schema.media.id, publishedByVisibility.id))
      .limit(1);
    expect(publishedSnapshot?.reviewedAt).toBeInstanceOf(Date);

    await service.markMediaReviewed({
      actor: { id: reviewerId, role: "reviewer" },
      mediaId: reviewedByViewer.id,
      requestId: "review-collaboration-viewed",
    });
    const afterReview = await service.getReviewCollaboration(
      { id: reviewerId, role: "reviewer" },
      album.album.id,
    );
    expect(afterReview.currentUserRemainingCount).toBe(reviewerAssigned.length - 2);

    const [newMedia] = await database
      .insert(schema.media)
      .values({
        albumId: album.album.id,
        uploaderId,
        ingestStatus: "ready",
        publicationStatus: "hidden",
        width: 100,
        height: 100,
        mediaType: "image/jpeg",
        totalBytes: 100,
      })
      .returning({
        id: schema.media.id,
        reviewAssigneeId: schema.media.reviewAssigneeId,
      });
    expect(newMedia?.reviewAssigneeId).toBe(reviewerId);

    const afterInsert = await service.getReviewCollaboration(
      { id: adminId, role: "admin" },
      album.album.id,
    );
    const counts = afterInsert.participants.map((participant) => participant.remainingCount);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(4);
    expect(
      afterInsert.participants.find((participant) => participant.id === reviewerId)?.remainingCount,
    ).toBe(reviewerAssigned.length - 1);

    const disabled = await service.updateReviewCollaboration({
      actor: { id: adminId, role: "admin" },
      albumId: album.album.id,
      participantIds: [],
      requestId: "album-review-collaboration-disable",
    });
    expect(disabled.enabled).toBe(false);
    const unassigned = await database
      .select({ reviewAssigneeId: schema.media.reviewAssigneeId })
      .from(schema.media)
      .where(eq(schema.media.albumId, album.album.id));
    expect(unassigned.every((item) => item.reviewAssigneeId === null)).toBe(true);
  });

  it("restores an archived album to the documented ended state", async () => {
    const created = await service.createAlbum({
      actor: { id: adminId, role: "admin" },
      input: { title: "状态机相册", description: "", publishMode: "review" },
      idempotencyKey: "album-state-machine-idempotency",
      requestId: "album-state-create",
    });
    await service.startAlbum({
      actor: { id: adminId, role: "admin" },
      albumId: created.album.id,
      requestId: "album-state-start",
    });
    await service.endAlbum({
      actor: { id: adminId, role: "admin" },
      albumId: created.album.id,
      requestId: "album-state-end",
    });
    await service.archiveAlbum({
      actor: { id: adminId, role: "admin" },
      albumId: created.album.id,
      requestId: "album-state-archive",
    });
    expect(
      await service.restoreAlbum({
        actor: { id: adminId, role: "admin" },
        albumId: created.album.id,
        requestId: "album-state-restore",
      }),
    ).toMatchObject({ state: "ended" });
    await expect(
      service.createCategory({
        actor: { id: reviewerId, role: "reviewer" },
        albumId: created.album.id,
        name: "审核员不应创建",
        sortOrder: 0,
        idempotencyKey: "reviewer-category-idempotency",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("deletes a category without deleting its photos", async () => {
    const created = await service.createAlbum({
      actor: { id: adminId, role: "admin" },
      input: { title: "分类删除测试", description: "", publishMode: "review" },
      idempotencyKey: "category-delete-album-0001",
      requestId: "category-delete-album",
    });
    const category = await service.createCategory({
      actor: { id: adminId, role: "admin" },
      albumId: created.album.id,
      name: "待删除分类",
      sortOrder: 0,
      idempotencyKey: "category-delete-category-0001",
    });
    const [insertedMedia] = await database
      .insert(schema.media)
      .values({
        albumId: created.album.id,
        categoryId: category.id,
        uploaderId,
        width: 1_920,
        height: 1_080,
        mediaType: "image/jpeg",
        totalBytes: 123_456,
      })
      .returning({ id: schema.media.id });
    if (insertedMedia === undefined) throw new Error("media insert failed");

    await service.deleteCategory({
      actor: { id: adminId, role: "admin" },
      albumId: created.album.id,
      categoryId: category.id,
      requestId: "category-delete",
    });

    expect(await service.listCategories({ id: adminId, role: "admin" }, created.album.id)).toEqual(
      [],
    );
    const [storedMedia] = await database
      .select({ categoryId: schema.media.categoryId })
      .from(schema.media)
      .where(eq(schema.media.id, insertedMedia.id))
      .limit(1);
    expect(storedMedia?.categoryId).toBeNull();
  });

  it("deletes a member account while preserving historical rows and allowing username reuse", async () => {
    const created = await userAdminService.createUser({
      actor: { id: adminId, role: "admin" },
      input: {
        username: "second-admin",
        displayName: "第二管理员",
        role: "admin",
      },
      idempotencyKey: "second-admin-create-0001",
      requestId: "second-admin-create",
    });

    await userAdminService.deleteUser({
      actor: { id: adminId, role: "admin" },
      userId: created.user.id,
      requestId: "second-admin-delete",
    });

    const listed = await userAdminService.listUsers({ role: "admin" });
    expect(listed.some((user) => user.id === created.user.id)).toBe(false);
    const [deletedRow] = await database
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, created.user.id))
      .limit(1);
    expect(deletedRow).toMatchObject({
      displayName: "已删除成员",
      isActive: false,
    });
    expect(deletedRow?.deletedAt).toBeInstanceOf(Date);

    const recreated = await userAdminService.createUser({
      actor: { id: adminId, role: "admin" },
      input: {
        username: "second-admin",
        displayName: "重新创建",
        role: "uploader",
      },
      idempotencyKey: "second-admin-recreate-0001",
      requestId: "second-admin-recreate",
    });
    expect(recreated.user.username).toBe("second-admin");

    await expect(
      userAdminService.deleteUser({
        actor: { id: adminId, role: "admin" },
        userId: adminId,
        requestId: "self-delete",
      }),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });
  });

  it("exposes the runtime REST contract without accepting media bodies", async () => {
    const app = await buildApp({
      config,
      authStore: new PostgresAuthStore(database),
      passwordHasher: fakeHasher,
      photoService: service,
      broker: new LiveEventBroker(),
      operationsService,
      userAdminService,
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
        "/api/v1/albums/{id}/uploaders",
        "/api/v1/uploads",
        "/api/v1/public/albums/{slug}/media",
        "/api/v1/public/albums/{slug}/events",
        "/api/v1/media/batch",
        "/api/v1/public/albums/{slug}/downloads/{mediaId}/{kind}",
        "/api/v1/users",
        "/api/v1/audit",
      ]),
    );
    await app.close();
  });
});
