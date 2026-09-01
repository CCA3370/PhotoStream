import { createHmac, randomBytes } from "node:crypto";
import {
  type AlbumView,
  type CreateAlbumRequest,
  type CreatePhotoUploadRequest,
  hasPermission,
  type PhotoVariantKind,
  type PublicMediaView,
  type UpdateAlbumRequest,
  type UploadIntentView,
  type UserRole,
} from "@photostream/contracts";
import type { Database } from "@photostream/db";
import { schema } from "@photostream/db";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  not,
  or,
  sql,
} from "drizzle-orm";
import { createSessionToken, safeEqual } from "../auth/crypto.js";
import type { PasswordHasher } from "../auth/types.js";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import {
  findOperationRequest,
  lockOperationRequest,
  operationRequestHash,
  saveOperationRequest,
} from "../idempotency.js";
import { type CdnInvalidator, LocalCdnInvalidator } from "./cdn-invalidator.js";
import { liveEventChannel } from "./live-event-broker.js";
import type { ObjectStorage } from "./object-storage.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type DbExecutor = Database | Transaction;

const photoVariantKinds: readonly PhotoVariantKind[] = [
  "photo_480",
  "photo_960",
  "photo_1920",
  "photo_original",
];
const previewVariantKinds = new Set<PhotoVariantKind>(["photo_480", "photo_960"]);
const publicVariantKinds = new Set<PhotoVariantKind>(["photo_480", "photo_960", "photo_1920"]);
const multipartThreshold = 16 * 1024 * 1024;
const uploadCleanupInitialGraceMs = 30 * 60 * 1_000;
const uploadCleanupVerificationDelayMs = 24 * 60 * 60 * 1_000;
const multipartPartBytes = 8 * 1024 * 1024;
const incompleteIngestStatuses = [
  "created",
  "local_processing",
  "uploading_preview",
  "preview_ready",
  "uploading_source",
] as const;

function iso(value: Date): string {
  return value.toISOString();
}

function albumView(row: typeof schema.albums.$inferSelect): AlbumView {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    state: row.state,
    access: row.access,
    publishMode: row.publishMode,
    previewDownloadEnabled: row.previewDownloadEnabled,
    originalDownloadEnabled: row.originalDownloadEnabled,
    privacyNotice: row.privacyNotice,
    complaintContact: row.complaintContact,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function categoryView(row: typeof schema.categories.$inferSelect) {
  return {
    id: row.id,
    albumId: row.albumId,
    name: row.name,
    sortOrder: row.sortOrder,
    enabled: row.enabled,
  };
}

function extensionFor(format: string): string {
  if (format === "jpeg") return "jpg";
  return format;
}

function variantFilename(kind: PhotoVariantKind, format: string): string {
  if (kind === "photo_original") return `original.${extensionFor(format)}`;
  return `${kind.slice("photo_".length)}.${extensionFor(format)}`;
}

function requireHeaderIdempotency(value: string | undefined): string {
  if (value === undefined || value.length < 16 || value.length > 128) {
    throw new AppError({
      code: "BAD_REQUEST",
      message: "缺少有效幂等键",
      statusCode: 400,
    });
  }
  return value;
}

function requirePermission(role: UserRole, permission: Parameters<typeof hasPermission>[1]): void {
  if (!hasPermission(role, permission)) {
    throw new AppError({ code: "FORBIDDEN", message: "当前角色无权执行此操作", statusCode: 403 });
  }
}

function cursorSignature(secret: string, encoded: string): string {
  return createHmac("sha256", secret).update(encoded, "utf8").digest("base64url");
}

function visitorTokenHash(secret: string, token: string): string {
  return createHmac("sha256", secret).update(token, "utf8").digest("hex");
}

export interface InternalActor {
  readonly id: string;
  readonly role: UserRole;
}

export class PhotoService {
  readonly #database: Database;
  readonly #storage: ObjectStorage;
  readonly #hasher: PasswordHasher;
  readonly #config: AppConfig;
  readonly #cdnInvalidator: CdnInvalidator;

  constructor(options: {
    readonly database: Database;
    readonly storage: ObjectStorage;
    readonly passwordHasher: PasswordHasher;
    readonly config: AppConfig;
    readonly cdnInvalidator?: CdnInvalidator;
  }) {
    this.#database = options.database;
    this.#storage = options.storage;
    this.#hasher = options.passwordHasher;
    this.#config = options.config;
    this.#cdnInvalidator = options.cdnInvalidator ?? new LocalCdnInvalidator();
  }

  async listAlbums(actor: InternalActor): Promise<AlbumView[]> {
    requirePermission(actor.role, "album:read");
    const rows = await this.#database
      .select()
      .from(schema.albums)
      .orderBy(desc(schema.albums.updatedAt));
    return rows.map(albumView);
  }

  async listAlbumSummaries(actor: InternalActor) {
    const albums = await this.listAlbums(actor);
    return Promise.all(
      albums.map(async (album) => {
        const [counts] = await this.#database
          .select({
            mediaCount: sql<number>`count(*)::int`,
            pendingReviewCount: sql<number>`count(*) filter (where ${schema.media.publicationStatus} = 'pending_review')::int`,
            incompleteCount: sql<number>`count(*) filter (where ${schema.media.ingestStatus} not in ('ready', 'failed', 'cancelled'))::int`,
          })
          .from(schema.media)
          .where(
            and(
              eq(schema.media.albumId, album.id),
              sql`${schema.media.publicationStatus} <> 'deleted'`,
            ),
          );
        const [storage] = await this.#database
          .select({
            logicalBytes: sql<number>`coalesce(sum(${schema.mediaVariants.bytes}), 0)::bigint`,
          })
          .from(schema.mediaVariants)
          .innerJoin(schema.media, eq(schema.mediaVariants.mediaId, schema.media.id))
          .where(and(eq(schema.media.albumId, album.id), eq(schema.mediaVariants.verified, true)));
        return {
          ...album,
          mediaCount: counts?.mediaCount ?? 0,
          pendingReviewCount: counts?.pendingReviewCount ?? 0,
          incompleteCount: counts?.incompleteCount ?? 0,
          logicalBytes: Number(storage?.logicalBytes ?? 0),
        };
      }),
    );
  }

  async getAlbum(actor: InternalActor, albumId: string): Promise<AlbumView> {
    requirePermission(actor.role, "album:read");
    const row = await this.#albumById(this.#database, albumId);
    if (row === null) throw this.#albumNotFound();
    return albumView(row);
  }

  async createAlbum(options: {
    readonly actor: InternalActor;
    readonly input: CreateAlbumRequest;
    readonly idempotencyKey: string | undefined;
    readonly requestId: string;
  }): Promise<{ album: AlbumView; generatedPassword: string }> {
    requirePermission(options.actor.role, "album:create");
    const idempotencyKey = requireHeaderIdempotency(options.idempotencyKey);
    const generatedPassword = this.#deriveAlbumPassword(options.actor.id, idempotencyKey);
    const passwordHash = await this.#hasher.hash(generatedPassword);

    return this.#database.transaction(async (transaction) => {
      await this.#advisoryLock(transaction, `album:${options.actor.id}:${idempotencyKey}`);
      const [existing] = await transaction
        .select()
        .from(schema.albums)
        .where(
          and(
            eq(schema.albums.createdBy, options.actor.id),
            eq(schema.albums.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (existing !== undefined) {
        return { album: albumView(existing), generatedPassword };
      }

      const [created] = await transaction
        .insert(schema.albums)
        .values({
          slug: randomBytes(12).toString("base64url"),
          title: options.input.title,
          description: options.input.description,
          publishMode: options.input.publishMode,
          access: "password",
          state: "draft",
          passwordHash,
          idempotencyKey,
          createdBy: options.actor.id,
        })
        .returning();
      if (created === undefined) throw new Error("Album insert returned no row");
      await transaction.insert(schema.auditLogs).values({
        actorUserId: options.actor.id,
        action: "album.created",
        targetType: "album",
        targetId: created.id,
        result: "success",
        changedFields: ["title", "description", "publishMode", "passwordHash"],
        requestId: options.requestId,
      });
      return { album: albumView(created), generatedPassword };
    });
  }

  async startAlbum(options: {
    readonly actor: InternalActor;
    readonly albumId: string;
    readonly requestId: string;
  }): Promise<AlbumView> {
    requirePermission(options.actor.role, "album:configure");
    return this.#database.transaction(async (transaction) => {
      await this.#advisoryLock(transaction, `album-state:${options.albumId}`);
      const album = await this.#albumById(transaction, options.albumId);
      if (album === null) throw this.#albumNotFound();
      if (album.state === "live") return albumView(album);
      if (album.state !== "draft" && album.state !== "ended") {
        throw new AppError({
          code: "STATE_CONFLICT",
          message: "当前相册状态不能开始直播",
          statusCode: 409,
        });
      }
      const now = new Date();
      const [updated] = await transaction
        .update(schema.albums)
        .set({ state: "live", updatedAt: now })
        .where(eq(schema.albums.id, album.id))
        .returning();
      if (updated === undefined) throw new Error("Album state update returned no row");
      await transaction.insert(schema.auditLogs).values({
        actorUserId: options.actor.id,
        action: "album.started",
        targetType: "album",
        targetId: album.id,
        result: "success",
        changedFields: ["state"],
        requestId: options.requestId,
      });
      return albumView(updated);
    });
  }

  async endAlbum(options: {
    readonly actor: InternalActor;
    readonly albumId: string;
    readonly requestId: string;
  }): Promise<AlbumView> {
    requirePermission(options.actor.role, "album:configure");
    return this.#transitionAlbum({
      ...options,
      from: ["live"],
      to: "ended",
      action: "album.ended",
    });
  }

  async archiveAlbum(options: {
    readonly actor: InternalActor;
    readonly albumId: string;
    readonly requestId: string;
  }): Promise<AlbumView> {
    requirePermission(options.actor.role, "album:configure");
    return this.#transitionAlbum({
      ...options,
      from: ["ended"],
      to: "archived",
      action: "album.archived",
    });
  }

  async restoreAlbum(options: {
    readonly actor: InternalActor;
    readonly albumId: string;
    readonly requestId: string;
  }): Promise<AlbumView> {
    requirePermission(options.actor.role, "album:configure");
    return this.#transitionAlbum({
      ...options,
      from: ["archived"],
      to: "ended",
      action: "album.restored",
    });
  }

  async updateAlbum(options: {
    readonly actor: InternalActor;
    readonly albumId: string;
    readonly input: UpdateAlbumRequest;
    readonly requestId: string;
  }): Promise<AlbumView> {
    requirePermission(options.actor.role, "album:configure");
    return this.#database.transaction(async (transaction) => {
      await this.#advisoryLock(transaction, `album-settings:${options.albumId}`);
      const album = await this.#albumById(transaction, options.albumId);
      if (album === null) throw this.#albumNotFound();
      const accessChanged =
        options.input.access !== undefined && options.input.access !== album.access;
      const now = new Date();
      const [updated] = await transaction
        .update(schema.albums)
        .set({
          ...options.input,
          ...(options.input.access === "public" ? { bibSearchEnabled: false } : {}),
          ...(accessChanged ? { accessVersion: album.accessVersion + 1 } : {}),
          updatedAt: now,
        })
        .where(eq(schema.albums.id, album.id))
        .returning();
      if (updated === undefined) throw this.#albumNotFound();
      await transaction.insert(schema.auditLogs).values({
        actorUserId: options.actor.id,
        action: "album.settings.updated",
        targetType: "album",
        targetId: album.id,
        result: "success",
        changedFields: [
          ...Object.keys(options.input).sort(),
          ...(accessChanged ? ["accessVersion"] : []),
        ],
        requestId: options.requestId,
      });
      return albumView(updated);
    });
  }

  async rotateAlbumPassword(options: {
    readonly actor: InternalActor;
    readonly albumId: string;
    readonly idempotencyKey: string | undefined;
    readonly requestId: string;
  }): Promise<{ readonly album: AlbumView; readonly generatedPassword: string }> {
    requirePermission(options.actor.role, "album:configure");
    const idempotencyKey = requireHeaderIdempotency(options.idempotencyKey);
    const generatedPassword = this.#deriveAlbumPassword(
      options.actor.id,
      `rotate:${options.albumId}:${idempotencyKey}`,
    );
    const passwordHash = await this.#hasher.hash(generatedPassword);
    return this.#database.transaction(async (transaction) => {
      const actorScope = `user:${options.actor.id}`;
      const operation = `album.password.rotate:${options.albumId}`;
      const requestHash = operationRequestHash({ albumId: options.albumId });
      await lockOperationRequest(transaction, { actorScope, operation, idempotencyKey });
      const retried = await findOperationRequest(transaction, {
        actorScope,
        operation,
        idempotencyKey,
        requestHash,
      });
      if (retried !== null) {
        return { album: retried.album as AlbumView, generatedPassword };
      }
      const album = await this.#albumById(transaction, options.albumId);
      if (album === null) throw this.#albumNotFound();
      const now = new Date();
      const [updated] = await transaction
        .update(schema.albums)
        .set({
          passwordHash,
          access: "password",
          accessVersion: album.accessVersion + 1,
          updatedAt: now,
        })
        .where(eq(schema.albums.id, album.id))
        .returning();
      if (updated === undefined) throw this.#albumNotFound();
      await transaction.insert(schema.auditLogs).values({
        actorUserId: options.actor.id,
        action: "album.password.rotated",
        targetType: "album",
        targetId: album.id,
        result: "success",
        changedFields: ["passwordHash", "access", "accessVersion"],
        requestId: options.requestId,
      });
      const view = albumView(updated);
      await saveOperationRequest(transaction, {
        actorScope,
        operation,
        idempotencyKey,
        requestHash,
        result: { album: view },
      });
      return { album: view, generatedPassword };
    });
  }

  async createCategory(options: {
    readonly actor: InternalActor;
    readonly albumId: string;
    readonly name: string;
    readonly sortOrder: number;
    readonly idempotencyKey: string | undefined;
  }) {
    requirePermission(options.actor.role, "album:configure");
    const idempotencyKey = requireHeaderIdempotency(options.idempotencyKey);
    return this.#database.transaction(async (transaction) => {
      await this.#advisoryLock(
        transaction,
        `category:${options.albumId}:${options.actor.id}:${idempotencyKey}`,
      );
      const album = await this.#albumById(transaction, options.albumId);
      if (album === null) throw this.#albumNotFound();
      const [existing] = await transaction
        .select()
        .from(schema.categories)
        .where(
          and(
            eq(schema.categories.albumId, options.albumId),
            eq(schema.categories.createdBy, options.actor.id),
            eq(schema.categories.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (existing !== undefined) return categoryView(existing);
      const [created] = await transaction
        .insert(schema.categories)
        .values({
          albumId: options.albumId,
          name: options.name,
          sortOrder: options.sortOrder,
          createdBy: options.actor.id,
          idempotencyKey,
        })
        .returning();
      if (created === undefined) throw new Error("Category insert returned no row");
      return categoryView(created);
    });
  }

  async listCategories(actor: InternalActor, albumId: string) {
    requirePermission(actor.role, "album:read");
    const album = await this.#albumById(this.#database, albumId);
    if (album === null) throw this.#albumNotFound();
    const rows = await this.#database
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.albumId, albumId))
      .orderBy(asc(schema.categories.sortOrder), asc(schema.categories.id));
    return rows.map(categoryView);
  }

  async updateCategory(options: {
    readonly actor: InternalActor;
    readonly albumId: string;
    readonly categoryId: string;
    readonly input: {
      readonly name?: string | undefined;
      readonly sortOrder?: number | undefined;
      readonly enabled?: boolean | undefined;
    };
  }) {
    requirePermission(options.actor.role, "album:configure");
    const [updated] = await this.#database
      .update(schema.categories)
      .set({ ...options.input, updatedAt: new Date() })
      .where(
        and(
          eq(schema.categories.id, options.categoryId),
          eq(schema.categories.albumId, options.albumId),
        ),
      )
      .returning();
    if (updated === undefined) {
      throw new AppError({ code: "NOT_FOUND", message: "分类不存在", statusCode: 404 });
    }
    return categoryView(updated);
  }

  async createPhotoUpload(options: {
    readonly actor: InternalActor;
    readonly input: CreatePhotoUploadRequest;
    readonly idempotencyKey: string | undefined;
  }): Promise<UploadIntentView> {
    requirePermission(options.actor.role, "media:upload");
    const idempotencyKey = requireHeaderIdempotency(options.idempotencyKey);
    const intentId = await this.#database.transaction(async (transaction) => {
      await this.#advisoryLock(transaction, `upload:${options.actor.id}:${idempotencyKey}`);
      const [existing] = await transaction
        .select({ id: schema.uploadIntents.id })
        .from(schema.uploadIntents)
        .where(
          and(
            eq(schema.uploadIntents.uploaderId, options.actor.id),
            eq(schema.uploadIntents.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (existing !== undefined) return existing.id;

      const album = await this.#albumById(transaction, options.input.albumId);
      if (album === null) throw this.#albumNotFound();
      if (album.state !== "live") {
        throw new AppError({
          code: "ALBUM_NOT_LIVE",
          message: "相册未在直播中，不能创建上传任务",
          statusCode: 409,
        });
      }
      if (options.input.categoryId !== null) {
        const [category] = await transaction
          .select({ id: schema.categories.id })
          .from(schema.categories)
          .where(
            and(
              eq(schema.categories.id, options.input.categoryId),
              eq(schema.categories.albumId, album.id),
              eq(schema.categories.enabled, true),
            ),
          )
          .limit(1);
        if (category === undefined) {
          throw new AppError({ code: "BAD_REQUEST", message: "分类无效", statusCode: 400 });
        }
      }
      await this.#advisoryLock(transaction, `album-media-quota:${album.id}`);
      const countRows = await transaction
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.media)
        .where(eq(schema.media.albumId, album.id));
      if ((countRows[0]?.count ?? 0) >= 5_000) {
        throw new AppError({
          code: "MEDIA_LIMIT_EXCEEDED",
          message: "相册照片数量已达到 5000 张上限",
          statusCode: 409,
        });
      }

      const original = options.input.variants.find((variant) => variant.kind === "photo_original");
      if (original === undefined) throw new Error("Validated upload lacks original variant");
      const [createdMedia] = await transaction
        .insert(schema.media)
        .values({
          albumId: album.id,
          categoryId: options.input.categoryId,
          uploaderId: options.actor.id,
          ingestStatus: "uploading_preview",
          publicationStatus: "draft",
          width: options.input.width,
          height: options.input.height,
          mediaType: original.contentType,
          totalBytes: options.input.totalBytes,
          capturedAt: options.input.capturedAt === null ? null : new Date(options.input.capturedAt),
        })
        .returning({ id: schema.media.id });
      if (createdMedia === undefined) throw new Error("Media insert returned no row");
      const createdVariants = await transaction
        .insert(schema.mediaVariants)
        .values(
          options.input.variants.map((variant) => ({
            mediaId: createdMedia.id,
            kind: variant.kind,
            objectKey: `media/albums/${album.id}/photos/${createdMedia.id}/${variantFilename(variant.kind, variant.format)}`,
            format: variant.format,
            contentType: variant.contentType,
            width: variant.width,
            height: variant.height,
            expectedBytes: variant.bytes,
          })),
        )
        .returning({ id: schema.mediaVariants.id, kind: schema.mediaVariants.kind });
      if (original.bytes > multipartThreshold) {
        const originalVariant = createdVariants.find(
          (variant) => variant.kind === "photo_original",
        );
        if (originalVariant === undefined)
          throw new Error("Original variant insert returned no row");
        const partCount = Math.ceil(original.bytes / multipartPartBytes);
        await transaction.insert(schema.uploadParts).values(
          Array.from({ length: partCount }, (_, index) => ({
            variantId: originalVariant.id,
            partNumber: index + 1,
            expectedBytes: Math.min(
              multipartPartBytes,
              original.bytes - index * multipartPartBytes,
            ),
          })),
        );
      }
      const [intent] = await transaction
        .insert(schema.uploadIntents)
        .values({
          mediaId: createdMedia.id,
          uploaderId: options.actor.id,
          idempotencyKey,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
        })
        .returning({ id: schema.uploadIntents.id });
      if (intent === undefined) throw new Error("Upload intent insert returned no row");
      return intent.id;
    });
    return this.getUploadIntent(options.actor, intentId);
  }

  async getUploadIntent(actor: InternalActor, intentId: string): Promise<UploadIntentView> {
    const [row] = await this.#database
      .select({ intent: schema.uploadIntents, media: schema.media })
      .from(schema.uploadIntents)
      .innerJoin(schema.media, eq(schema.uploadIntents.mediaId, schema.media.id))
      .where(eq(schema.uploadIntents.id, intentId))
      .limit(1);
    if (row === undefined) throw this.#uploadNotFound();
    this.#assertUploadAccess(actor, row.media.uploaderId);
    const variants = await this.#database
      .select()
      .from(schema.mediaVariants)
      .where(eq(schema.mediaVariants.mediaId, row.media.id))
      .orderBy(asc(schema.mediaVariants.kind));
    const parts = await this.#database
      .select()
      .from(schema.uploadParts)
      .where(
        inArray(
          schema.uploadParts.variantId,
          variants.map((variant) => variant.id),
        ),
      )
      .orderBy(asc(schema.uploadParts.partNumber));
    const partsByVariant = new Map<string, typeof parts>();
    for (const part of parts) {
      const current = partsByVariant.get(part.variantId) ?? [];
      current.push(part);
      partsByVariant.set(part.variantId, current);
    }
    return {
      id: row.intent.id,
      mediaId: row.media.id,
      status: row.intent.status,
      cleanupStatus: row.intent.cleanupStatus,
      cleanupLastErrorCode: row.intent.cleanupLastErrorCode,
      ingestStatus: row.media.ingestStatus,
      publicationStatus: row.media.publicationStatus,
      expiresAt: iso(row.intent.expiresAt),
      objects: variants
        .filter((variant) => photoVariantKinds.includes(variant.kind as PhotoVariantKind))
        .map((variant) => {
          const variantParts = partsByVariant.get(variant.id) ?? [];
          return {
            kind: variant.kind as PhotoVariantKind,
            objectKey: variant.objectKey,
            expectedBytes: variant.expectedBytes,
            contentType: variant.contentType,
            completed: variant.verified,
            uploadMode: variantParts.length === 0 ? ("single" as const) : ("multipart" as const),
            multipartUploadId: variantParts.length === 0 ? null : variant.id,
            parts: variantParts.map((part) => ({
              partNumber: part.partNumber,
              expectedBytes: part.expectedBytes,
              completed: part.completedAt !== null,
              etag: part.etag,
            })),
          };
        }),
    };
  }

  async cancelUpload(options: {
    readonly actor: InternalActor;
    readonly intentId: string;
  }): Promise<UploadIntentView> {
    const now = new Date();
    await this.#database.transaction(async (transaction) => {
      await this.#advisoryLock(transaction, `upload-cleanup:${options.intentId}`);
      const [row] = await transaction
        .select({ intent: schema.uploadIntents, media: schema.media })
        .from(schema.uploadIntents)
        .innerJoin(schema.media, eq(schema.uploadIntents.mediaId, schema.media.id))
        .where(eq(schema.uploadIntents.id, options.intentId))
        .limit(1);
      if (row === undefined) throw this.#uploadNotFound();
      this.#assertUploadAccess(options.actor, row.media.uploaderId);
      if (row.intent.status === "completed" || row.intent.cleanupStatus === "completed") return;
      await transaction
        .update(schema.uploadIntents)
        .set({
          status: "cancelled",
          cleanupStatus: "pending",
          cleanupLastErrorCode: null,
          cleanupNextAttemptAt: new Date(now.getTime() + uploadCleanupInitialGraceMs),
          updatedAt: now,
        })
        .where(eq(schema.uploadIntents.id, row.intent.id));
    });
    return this.getUploadIntent(options.actor, options.intentId);
  }

  async processExpiredUploadCleanups(limit = 10, now = new Date()): Promise<number> {
    await this.#database
      .update(schema.uploadIntents)
      .set({
        status: "expired",
        cleanupStatus: "pending",
        cleanupLastErrorCode: null,
        cleanupNextAttemptAt: new Date(now.getTime() + uploadCleanupInitialGraceMs),
        updatedAt: now,
      })
      .where(
        and(eq(schema.uploadIntents.status, "active"), lte(schema.uploadIntents.expiresAt, now)),
      );
    const intents = await this.#database
      .select({ id: schema.uploadIntents.id })
      .from(schema.uploadIntents)
      .where(
        and(
          inArray(schema.uploadIntents.status, ["cancelled", "expired"]),
          inArray(schema.uploadIntents.cleanupStatus, ["pending", "processing", "failed"]),
          or(
            isNull(schema.uploadIntents.cleanupNextAttemptAt),
            lte(schema.uploadIntents.cleanupNextAttemptAt, now),
          ),
        ),
      )
      .orderBy(asc(schema.uploadIntents.cleanupNextAttemptAt), asc(schema.uploadIntents.id))
      .limit(limit);
    for (const intent of intents) await this.processUploadCleanup(intent.id, now);
    return intents.length;
  }

  async processUploadCleanup(intentId: string, now = new Date()): Promise<void> {
    const claimed = await this.#database.transaction(async (transaction) => {
      await this.#advisoryLock(transaction, `upload-cleanup:${intentId}`);
      const [row] = await transaction
        .select({ intent: schema.uploadIntents, media: schema.media })
        .from(schema.uploadIntents)
        .innerJoin(schema.media, eq(schema.uploadIntents.mediaId, schema.media.id))
        .where(eq(schema.uploadIntents.id, intentId))
        .limit(1);
      if (
        row === undefined ||
        (row.intent.status !== "cancelled" && row.intent.status !== "expired") ||
        row.intent.cleanupStatus === "completed" ||
        row.intent.cleanupStatus === "not_needed" ||
        (row.intent.cleanupNextAttemptAt !== null && row.intent.cleanupNextAttemptAt > now)
      ) {
        return null;
      }
      const [intent] = await transaction
        .update(schema.uploadIntents)
        .set({
          cleanupStatus: "processing",
          cleanupAttempts: row.intent.cleanupAttempts + 1,
          cleanupLastErrorCode: null,
          cleanupNextAttemptAt: new Date(now.getTime() + 5 * 60 * 1_000),
          updatedAt: now,
        })
        .where(eq(schema.uploadIntents.id, intentId))
        .returning();
      return intent === undefined ? null : { intent, media: row.media };
    });
    if (claimed === null) return;

    const variants = await this.#database
      .select()
      .from(schema.mediaVariants)
      .where(eq(schema.mediaVariants.mediaId, claimed.media.id));
    const parts =
      variants.length === 0
        ? []
        : await this.#database
            .select({ variantId: schema.uploadParts.variantId })
            .from(schema.uploadParts)
            .where(
              inArray(
                schema.uploadParts.variantId,
                variants.map((variant) => variant.id),
              ),
            );
    const multipartVariantIds = new Set(parts.map((part) => part.variantId));
    const preserveVerified =
      claimed.media.publicationStatus === "published" ||
      claimed.media.publicationStatus === "pending_review";
    const cleanedVariants = variants.filter((variant) => !(preserveVerified && variant.verified));
    try {
      for (const variant of variants) {
        if (multipartVariantIds.has(variant.id)) await this.#storage.abortMultipart(variant.id);
      }
      for (const variant of cleanedVariants) await this.#storage.delete(variant.objectKey);
    } catch {
      const retryDelay = Math.min(60 * 60 * 1_000, 30_000 * 2 ** claimed.intent.cleanupAttempts);
      await this.#database
        .update(schema.uploadIntents)
        .set({
          cleanupStatus: "failed",
          cleanupLastErrorCode: "UPLOAD_CLEANUP_FAILED",
          cleanupNextAttemptAt: new Date(now.getTime() + retryDelay),
          updatedAt: now,
        })
        .where(eq(schema.uploadIntents.id, intentId));
      return;
    }

    const preservedKinds = new Set(
      variants
        .filter((variant) => preserveVerified && variant.verified)
        .map((variant) => variant.kind),
    );
    const ingestStatus = preserveVerified
      ? photoVariantKinds.every((kind) => preservedKinds.has(kind))
        ? "ready"
        : [...previewVariantKinds].every((kind) => preservedKinds.has(kind))
          ? "preview_ready"
          : "failed"
      : "cancelled";
    await this.#database.transaction(async (transaction) => {
      await this.#advisoryLock(transaction, `upload-cleanup:${intentId}`);
      if (variants.length > 0) {
        await transaction.delete(schema.uploadParts).where(
          inArray(
            schema.uploadParts.variantId,
            variants.map((variant) => variant.id),
          ),
        );
      }
      if (cleanedVariants.length > 0) {
        await transaction.delete(schema.mediaVariants).where(
          inArray(
            schema.mediaVariants.id,
            cleanedVariants.map((variant) => variant.id),
          ),
        );
      }
      await transaction
        .update(schema.media)
        .set({ ingestStatus, retryable: false, updatedAt: now })
        .where(eq(schema.media.id, claimed.media.id));
      const successfulSweeps = claimed.intent.cleanupSuccessfulSweeps + 1;
      const completed = successfulSweeps >= 2;
      await transaction
        .update(schema.uploadIntents)
        .set({
          cleanupStatus: completed ? "completed" : "pending",
          cleanupSuccessfulSweeps: successfulSweeps,
          cleanupLastErrorCode: null,
          cleanupNextAttemptAt: completed
            ? now
            : new Date(now.getTime() + uploadCleanupVerificationDelayMs),
          cleanupCompletedAt: completed ? now : null,
          updatedAt: now,
        })
        .where(eq(schema.uploadIntents.id, intentId));
    });
  }

  async signUpload(options: {
    readonly actor: InternalActor;
    readonly intentId: string;
    readonly kind: PhotoVariantKind;
  }) {
    const row = await this.#uploadVariant(options.intentId, options.kind);
    this.#assertUploadAccess(options.actor, row.media.uploaderId);
    if (row.intent.status !== "active" || row.intent.expiresAt <= new Date()) {
      throw new AppError({ code: "STATE_CONFLICT", message: "上传任务已失效", statusCode: 409 });
    }
    if (row.variant.verified) {
      throw new AppError({ code: "STATE_CONFLICT", message: "该对象已经完成", statusCode: 409 });
    }
    const multipartParts = await this.#database
      .select({ id: schema.uploadParts.id })
      .from(schema.uploadParts)
      .where(eq(schema.uploadParts.variantId, row.variant.id))
      .limit(1);
    if (multipartParts.length > 0) {
      throw new AppError({
        code: "STATE_CONFLICT",
        message: "该对象必须使用分片上传",
        statusCode: 409,
      });
    }
    const signed = this.#storage.signPut({
      key: row.variant.objectKey,
      contentType: row.variant.contentType,
      bytes: row.variant.expectedBytes,
      expiresAt: new Date(Date.now() + 15 * 60 * 1_000),
    });
    if (options.kind === "photo_1920" || options.kind === "photo_original") {
      await this.#markSourceUploading(row.media.id);
    }
    return {
      url: signed.url,
      headers: signed.headers,
      expiresAt: iso(signed.expiresAt),
    };
  }

  async signUploadPart(options: {
    readonly actor: InternalActor;
    readonly intentId: string;
    readonly kind: PhotoVariantKind;
    readonly partNumber: number;
  }) {
    const row = await this.#uploadPart(options.intentId, options.kind, options.partNumber);
    this.#assertUploadAccess(options.actor, row.media.uploaderId);
    if (row.intent.status !== "active" || row.intent.expiresAt <= new Date()) {
      throw new AppError({ code: "STATE_CONFLICT", message: "上传任务已失效", statusCode: 409 });
    }
    if (row.variant.verified || row.part.completedAt !== null) {
      throw new AppError({ code: "STATE_CONFLICT", message: "该分片已经完成", statusCode: 409 });
    }
    const signed = this.#storage.signMultipartPart({
      uploadId: row.variant.id,
      partNumber: row.part.partNumber,
      contentType: row.variant.contentType,
      bytes: row.part.expectedBytes,
      expiresAt: new Date(Date.now() + 15 * 60 * 1_000),
    });
    await this.#markSourceUploading(row.media.id);
    return {
      url: signed.url,
      headers: signed.headers,
      expiresAt: iso(signed.expiresAt),
    };
  }

  async completeUploadPart(options: {
    readonly actor: InternalActor;
    readonly intentId: string;
    readonly kind: PhotoVariantKind;
    readonly partNumber: number;
    readonly etag: string;
  }): Promise<UploadIntentView> {
    const row = await this.#uploadPart(options.intentId, options.kind, options.partNumber);
    this.#assertUploadAccess(options.actor, row.media.uploaderId);
    const etag = options.etag.replace(/^"|"$/gu, "");
    const now = new Date();
    if (row.intent.status !== "active" || row.intent.expiresAt <= now) {
      throw new AppError({ code: "STATE_CONFLICT", message: "上传任务已失效", statusCode: 409 });
    }
    await this.#database.transaction(async (transaction) => {
      await this.#advisoryLock(transaction, `upload-cleanup:${options.intentId}`);
      const [intent] = await transaction
        .select()
        .from(schema.uploadIntents)
        .where(eq(schema.uploadIntents.id, options.intentId))
        .limit(1);
      const [part] = await transaction
        .select()
        .from(schema.uploadParts)
        .where(eq(schema.uploadParts.id, row.part.id))
        .limit(1);
      if (
        intent === undefined ||
        part === undefined ||
        intent.status !== "active" ||
        intent.expiresAt <= now
      ) {
        throw new AppError({ code: "STATE_CONFLICT", message: "上传任务已失效", statusCode: 409 });
      }
      if (part.completedAt !== null) {
        if (part.etag !== etag) {
          throw new AppError({
            code: "STATE_CONFLICT",
            message: "分片 ETag 冲突",
            statusCode: 409,
          });
        }
        return;
      }
      await transaction
        .update(schema.uploadParts)
        .set({ etag, completedAt: now })
        .where(eq(schema.uploadParts.id, part.id));
    });
    return this.getUploadIntent(options.actor, options.intentId);
  }

  async completeUploadObject(options: {
    readonly actor: InternalActor;
    readonly intentId: string;
    readonly kind: PhotoVariantKind;
  }): Promise<UploadIntentView> {
    const snapshot = await this.#uploadVariant(options.intentId, options.kind);
    this.#assertUploadAccess(options.actor, snapshot.media.uploaderId);
    if (snapshot.intent.status !== "active" || snapshot.intent.expiresAt <= new Date()) {
      throw new AppError({ code: "STATE_CONFLICT", message: "上传任务已失效", statusCode: 409 });
    }
    const multipartParts = await this.#database
      .select()
      .from(schema.uploadParts)
      .where(eq(schema.uploadParts.variantId, snapshot.variant.id))
      .orderBy(asc(schema.uploadParts.partNumber));
    if (multipartParts.length > 0 && !snapshot.variant.verified) {
      if (multipartParts.some((part) => part.completedAt === null || part.etag === null)) {
        throw new AppError({
          code: "STATE_CONFLICT",
          message: "仍有分片未完成",
          statusCode: 409,
        });
      }
      await this.#storage.completeMultipart({
        uploadId: snapshot.variant.id,
        key: snapshot.variant.objectKey,
        contentType: snapshot.variant.contentType,
        parts: multipartParts.map((part) => ({
          partNumber: part.partNumber,
          etag: part.etag as string,
        })),
      });
    }
    const metadata = await this.#storage.head(snapshot.variant.objectKey);
    if (
      metadata === null ||
      metadata.bytes !== snapshot.variant.expectedBytes ||
      metadata.contentType !== snapshot.variant.contentType
    ) {
      throw new AppError({
        code: "OBJECT_VERIFICATION_FAILED",
        message: "对象校验失败，请重新上传",
        statusCode: 409,
        retryable: true,
      });
    }

    await this.#database.transaction(async (transaction) => {
      await this.#advisoryLock(transaction, `upload-cleanup:${options.intentId}`);
      await this.#advisoryLock(transaction, `media:${snapshot.media.id}`);
      const [currentIntent] = await transaction
        .select()
        .from(schema.uploadIntents)
        .where(eq(schema.uploadIntents.id, options.intentId))
        .limit(1);
      if (
        currentIntent === undefined ||
        currentIntent.status !== "active" ||
        currentIntent.expiresAt <= new Date()
      ) {
        throw new AppError({ code: "STATE_CONFLICT", message: "上传任务已失效", statusCode: 409 });
      }
      const [currentVariant] = await transaction
        .select()
        .from(schema.mediaVariants)
        .where(eq(schema.mediaVariants.id, snapshot.variant.id))
        .limit(1);
      if (currentVariant === undefined) throw this.#uploadNotFound();
      if (currentVariant.verified) return;

      const now = new Date();
      await transaction
        .update(schema.mediaVariants)
        .set({
          verified: true,
          bytes: metadata.bytes,
          etag: metadata.etag,
          completedAt: now,
        })
        .where(eq(schema.mediaVariants.id, currentVariant.id));
      const variants = await transaction
        .select()
        .from(schema.mediaVariants)
        .where(eq(schema.mediaVariants.mediaId, snapshot.media.id));
      const verifiedKinds = new Set(
        variants
          .filter((variant) => variant.verified || variant.id === currentVariant.id)
          .map((variant) => variant.kind as PhotoVariantKind),
      );
      const previewReady = [...previewVariantKinds].every((kind) => verifiedKinds.has(kind));
      const allReady = photoVariantKinds.every((kind) => verifiedKinds.has(kind));
      const [currentMedia] = await transaction
        .select()
        .from(schema.media)
        .where(eq(schema.media.id, snapshot.media.id))
        .limit(1);
      if (currentMedia === undefined) throw this.#uploadNotFound();
      let publicationStatus = currentMedia.publicationStatus;
      let publishSequence = currentMedia.publishSequence;
      let publishedAt = currentMedia.publishedAt;

      if (previewReady && publicationStatus === "draft") {
        const album = await this.#albumById(transaction, currentMedia.albumId);
        if (album === null) throw this.#albumNotFound();
        if (album.publishMode === "auto") {
          const published = await this.#allocatePublication(
            transaction,
            album.id,
            currentMedia.id,
            now,
          );
          publicationStatus = "published";
          publishSequence = published.publishSequence;
          publishedAt = now;
        } else {
          publicationStatus = "pending_review";
        }
      }

      await transaction
        .update(schema.media)
        .set({
          ingestStatus: allReady
            ? "ready"
            : previewReady &&
                (currentMedia.ingestStatus === "uploading_source" ||
                  verifiedKinds.has("photo_1920") ||
                  verifiedKinds.has("photo_original"))
              ? "uploading_source"
              : previewReady
                ? "preview_ready"
                : "uploading_preview",
          publicationStatus,
          publishSequence,
          publishedAt,
          updatedAt: now,
        })
        .where(eq(schema.media.id, currentMedia.id));
      if (allReady) {
        await transaction
          .update(schema.uploadIntents)
          .set({ status: "completed", updatedAt: now })
          .where(eq(schema.uploadIntents.id, options.intentId));
        if (currentMedia.publicationStatus === "published") {
          await this.#insertLiveEvent(transaction, {
            albumId: currentMedia.albumId,
            mediaId: currentMedia.id,
            type: "media.updated",
          });
        }
      }
    });
    return this.getUploadIntent(options.actor, options.intentId);
  }

  async publishMedia(options: {
    readonly actor: InternalActor;
    readonly mediaId: string;
    readonly requestId: string;
    readonly idempotencyKey: string | undefined;
  }): Promise<void> {
    requirePermission(options.actor.role, "media:review");
    const idempotencyKey = requireHeaderIdempotency(options.idempotencyKey);
    await this.#database.transaction(async (transaction) => {
      const actorScope = `user:${options.actor.id}`;
      const operation = `media.publish:${options.mediaId}`;
      const requestHash = operationRequestHash({ mediaId: options.mediaId });
      await lockOperationRequest(transaction, { actorScope, operation, idempotencyKey });
      if (
        (await findOperationRequest(transaction, {
          actorScope,
          operation,
          idempotencyKey,
          requestHash,
        })) !== null
      ) {
        return;
      }
      await this.#advisoryLock(transaction, `media:${options.mediaId}`);
      const [media] = await transaction
        .select()
        .from(schema.media)
        .where(eq(schema.media.id, options.mediaId))
        .limit(1);
      if (media === undefined) throw this.#uploadNotFound();
      if (media.publicationStatus !== "published" && media.publicationStatus !== "pending_review") {
        throw new AppError({
          code: "STATE_CONFLICT",
          message: "媒体尚未达到可发布状态",
          statusCode: 409,
        });
      }
      if (media.publicationStatus === "pending_review") {
        await this.#allocatePublication(transaction, media.albumId, media.id, new Date());
        await transaction.insert(schema.auditLogs).values({
          actorUserId: options.actor.id,
          action: "media.published",
          targetType: "media",
          targetId: media.id,
          result: "success",
          changedFields: ["publicationStatus", "publishSequence"],
          requestId: options.requestId,
        });
      }
      await saveOperationRequest(transaction, {
        actorScope,
        operation,
        idempotencyKey,
        requestHash,
        result: { mediaId: options.mediaId },
      });
    });
  }

  async listInternalMedia(
    actor: InternalActor,
    options: {
      readonly albumId: string;
      readonly publicationStatus?:
        | (typeof schema.publicationStatusEnum.enumValues)[number]
        | undefined;
      readonly ingestStatus?: (typeof schema.ingestStatusEnum.enumValues)[number] | undefined;
      readonly ingestGroup?: "incomplete" | "failed" | undefined;
      readonly categoryId?: string | undefined;
      readonly uploaderId?: string | undefined;
      readonly bibReviewDecision?:
        | (typeof schema.bibReviewDecisionEnum.enumValues)[number]
        | undefined;
      readonly bibOcrStatus?: (typeof schema.bibOcrStatusEnum.enumValues)[number] | undefined;
      readonly gradeOptionId?: string | undefined;
      readonly classOptionId?: string | undefined;
      readonly cursor?: string | undefined;
      readonly limit: number;
    },
  ) {
    requirePermission(actor.role, "album:read");
    const album = await this.#albumById(this.#database, options.albumId);
    if (album === null) throw this.#albumNotFound();
    const cursor =
      options.cursor === undefined
        ? null
        : this.#decodeInternalCursor(options.cursor, options.albumId);
    const conditions = [eq(schema.media.albumId, options.albumId)];
    if (options.publicationStatus !== undefined) {
      conditions.push(eq(schema.media.publicationStatus, options.publicationStatus));
    }
    if (options.ingestStatus !== undefined) {
      conditions.push(eq(schema.media.ingestStatus, options.ingestStatus));
    }
    if (options.ingestGroup === "incomplete") {
      conditions.push(inArray(schema.media.ingestStatus, incompleteIngestStatuses));
    } else if (options.ingestGroup === "failed") {
      conditions.push(eq(schema.media.ingestStatus, "failed"));
    }
    if (options.categoryId !== undefined) {
      conditions.push(eq(schema.media.categoryId, options.categoryId));
    }
    if (options.uploaderId !== undefined) {
      conditions.push(eq(schema.media.uploaderId, options.uploaderId));
    }
    if (options.bibReviewDecision !== undefined) {
      const matchingReview = this.#database
        .select({ value: sql`1` })
        .from(schema.mediaBibReviews)
        .where(
          and(
            eq(schema.mediaBibReviews.mediaId, schema.media.id),
            eq(schema.mediaBibReviews.decision, options.bibReviewDecision),
          ),
        );
      if (options.bibReviewDecision === "pending") {
        const anyReview = this.#database
          .select({ value: sql`1` })
          .from(schema.mediaBibReviews)
          .where(eq(schema.mediaBibReviews.mediaId, schema.media.id));
        const pending = or(exists(matchingReview), not(exists(anyReview)));
        if (pending !== undefined) conditions.push(pending);
      } else {
        conditions.push(exists(matchingReview));
      }
    }
    if (options.bibOcrStatus !== undefined) {
      conditions.push(
        exists(
          this.#database
            .select({ value: sql`1` })
            .from(schema.mediaBibReviews)
            .where(
              and(
                eq(schema.mediaBibReviews.mediaId, schema.media.id),
                eq(schema.mediaBibReviews.ocrStatus, options.bibOcrStatus),
              ),
            ),
        ),
      );
    }
    if (options.gradeOptionId !== undefined) {
      conditions.push(
        exists(
          this.#database
            .select({ value: sql`1` })
            .from(schema.mediaBibTags)
            .where(
              and(
                eq(schema.mediaBibTags.mediaId, schema.media.id),
                eq(schema.mediaBibTags.status, "confirmed"),
                eq(schema.mediaBibTags.mappingVersion, album.bibMappingVersion),
                eq(schema.mediaBibTags.gradeOptionId, options.gradeOptionId),
                ...(options.classOptionId === undefined
                  ? []
                  : [eq(schema.mediaBibTags.classOptionId, options.classOptionId)]),
              ),
            ),
        ),
      );
    }
    if (actor.role === "uploader") {
      conditions.push(eq(schema.media.uploaderId, actor.id));
    }
    if (cursor !== null) {
      const cursorCondition = or(
        lt(schema.media.createdAt, cursor.createdAt),
        and(eq(schema.media.createdAt, cursor.createdAt), lt(schema.media.id, cursor.mediaId)),
      );
      if (cursorCondition !== undefined) conditions.push(cursorCondition);
    }
    const rows = await this.#database
      .select()
      .from(schema.media)
      .where(and(...conditions))
      .orderBy(desc(schema.media.createdAt), desc(schema.media.id))
      .limit(options.limit + 1);
    const hasMore = rows.length > options.limit;
    const page = rows.slice(0, options.limit);
    const mediaIds = page.map((media) => media.id);
    const variants =
      mediaIds.length === 0
        ? []
        : await this.#database
            .select()
            .from(schema.mediaVariants)
            .where(
              and(
                inArray(schema.mediaVariants.mediaId, mediaIds),
                eq(schema.mediaVariants.verified, true),
                isNotNull(schema.mediaVariants.bytes),
              ),
            );
    const deletionTasks =
      mediaIds.length === 0
        ? []
        : await this.#database
            .select()
            .from(schema.deletionTasks)
            .where(inArray(schema.deletionTasks.mediaId, mediaIds));
    const byMedia = new Map<string, typeof variants>();
    for (const variant of variants) {
      const current = byMedia.get(variant.mediaId) ?? [];
      current.push(variant);
      byMedia.set(variant.mediaId, current);
    }
    const deletionByMedia = new Map(deletionTasks.map((task) => [task.mediaId, task]));
    const expiresAt = new Date(Date.now() + 15 * 60 * 1_000);
    const items = page.map((media) => {
      const deletion = deletionByMedia.get(media.id) ?? null;
      return {
        id: media.id,
        albumId: media.albumId,
        uploaderId: media.uploaderId,
        categoryId: media.categoryId,
        ingestStatus: media.ingestStatus,
        publicationStatus: media.publicationStatus,
        width: media.width,
        height: media.height,
        totalBytes: media.totalBytes,
        capturedAt: media.capturedAt === null ? null : iso(media.capturedAt),
        publishSequence: media.publishSequence,
        publishedAt: media.publishedAt === null ? null : iso(media.publishedAt),
        variants: (byMedia.get(media.id) ?? [])
          .filter((variant) => photoVariantKinds.includes(variant.kind as PhotoVariantKind))
          .map((variant) => ({
            kind: variant.kind as PhotoVariantKind,
            url: this.#storage.signRead({ key: variant.objectKey, expiresAt }),
            width: variant.width,
            height: variant.height,
            bytes: variant.bytes as number,
            contentType: variant.contentType,
          })),
        deletionTask:
          deletion === null
            ? null
            : {
                id: deletion.id,
                status: deletion.status,
                attempts: deletion.attempts,
                lastErrorCode: deletion.lastErrorCode,
              },
        createdAt: iso(media.createdAt),
      };
    });
    const last = page.at(-1);
    return {
      items,
      nextCursor:
        hasMore && last !== undefined
          ? this.#encodeInternalCursor(options.albumId, last.createdAt, last.id)
          : null,
    };
  }

  async listAlbumUploaders(actor: InternalActor, albumId: string) {
    requirePermission(actor.role, "album:read");
    const album = await this.#albumById(this.#database, albumId);
    if (album === null) throw this.#albumNotFound();
    const rows = await this.#database
      .selectDistinct({
        id: schema.users.id,
        username: schema.users.username,
        displayName: schema.users.displayName,
      })
      .from(schema.media)
      .innerJoin(schema.users, eq(schema.media.uploaderId, schema.users.id))
      .where(
        and(
          eq(schema.media.albumId, albumId),
          ...(actor.role === "uploader" ? [eq(schema.users.id, actor.id)] : []),
        ),
      )
      .orderBy(asc(schema.users.displayName), asc(schema.users.id));
    return rows;
  }

  async getPublicAlbum(slug: string, visitorToken?: string) {
    const album = await this.#publicAlbumBySlug(slug);
    const unlocked = await this.#isVisitorAuthorized(album, visitorToken);
    const [faceIndex] = await this.#database
      .select({
        enabled: schema.albumFaceIndexes.enabled,
        noticeVersion: schema.albumFaceIndexes.noticeVersion,
        indexState: schema.albumFaceIndexes.indexState,
      })
      .from(schema.albumFaceIndexes)
      .where(eq(schema.albumFaceIndexes.albumId, album.id))
      .limit(1);
    const faceSearchAvailable =
      this.#config.FACE_SEARCH_GLOBAL_ENABLED &&
      unlocked &&
      album.access === "password" &&
      faceIndex?.enabled === true &&
      (faceIndex.indexState === "ready" || faceIndex.indexState === "degraded");
    const categories = await this.#database
      .select()
      .from(schema.categories)
      .where(and(eq(schema.categories.albumId, album.id), eq(schema.categories.enabled, true)))
      .orderBy(asc(schema.categories.sortOrder), asc(schema.categories.id));
    const bibSearchEnabled =
      unlocked && album.access === "password" && album.bibSearchEnabled && album.bibRuleUsable;
    const bibNumberLengths = bibSearchEnabled
      ? (
          await this.#database
            .selectDistinct({ totalLength: schema.bibPatterns.totalLength })
            .from(schema.bibPatterns)
            .where(
              and(eq(schema.bibPatterns.albumId, album.id), eq(schema.bibPatterns.enabled, true)),
            )
            .orderBy(asc(schema.bibPatterns.totalLength))
        ).map((pattern) => pattern.totalLength)
      : [];
    const bibAttributeOptions = bibSearchEnabled
      ? await this.#database
          .select({
            id: schema.bibAttributeOptions.id,
            dimension: schema.bibAttributeOptions.dimension,
            displayName: schema.bibAttributeOptions.displayName,
            sortOrder: schema.bibAttributeOptions.sortOrder,
          })
          .from(schema.bibAttributeOptions)
          .where(
            and(
              eq(schema.bibAttributeOptions.albumId, album.id),
              eq(schema.bibAttributeOptions.enabled, true),
            ),
          )
          .orderBy(
            asc(schema.bibAttributeOptions.dimension),
            asc(schema.bibAttributeOptions.sortOrder),
            asc(schema.bibAttributeOptions.id),
          )
      : [];
    const [mappingTask] = bibSearchEnabled
      ? await this.#database
          .select({ id: schema.bibRecalculationTasks.id })
          .from(schema.bibRecalculationTasks)
          .where(
            and(
              eq(schema.bibRecalculationTasks.albumId, album.id),
              eq(schema.bibRecalculationTasks.kind, "mapping"),
              inArray(schema.bibRecalculationTasks.status, ["pending", "processing", "failed"]),
            ),
          )
          .limit(1)
      : [];
    const bibAttributeFilterEnabled =
      bibSearchEnabled && album.bibMappingUsable && mappingTask === undefined;
    const gradeOptionIds = bibAttributeOptions
      .filter((option) => option.dimension === "grade")
      .map((option) => option.id);
    const classOptionIds = bibAttributeOptions
      .filter((option) => option.dimension === "class")
      .map((option) => option.id);
    const bibAttributePairs = bibAttributeFilterEnabled
      ? gradeOptionIds.flatMap((gradeOptionId) => [
          { gradeOptionId, classOptionId: null },
          ...classOptionIds.map((classOptionId) => ({ gradeOptionId, classOptionId })),
        ])
      : [];
    return {
      album,
      view: {
        slug: album.slug,
        title: album.title,
        description: album.description,
        state: album.state,
        access: album.access,
        accessRequired: album.access === "password" && !unlocked,
        previewDownloadEnabled: album.previewDownloadEnabled,
        originalDownloadEnabled: album.originalDownloadEnabled,
        privacyNotice: album.privacyNotice,
        complaintContact: album.complaintContact,
        faceSearchAvailable,
        faceSearchNoticeVersion: faceSearchAvailable ? (faceIndex.noticeVersion ?? null) : null,
        bibSearchEnabled,
        bibNumberLengths,
        bibAttributeFilterEnabled,
        bibAttributeOptions,
        bibAttributePairs,
        categories: categories.map(categoryView),
      },
      unlocked,
    };
  }

  async unlockAlbum(slug: string, password: string) {
    const album = await this.#publicAlbumBySlug(slug);
    if (album.access !== "password" || album.passwordHash === null) {
      throw new AppError({
        code: "ALBUM_PASSWORD_INVALID",
        message: "相册不可用或口令错误",
        statusCode: 404,
      });
    }
    if (!(await this.#hasher.verify(album.passwordHash, password))) {
      throw new AppError({
        code: "ALBUM_PASSWORD_INVALID",
        message: "相册不可用或口令错误",
        statusCode: 404,
      });
    }
    const rawToken = createSessionToken();
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1_000);
    await this.#database.insert(schema.visitorSessions).values({
      tokenHash: visitorTokenHash(this.#config.VISITOR_SESSION_SECRET, rawToken),
      albumId: album.id,
      accessVersion: album.accessVersion,
      expiresAt,
    });
    return { rawToken, expiresAt };
  }

  async listPublicMedia(options: {
    readonly slug: string;
    readonly visitorToken: string | undefined;
    readonly cursor: string | undefined;
    readonly categoryId: string | undefined;
    readonly limit: number;
    readonly mediaIds?: readonly string[] | undefined;
  }) {
    const album = await this.#publicAlbumBySlug(options.slug);
    if (!(await this.#isVisitorAuthorized(album, options.visitorToken))) {
      throw new AppError({
        code: "ALBUM_PASSWORD_INVALID",
        message: "相册不可用或口令错误",
        statusCode: 404,
      });
    }
    const cursor =
      options.cursor === undefined ? null : this.#decodeCursor(options.cursor, album.id);
    const [latestEvent] = await this.#database
      .select({ id: schema.liveEvents.id })
      .from(schema.liveEvents)
      .where(eq(schema.liveEvents.albumId, album.id))
      .orderBy(desc(schema.liveEvents.id))
      .limit(1);
    const conditions = [
      eq(schema.media.albumId, album.id),
      eq(schema.media.publicationStatus, "published"),
    ];
    if (options.categoryId !== undefined) {
      conditions.push(eq(schema.media.categoryId, options.categoryId));
    }
    if (options.mediaIds !== undefined) {
      conditions.push(
        options.mediaIds.length === 0
          ? sql`false`
          : inArray(schema.media.id, [...options.mediaIds]),
      );
    }
    if (cursor !== null) conditions.push(lt(schema.media.publishSequence, cursor.publishSequence));
    const rows = await this.#database
      .select()
      .from(schema.media)
      .where(and(...conditions))
      .orderBy(desc(schema.media.publishSequence), desc(schema.media.id))
      .limit(options.limit + 1);
    const hasMore = rows.length > options.limit;
    const page = rows.slice(0, options.limit);
    const variants =
      page.length === 0
        ? []
        : await this.#database
            .select()
            .from(schema.mediaVariants)
            .where(
              and(
                or(...page.map((media) => eq(schema.mediaVariants.mediaId, media.id))),
                eq(schema.mediaVariants.verified, true),
              ),
            );
    const byMedia = new Map<string, typeof variants>();
    for (const variant of variants) {
      const current = byMedia.get(variant.mediaId) ?? [];
      current.push(variant);
      byMedia.set(variant.mediaId, current);
    }
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1_000);
    const items: PublicMediaView[] = page.map((media) => {
      if (media.publishSequence === null || media.publishedAt === null) {
        throw new Error("Published media lacks publication metadata");
      }
      return {
        id: media.id,
        width: media.width,
        height: media.height,
        publishSequence: media.publishSequence,
        publishedAt: iso(media.publishedAt),
        variants: (byMedia.get(media.id) ?? [])
          .filter((variant) => publicVariantKinds.has(variant.kind as PhotoVariantKind))
          .map((variant) => {
            if (variant.bytes === null) throw new Error("Verified variant lacks size");
            return {
              kind: variant.kind as PhotoVariantKind,
              url: this.#storage.signRead({ key: variant.objectKey, expiresAt }),
              width: variant.width,
              height: variant.height,
              bytes: variant.bytes,
              contentType: variant.contentType,
            };
          }),
        downloads: {
          preview:
            album.previewDownloadEnabled &&
            (byMedia.get(media.id) ?? []).some(
              (variant) => variant.kind === "photo_1920" && variant.verified,
            ),
          original:
            album.originalDownloadEnabled &&
            (byMedia.get(media.id) ?? []).some(
              (variant) => variant.kind === "photo_original" && variant.verified,
            ),
          originalBytes:
            (byMedia.get(media.id) ?? []).find(
              (variant) => variant.kind === "photo_original" && variant.verified,
            )?.bytes ?? null,
        },
      };
    });
    const last = page.at(-1);
    return {
      items,
      eventCursor: latestEvent?.id ?? 0,
      nextCursor:
        hasMore && last?.publishSequence !== null && last?.publishSequence !== undefined
          ? this.#encodeCursor(album.id, last.publishSequence, last.id)
          : null,
    };
  }

  async getAuthorizedPublicAlbum(
    slug: string,
    visitorToken: string | undefined,
    options: { readonly requirePassword?: boolean } = {},
  ) {
    const album = await this.#publicAlbumBySlug(slug);
    const authorized = await this.#isVisitorAuthorized(album, visitorToken);
    if (!authorized || (options.requirePassword === true && album.access !== "password")) {
      throw new AppError({
        code: "ALBUM_PASSWORD_INVALID",
        message: "相册不可用或口令错误",
        statusCode: 404,
      });
    }
    return album;
  }

  async listLiveEvents(options: {
    readonly slug: string;
    readonly visitorToken: string | undefined;
    readonly afterId: number;
    readonly limit?: number;
  }) {
    const album = await this.#publicAlbumBySlug(options.slug);
    if (!(await this.#isVisitorAuthorized(album, options.visitorToken))) {
      throw new AppError({
        code: "ALBUM_PASSWORD_INVALID",
        message: "相册不可用或口令错误",
        statusCode: 404,
      });
    }
    const rows = await this.#database
      .select()
      .from(schema.liveEvents)
      .where(
        and(eq(schema.liveEvents.albumId, album.id), gt(schema.liveEvents.id, options.afterId)),
      )
      .orderBy(asc(schema.liveEvents.id))
      .limit(options.limit ?? 100);
    return {
      album,
      events: rows.map((event) => ({
        id: event.id,
        type: event.type,
        albumId: event.albumId,
        mediaId: event.mediaId,
        createdAt: iso(event.createdAt),
      })),
    };
  }

  #deriveAlbumPassword(userId: string, idempotencyKey: string): string {
    return createHmac("sha256", this.#config.ALBUM_PASSWORD_GENERATION_SECRET)
      .update(`${userId}\n${idempotencyKey}`, "utf8")
      .digest("base64url")
      .slice(0, 14);
  }

  async #transitionAlbum(options: {
    readonly actor: InternalActor;
    readonly albumId: string;
    readonly requestId: string;
    readonly from: readonly AlbumView["state"][];
    readonly to: AlbumView["state"];
    readonly action: string;
  }): Promise<AlbumView> {
    return this.#database.transaction(async (transaction) => {
      await this.#advisoryLock(transaction, `album-state:${options.albumId}`);
      const album = await this.#albumById(transaction, options.albumId);
      if (album === null) throw this.#albumNotFound();
      if (album.state === options.to) return albumView(album);
      if (!options.from.includes(album.state)) {
        throw new AppError({
          code: "STATE_CONFLICT",
          message: "当前相册状态不能执行该操作",
          statusCode: 409,
        });
      }
      const now = new Date();
      const [updated] = await transaction
        .update(schema.albums)
        .set({ state: options.to, updatedAt: now })
        .where(eq(schema.albums.id, album.id))
        .returning();
      if (updated === undefined) throw this.#albumNotFound();
      await transaction.insert(schema.auditLogs).values({
        actorUserId: options.actor.id,
        action: options.action,
        targetType: "album",
        targetId: album.id,
        result: "success",
        changedFields: ["state"],
        requestId: options.requestId,
      });
      return albumView(updated);
    });
  }

  async #advisoryLock(executor: DbExecutor, value: string): Promise<void> {
    await executor.execute(sql`select pg_advisory_xact_lock(hashtextextended(${value}, 0))`);
  }

  async #albumById(executor: DbExecutor, albumId: string) {
    const [row] = await executor
      .select()
      .from(schema.albums)
      .where(eq(schema.albums.id, albumId))
      .limit(1);
    return row ?? null;
  }

  async #publicAlbumBySlug(slug: string) {
    const [album] = await this.#database
      .select()
      .from(schema.albums)
      .where(
        and(
          eq(schema.albums.slug, slug),
          or(
            eq(schema.albums.state, "live"),
            eq(schema.albums.state, "ended"),
            eq(schema.albums.state, "archived"),
          ),
        ),
      )
      .limit(1);
    if (album === undefined) throw this.#albumNotFound();
    return album;
  }

  async #isVisitorAuthorized(
    album: typeof schema.albums.$inferSelect,
    rawToken: string | undefined,
  ): Promise<boolean> {
    if (album.access === "public") return true;
    if (rawToken === undefined) return false;
    const [session] = await this.#database
      .select({ id: schema.visitorSessions.id })
      .from(schema.visitorSessions)
      .where(
        and(
          eq(
            schema.visitorSessions.tokenHash,
            visitorTokenHash(this.#config.VISITOR_SESSION_SECRET, rawToken),
          ),
          eq(schema.visitorSessions.albumId, album.id),
          eq(schema.visitorSessions.accessVersion, album.accessVersion),
          gt(schema.visitorSessions.expiresAt, new Date()),
          isNull(schema.visitorSessions.revokedAt),
        ),
      )
      .limit(1);
    return session !== undefined;
  }

  async #uploadVariant(intentId: string, kind: PhotoVariantKind) {
    const [row] = await this.#database
      .select({
        intent: schema.uploadIntents,
        media: schema.media,
        variant: schema.mediaVariants,
      })
      .from(schema.uploadIntents)
      .innerJoin(schema.media, eq(schema.uploadIntents.mediaId, schema.media.id))
      .innerJoin(
        schema.mediaVariants,
        and(eq(schema.mediaVariants.mediaId, schema.media.id), eq(schema.mediaVariants.kind, kind)),
      )
      .where(eq(schema.uploadIntents.id, intentId))
      .limit(1);
    if (row === undefined) throw this.#uploadNotFound();
    return row;
  }

  async #uploadPart(intentId: string, kind: PhotoVariantKind, partNumber: number) {
    const [row] = await this.#database
      .select({
        intent: schema.uploadIntents,
        media: schema.media,
        variant: schema.mediaVariants,
        part: schema.uploadParts,
      })
      .from(schema.uploadIntents)
      .innerJoin(schema.media, eq(schema.uploadIntents.mediaId, schema.media.id))
      .innerJoin(
        schema.mediaVariants,
        and(eq(schema.mediaVariants.mediaId, schema.media.id), eq(schema.mediaVariants.kind, kind)),
      )
      .innerJoin(schema.uploadParts, eq(schema.uploadParts.variantId, schema.mediaVariants.id))
      .where(
        and(eq(schema.uploadIntents.id, intentId), eq(schema.uploadParts.partNumber, partNumber)),
      )
      .limit(1);
    if (row === undefined) throw this.#uploadNotFound();
    return row;
  }

  async #markSourceUploading(mediaId: string): Promise<void> {
    await this.#database
      .update(schema.media)
      .set({ ingestStatus: "uploading_source", updatedAt: new Date() })
      .where(and(eq(schema.media.id, mediaId), eq(schema.media.ingestStatus, "preview_ready")));
  }

  #assertUploadAccess(actor: InternalActor, uploaderId: string): void {
    if (actor.id === uploaderId) return;
    if (actor.role === "admin" || actor.role === "reviewer") return;
    throw new AppError({ code: "FORBIDDEN", message: "无权操作他人的上传任务", statusCode: 403 });
  }

  async #allocatePublication(
    transaction: Transaction,
    albumId: string,
    mediaId: string,
    now: Date,
  ) {
    const [album] = await transaction
      .update(schema.albums)
      .set({
        publishSequence: sql`${schema.albums.publishSequence} + 1`,
        updatedAt: now,
      })
      .where(eq(schema.albums.id, albumId))
      .returning({ publishSequence: schema.albums.publishSequence });
    if (album === undefined) throw this.#albumNotFound();
    await transaction
      .update(schema.media)
      .set({
        publicationStatus: "published",
        publishSequence: album.publishSequence,
        publishedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.media.id, mediaId));
    await this.#insertLiveEvent(transaction, { albumId, mediaId, type: "media.published" });
    return album;
  }

  async #insertLiveEvent(
    transaction: Transaction,
    event: { readonly albumId: string; readonly mediaId: string; readonly type: string },
  ): Promise<void> {
    await transaction.insert(schema.liveEvents).values({
      albumId: event.albumId,
      mediaId: event.mediaId,
      type: event.type,
      payload: {},
    });
    await transaction.execute(sql`select pg_notify(${liveEventChannel}, ${event.albumId})`);
  }

  #encodeCursor(albumId: string, publishSequence: number, mediaId: string): string {
    const encoded = Buffer.from(
      JSON.stringify({ albumId, publishSequence, mediaId }),
      "utf8",
    ).toString("base64url");
    return `${encoded}.${cursorSignature(this.#config.CURSOR_SIGNING_SECRET, encoded)}`;
  }

  #decodeCursor(value: string, albumId: string) {
    const [encoded, suppliedSignature] = value.split(".", 2);
    if (
      encoded === undefined ||
      suppliedSignature === undefined ||
      !safeEqual(cursorSignature(this.#config.CURSOR_SIGNING_SECRET, encoded), suppliedSignature)
    ) {
      throw new AppError({ code: "BAD_REQUEST", message: "分页游标无效", statusCode: 400 });
    }
    try {
      const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as {
        albumId: string;
        publishSequence: number;
        mediaId: string;
      };
      if (
        parsed.albumId !== albumId ||
        !Number.isSafeInteger(parsed.publishSequence) ||
        parsed.publishSequence < 1 ||
        typeof parsed.mediaId !== "string"
      ) {
        throw new Error("Invalid cursor payload");
      }
      return parsed;
    } catch {
      throw new AppError({ code: "BAD_REQUEST", message: "分页游标无效", statusCode: 400 });
    }
  }

  #encodeInternalCursor(albumId: string, createdAt: Date, mediaId: string): string {
    const encoded = Buffer.from(
      JSON.stringify({ albumId, createdAt: createdAt.toISOString(), mediaId }),
      "utf8",
    ).toString("base64url");
    return `${encoded}.${cursorSignature(this.#config.CURSOR_SIGNING_SECRET, encoded)}`;
  }

  #decodeInternalCursor(value: string, albumId: string) {
    const [encoded, suppliedSignature] = value.split(".", 2);
    if (
      encoded === undefined ||
      suppliedSignature === undefined ||
      !safeEqual(cursorSignature(this.#config.CURSOR_SIGNING_SECRET, encoded), suppliedSignature)
    ) {
      throw new AppError({ code: "BAD_REQUEST", message: "媒体游标无效", statusCode: 400 });
    }
    try {
      const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as {
        albumId: string;
        createdAt: string;
        mediaId: string;
      };
      const createdAt = new Date(parsed.createdAt);
      if (
        parsed.albumId !== albumId ||
        Number.isNaN(createdAt.getTime()) ||
        typeof parsed.mediaId !== "string"
      ) {
        throw new Error("invalid cursor");
      }
      return { createdAt, mediaId: parsed.mediaId };
    } catch {
      throw new AppError({ code: "BAD_REQUEST", message: "媒体游标无效", statusCode: 400 });
    }
  }

  #albumNotFound(): AppError {
    return new AppError({
      code: "ALBUM_NOT_FOUND",
      message: "相册不存在或不可访问",
      statusCode: 404,
    });
  }

  #uploadNotFound(): AppError {
    return new AppError({ code: "UPLOAD_NOT_FOUND", message: "上传任务不存在", statusCode: 404 });
  }
}
