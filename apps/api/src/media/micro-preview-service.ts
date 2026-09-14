import { hasPermission, type SignedUpload, type UserRole } from "@photostream/contracts";
import {
  type MicroPreviewUploadRequest,
  microPreviewDimensions,
} from "@photostream/contracts/micro-preview";
import type { Database } from "@photostream/db";
import { schema } from "@photostream/db";
import { and, eq, isNull, or } from "drizzle-orm";

import { AppError } from "../errors.js";
import type { ObjectStorage } from "./object-storage.js";
import { previewExpiresAt } from "./preview-expiry.js";
import type { PhotoService } from "./service.js";

interface InternalActor {
  readonly id: string;
  readonly role: UserRole;
}

export class MicroPreviewService {
  readonly #database: Database;
  readonly #storage: ObjectStorage;
  readonly #photoService: PhotoService;

  constructor(options: {
    readonly database: Database;
    readonly storage: ObjectStorage;
    readonly photoService: PhotoService;
  }) {
    this.#database = options.database;
    this.#storage = options.storage;
    this.#photoService = options.photoService;
  }

  async signUpload(options: {
    readonly actor: InternalActor;
    readonly mediaId: string;
    readonly input: MicroPreviewUploadRequest;
  }): Promise<SignedUpload> {
    const media = await this.#ownedMedia(options.actor, options.mediaId);
    const expected = microPreviewDimensions(media.width, media.height);
    if (options.input.width !== expected.width || options.input.height !== expected.height) {
      throw new AppError({
        code: "UPLOAD_INVALID",
        message: "极小缩略图尺寸不符合 240px 长边规格",
        statusCode: 400,
      });
    }

    const objectKey = `media/albums/${media.albumId}/photos/${media.id}/photo_240`;
    const [existing] = await this.#database
      .select()
      .from(schema.mediaMicroPreviews)
      .where(eq(schema.mediaMicroPreviews.mediaId, media.id))
      .limit(1);
    if (existing?.verified === true) {
      const unchanged =
        existing.objectKey === objectKey &&
        existing.format === options.input.format &&
        existing.contentType === options.input.contentType &&
        existing.width === options.input.width &&
        existing.height === options.input.height &&
        existing.expectedBytes === options.input.bytes;
      if (!unchanged) {
        throw new AppError({
          code: "STATE_CONFLICT",
          message: "极小缩略图已经完成，不能更换规格",
          statusCode: 409,
        });
      }
    } else {
      const now = new Date();
      await this.#database
        .insert(schema.mediaMicroPreviews)
        .values({
          mediaId: media.id,
          albumId: media.albumId,
          objectKey,
          format: options.input.format,
          contentType: options.input.contentType,
          width: options.input.width,
          height: options.input.height,
          expectedBytes: options.input.bytes,
          verified: false,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: schema.mediaMicroPreviews.mediaId,
          set: {
            albumId: media.albumId,
            objectKey,
            format: options.input.format,
            contentType: options.input.contentType,
            width: options.input.width,
            height: options.input.height,
            expectedBytes: options.input.bytes,
            bytes: null,
            etag: null,
            verified: false,
            completedAt: null,
            updatedAt: now,
          },
        });
    }

    const signed = await this.#storage.signPut({
      key: objectKey,
      contentType: options.input.contentType,
      bytes: options.input.bytes,
      expiresAt: new Date(Date.now() + 15 * 60 * 1_000),
    });
    return {
      url: signed.url,
      headers: signed.headers,
      expiresAt: signed.expiresAt.toISOString(),
    };
  }

  async completeUpload(options: {
    readonly actor: InternalActor;
    readonly mediaId: string;
  }): Promise<{ readonly ok: true }> {
    const media = await this.#ownedMedia(options.actor, options.mediaId);
    const [preview] = await this.#database
      .select()
      .from(schema.mediaMicroPreviews)
      .where(eq(schema.mediaMicroPreviews.mediaId, media.id))
      .limit(1);
    if (preview === undefined) {
      throw new AppError({
        code: "UPLOAD_NOT_FOUND",
        message: "极小缩略图上传任务不存在",
        statusCode: 404,
      });
    }

    const object = await this.#storage.head(preview.objectKey);
    if (
      object === null ||
      object.bytes !== preview.expectedBytes ||
      object.contentType !== preview.contentType
    ) {
      throw new AppError({
        code: "OBJECT_VERIFICATION_FAILED",
        message: "极小缩略图对象校验失败",
        statusCode: 409,
        retryable: true,
      });
    }

    await this.#database
      .update(schema.mediaMicroPreviews)
      .set({
        bytes: object.bytes,
        etag: object.etag,
        verified: true,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.mediaMicroPreviews.mediaId, media.id));
    return { ok: true };
  }

  async publicUrl(options: {
    readonly slug: string;
    readonly mediaId: string;
    readonly visitorToken: string | undefined;
  }): Promise<string> {
    const album = await this.#photoService.getAuthorizedPublicAlbum(
      options.slug,
      options.visitorToken,
    );
    const [preview] = await this.#database
      .select({ objectKey: schema.mediaMicroPreviews.objectKey })
      .from(schema.mediaMicroPreviews)
      .innerJoin(schema.media, eq(schema.media.id, schema.mediaMicroPreviews.mediaId))
      .where(
        and(
          eq(schema.mediaMicroPreviews.mediaId, options.mediaId),
          eq(schema.mediaMicroPreviews.albumId, album.id),
          eq(schema.mediaMicroPreviews.verified, true),
          eq(schema.media.albumId, album.id),
          eq(schema.media.publicationStatus, "published"),
        ),
      )
      .limit(1);
    if (preview === undefined) {
      throw new AppError({
        code: "MEDIA_NOT_FOUND",
        message: "极小缩略图不存在",
        statusCode: 404,
      });
    }
    return this.#storage.signRead({
      key: preview.objectKey,
      expiresAt: previewExpiresAt(15 * 60 * 1_000),
      stable: true,
    });
  }

  async cleanupOrphans(limit = 100): Promise<number> {
    const rows = await this.#database
      .select({
        mediaId: schema.mediaMicroPreviews.mediaId,
        objectKey: schema.mediaMicroPreviews.objectKey,
      })
      .from(schema.mediaMicroPreviews)
      .leftJoin(schema.media, eq(schema.media.id, schema.mediaMicroPreviews.mediaId))
      .where(or(isNull(schema.media.id), eq(schema.media.publicationStatus, "deleted")))
      .limit(limit);

    let cleaned = 0;
    for (const row of rows) {
      try {
        if ((await this.#storage.head(row.objectKey)) !== null) {
          await this.#storage.delete(row.objectKey);
        }
        await this.#database
          .delete(schema.mediaMicroPreviews)
          .where(eq(schema.mediaMicroPreviews.mediaId, row.mediaId));
        cleaned += 1;
      } catch {
        // Keep the row so the next maintenance sweep can retry safely.
      }
    }
    return cleaned;
  }

  async #ownedMedia(actor: InternalActor, mediaId: string) {
    if (!hasPermission(actor.role, "media:upload")) {
      throw new AppError({ code: "FORBIDDEN", message: "没有上传权限", statusCode: 403 });
    }
    const [media] = await this.#database
      .select({
        id: schema.media.id,
        albumId: schema.media.albumId,
        uploaderId: schema.media.uploaderId,
        width: schema.media.width,
        height: schema.media.height,
        publicationStatus: schema.media.publicationStatus,
      })
      .from(schema.media)
      .where(eq(schema.media.id, mediaId))
      .limit(1);
    if (media === undefined) {
      throw new AppError({ code: "MEDIA_NOT_FOUND", message: "媒体不存在", statusCode: 404 });
    }
    if (media.publicationStatus === "deleted") {
      throw new AppError({ code: "STATE_CONFLICT", message: "媒体已删除", statusCode: 409 });
    }
    if (actor.role !== "admin" && media.uploaderId !== actor.id) {
      throw new AppError({
        code: "FORBIDDEN",
        message: "不能修改其他上传者的媒体",
        statusCode: 403,
      });
    }
    return media;
  }
}
