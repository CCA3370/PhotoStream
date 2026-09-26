import { hasPermission, type UserRole } from "@photostream/contracts";
import type { Database } from "@photostream/db";
import { schema } from "@photostream/db";
import { and, eq, gt, inArray, sql } from "drizzle-orm";

import { AppError } from "../errors.js";
import type { InternalActor } from "./service.js";

const multipartThreshold = 16 * 1024 * 1024;
const multipartPartBytes = 8 * 1024 * 1024;
const maxActiveUploadIntentsPerUploader = 32;
const maxOutstandingUploadBytesPerUploader = 4 * 1024 * 1024 * 1024;
const maxAlbumReservedBytes = 256 * 1024 * 1024 * 1024;

export interface ProgressiveOriginalInput {
  readonly format: "jpeg" | "png" | "webp";
  readonly contentType: "image/jpeg" | "image/png" | "image/webp";
  readonly bytes: number;
}

export interface ProgressiveUploadInput {
  readonly albumId: string;
  readonly categoryId: string | null;
  readonly width: number;
  readonly height: number;
  readonly totalBytes: number;
  readonly capturedAt: string | null;
  readonly sourceHash: string | null;
  readonly allowDuplicate: boolean;
  readonly original: ProgressiveOriginalInput;
}

export interface ProgressiveDerivedVariantInput {
  readonly kind: "photo_480" | "photo_960" | "photo_1920";
  readonly format: "webp" | "jpeg";
  readonly contentType: "image/webp" | "image/jpeg";
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
}

function requirePermission(role: UserRole, permission: Parameters<typeof hasPermission>[1]): void {
  if (!hasPermission(role, permission)) {
    throw new AppError({ code: "FORBIDDEN", message: "当前角色无权执行此操作", statusCode: 403 });
  }
}

function requireIdempotency(value: string | undefined): string {
  if (value === undefined || value.length < 16 || value.length > 128) {
    throw new AppError({ code: "BAD_REQUEST", message: "缺少有效幂等键", statusCode: 400 });
  }
  return value;
}

function extensionFor(format: string): string {
  return format === "jpeg" ? "jpg" : format;
}

function variantFilename(kind: string, format: string): string {
  if (kind === "photo_original") return `original.${extensionFor(format)}`;
  return `${kind.slice("photo_".length)}.${extensionFor(format)}`;
}

function expectedDerivedDimensions(width: number, height: number, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export class ProgressiveUploadService {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  async findDuplicateSourceHashes(options: {
    readonly actor: InternalActor;
    readonly albumId: string;
    readonly hashes: readonly string[];
  }): Promise<string[]> {
    requirePermission(options.actor.role, "media:upload");
    if (options.hashes.length === 0) return [];
    const [album] = await this.#database
      .select({ id: schema.albums.id })
      .from(schema.albums)
      .where(eq(schema.albums.id, options.albumId))
      .limit(1);
    if (album === undefined) {
      throw new AppError({ code: "NOT_FOUND", message: "相册不存在", statusCode: 404 });
    }
    const rows = await this.#database
      .select({ hash: schema.media.sourceSha256 })
      .from(schema.media)
      .where(
        and(
          eq(schema.media.albumId, options.albumId),
          inArray(schema.media.sourceSha256, [...options.hashes]),
          sql`${schema.media.publicationStatus} <> 'deleted'`,
        ),
      );
    return [
      ...new Set(rows.map((row) => row.hash).filter((hash): hash is string => hash !== null)),
    ];
  }

  async createUpload(options: {
    readonly actor: InternalActor;
    readonly input: ProgressiveUploadInput;
    readonly idempotencyKey: string | undefined;
  }): Promise<string> {
    requirePermission(options.actor.role, "media:upload");
    const idempotencyKey = requireIdempotency(options.idempotencyKey);
    return this.#database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`progressive-upload:${options.actor.id}:${idempotencyKey}`}, 0))`,
      );
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

      await transaction.execute(
        sql`select pg_advisory_xact_lock_shared(hashtextextended(${`album-state:${options.input.albumId}`}, 0))`,
      );
      const [album] = await transaction
        .select()
        .from(schema.albums)
        .where(eq(schema.albums.id, options.input.albumId))
        .limit(1);
      if (album === undefined) {
        throw new AppError({ code: "NOT_FOUND", message: "相册不存在", statusCode: 404 });
      }
      if (album.state !== "draft" && album.state !== "live") {
        throw new AppError({
          code: "ALBUM_NOT_LIVE",
          message: "活动当前状态不允许上传照片",
          statusCode: 409,
        });
      }
      if (options.input.sourceHash !== null) {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`upload-source-hash:${album.id}:${options.input.sourceHash}`}, 0))`,
        );
        if (!options.input.allowDuplicate) {
          const [duplicate] = await transaction
            .select({ id: schema.media.id })
            .from(schema.media)
            .where(
              and(
                eq(schema.media.albumId, album.id),
                eq(schema.media.sourceSha256, options.input.sourceHash),
                sql`${schema.media.publicationStatus} <> 'deleted'`,
              ),
            )
            .limit(1);
          if (duplicate !== undefined) {
            throw new AppError({
              code: "STATE_CONFLICT",
              message: "检测到相同文件已存在于当前活动",
              statusCode: 409,
            });
          }
        }
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

      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`album-media-quota:${album.id}`}, 0))`,
      );
      const [mediaCount] = await transaction
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.media)
        .where(eq(schema.media.albumId, album.id));
      if ((mediaCount?.count ?? 0) >= 5_000) {
        throw new AppError({
          code: "MEDIA_LIMIT_EXCEEDED",
          message: "相册照片数量已达到 5000 张上限",
          statusCode: 409,
        });
      }

      const now = new Date();
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`uploader-upload-quota:${options.actor.id}`}, 0))`,
      );
      const [uploaderQuota] = await transaction
        .select({
          activeIntents: sql<number>`count(distinct ${schema.uploadIntents.id})::int`,
          outstandingBytes: sql<number>`coalesce(sum(case when ${schema.mediaVariants.verified} = false then ${schema.mediaVariants.expectedBytes} else 0 end), 0)::bigint`,
        })
        .from(schema.uploadIntents)
        .innerJoin(
          schema.mediaVariants,
          eq(schema.mediaVariants.mediaId, schema.uploadIntents.mediaId),
        )
        .where(
          and(
            eq(schema.uploadIntents.uploaderId, options.actor.id),
            eq(schema.uploadIntents.status, "active"),
            gt(schema.uploadIntents.expiresAt, now),
          ),
        );
      if ((uploaderQuota?.activeIntents ?? 0) >= maxActiveUploadIntentsPerUploader) {
        throw new AppError({
          code: "MEDIA_LIMIT_EXCEEDED",
          message: "同时进行的上传任务过多，请等待现有上传完成后重试",
          statusCode: 409,
        });
      }
      if (
        Number(uploaderQuota?.outstandingBytes ?? 0) + options.input.original.bytes >
        maxOutstandingUploadBytesPerUploader
      ) {
        throw new AppError({
          code: "MEDIA_LIMIT_EXCEEDED",
          message: "未完成上传占用已达到上限，请等待现有上传完成后重试",
          statusCode: 409,
        });
      }
      const [albumQuota] = await transaction
        .select({
          reservedBytes: sql<number>`coalesce(sum(${schema.mediaVariants.expectedBytes}), 0)::bigint`,
        })
        .from(schema.mediaVariants)
        .innerJoin(schema.media, eq(schema.mediaVariants.mediaId, schema.media.id))
        .where(
          and(
            eq(schema.media.albumId, album.id),
            sql`${schema.media.publicationStatus} <> 'deleted'`,
          ),
        );
      if (
        Number(albumQuota?.reservedBytes ?? 0) + options.input.original.bytes >
        maxAlbumReservedBytes
      ) {
        throw new AppError({
          code: "MEDIA_LIMIT_EXCEEDED",
          message: "相册已达到 256 GiB 上传配额",
          statusCode: 409,
        });
      }

      const [createdMedia] = await transaction
        .insert(schema.media)
        .values({
          albumId: album.id,
          categoryId: options.input.categoryId,
          uploaderId: options.actor.id,
          ingestStatus: "uploading_source",
          publicationStatus: "hidden",
          width: options.input.width,
          height: options.input.height,
          mediaType: options.input.original.contentType,
          totalBytes: options.input.totalBytes,
          sourceSha256: options.input.sourceHash,
          capturedAt: options.input.capturedAt === null ? null : new Date(options.input.capturedAt),
          hiddenAt: now,
        })
        .returning({ id: schema.media.id });
      if (createdMedia === undefined) throw new Error("Media insert returned no row");

      const [originalVariant] = await transaction
        .insert(schema.mediaVariants)
        .values({
          mediaId: createdMedia.id,
          kind: "photo_original",
          objectKey: `media/albums/${album.id}/photos/${createdMedia.id}/${variantFilename("photo_original", options.input.original.format)}`,
          format: options.input.original.format,
          contentType: options.input.original.contentType,
          width: options.input.width,
          height: options.input.height,
          expectedBytes: options.input.original.bytes,
        })
        .returning({ id: schema.mediaVariants.id });
      if (originalVariant === undefined) throw new Error("Original variant insert returned no row");

      if (options.input.original.bytes > multipartThreshold) {
        const partCount = Math.ceil(options.input.original.bytes / multipartPartBytes);
        await transaction.insert(schema.uploadParts).values(
          Array.from({ length: partCount }, (_, index) => ({
            variantId: originalVariant.id,
            partNumber: index + 1,
            expectedBytes: Math.min(
              multipartPartBytes,
              options.input.original.bytes - index * multipartPartBytes,
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
  }

  async registerDerivedVariant(options: {
    readonly actor: InternalActor;
    readonly intentId: string;
    readonly variant: ProgressiveDerivedVariantInput;
  }): Promise<void> {
    requirePermission(options.actor.role, "media:upload");
    await this.#database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`progressive-variant:${options.intentId}:${options.variant.kind}`}, 0))`,
      );
      const [row] = await transaction
        .select({ intent: schema.uploadIntents, media: schema.media })
        .from(schema.uploadIntents)
        .innerJoin(schema.media, eq(schema.uploadIntents.mediaId, schema.media.id))
        .where(eq(schema.uploadIntents.id, options.intentId))
        .limit(1);
      if (row === undefined) {
        throw new AppError({
          code: "UPLOAD_NOT_FOUND",
          message: "上传任务不存在",
          statusCode: 404,
        });
      }
      if (
        row.media.uploaderId !== options.actor.id &&
        !hasPermission(options.actor.role, "media:review")
      ) {
        throw new AppError({
          code: "FORBIDDEN",
          message: "当前角色无权访问该上传任务",
          statusCode: 403,
        });
      }

      await transaction.execute(
        sql`select pg_advisory_xact_lock_shared(hashtextextended(${`album-state:${row.media.albumId}`}, 0))`,
      );
      const [[albumState], [currentIntent]] = await Promise.all([
        transaction
          .select({ state: schema.albums.state })
          .from(schema.albums)
          .where(eq(schema.albums.id, row.media.albumId))
          .limit(1),
        transaction
          .select({
            status: schema.uploadIntents.status,
            expiresAt: schema.uploadIntents.expiresAt,
          })
          .from(schema.uploadIntents)
          .where(eq(schema.uploadIntents.id, options.intentId))
          .limit(1),
      ]);
      if (
        albumState === undefined ||
        (albumState.state !== "draft" && albumState.state !== "live") ||
        currentIntent?.status !== "active" ||
        currentIntent.expiresAt <= new Date()
      ) {
        throw new AppError({ code: "STATE_CONFLICT", message: "上传任务已失效", statusCode: 409 });
      }

      const maxEdges = { photo_480: 480, photo_960: 960, photo_1920: 1_920 } as const;
      const expected = expectedDerivedDimensions(
        row.media.width,
        row.media.height,
        maxEdges[options.variant.kind],
      );
      if (options.variant.width !== expected.width || options.variant.height !== expected.height) {
        throw new AppError({
          code: "BAD_REQUEST",
          message: "派生图尺寸不符合固定规格",
          statusCode: 400,
        });
      }
      const expectedType = options.variant.format === "jpeg" ? "image/jpeg" : "image/webp";
      if (options.variant.contentType !== expectedType) {
        throw new AppError({
          code: "BAD_REQUEST",
          message: "派生图格式与 Content-Type 不一致",
          statusCode: 400,
        });
      }

      const [existing] = await transaction
        .select()
        .from(schema.mediaVariants)
        .where(
          and(
            eq(schema.mediaVariants.mediaId, row.media.id),
            eq(schema.mediaVariants.kind, options.variant.kind),
          ),
        )
        .limit(1);
      if (existing !== undefined) {
        if (
          existing.format === options.variant.format &&
          existing.contentType === options.variant.contentType &&
          existing.width === options.variant.width &&
          existing.height === options.variant.height &&
          existing.expectedBytes === options.variant.bytes
        ) {
          return;
        }
        throw new AppError({
          code: "STATE_CONFLICT",
          message: "同一派生图已经使用不同规格登记",
          statusCode: 409,
        });
      }
      if (row.intent.status !== "active" || row.intent.expiresAt <= new Date()) {
        throw new AppError({ code: "STATE_CONFLICT", message: "上传任务已失效", statusCode: 409 });
      }

      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`uploader-upload-quota:${row.media.uploaderId}`}, 0))`,
      );
      const [uploaderQuota] = await transaction
        .select({
          outstandingBytes: sql<number>`coalesce(sum(case when ${schema.mediaVariants.verified} = false then ${schema.mediaVariants.expectedBytes} else 0 end), 0)::bigint`,
        })
        .from(schema.uploadIntents)
        .innerJoin(
          schema.mediaVariants,
          eq(schema.mediaVariants.mediaId, schema.uploadIntents.mediaId),
        )
        .where(
          and(
            eq(schema.uploadIntents.uploaderId, row.media.uploaderId),
            eq(schema.uploadIntents.status, "active"),
            gt(schema.uploadIntents.expiresAt, new Date()),
          ),
        );
      if (
        Number(uploaderQuota?.outstandingBytes ?? 0) + options.variant.bytes >
        maxOutstandingUploadBytesPerUploader
      ) {
        throw new AppError({
          code: "MEDIA_LIMIT_EXCEEDED",
          message: "未完成上传占用已达到上限，请等待现有上传完成后重试",
          statusCode: 409,
        });
      }

      const [albumQuota] = await transaction
        .select({
          reservedBytes: sql<number>`coalesce(sum(${schema.mediaVariants.expectedBytes}), 0)::bigint`,
        })
        .from(schema.mediaVariants)
        .innerJoin(schema.media, eq(schema.mediaVariants.mediaId, schema.media.id))
        .where(
          and(
            eq(schema.media.albumId, row.media.albumId),
            sql`${schema.media.publicationStatus} <> 'deleted'`,
          ),
        );
      if (Number(albumQuota?.reservedBytes ?? 0) + options.variant.bytes > maxAlbumReservedBytes) {
        throw new AppError({
          code: "MEDIA_LIMIT_EXCEEDED",
          message: "相册已达到 256 GiB 上传配额",
          statusCode: 409,
        });
      }

      await transaction.insert(schema.mediaVariants).values({
        mediaId: row.media.id,
        kind: options.variant.kind,
        objectKey: `media/albums/${row.media.albumId}/photos/${row.media.id}/${variantFilename(options.variant.kind, options.variant.format)}`,
        format: options.variant.format,
        contentType: options.variant.contentType,
        width: options.variant.width,
        height: options.variant.height,
        expectedBytes: options.variant.bytes,
      });
    });
  }
}
