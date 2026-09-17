import type {
  DerivedPhotoVariantKind,
  DownloadKind,
  PhotoVariantKind,
  PublicMediaView,
} from "@photostream/contracts";
import type { Database } from "@photostream/db";
import { schema } from "@photostream/db";
import { and, eq, isNotNull, or } from "drizzle-orm";

import { AppError } from "../errors.js";
import type { MediaLikeService, MediaLikeState } from "./like-service.js";
import type { ObjectStorage } from "./object-storage.js";
import type { OperationsService } from "./operations-service.js";
import { previewExpiresAt } from "./preview-expiry.js";
import type { PhotoService } from "./service.js";

const publicVariantKinds = new Set<PhotoVariantKind>(["photo_480", "photo_960", "photo_1920"]);

function iso(value: Date): string {
  return value.toISOString();
}

function safeFilenamePart(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 60);
  return normalized || "album";
}

export class PhotoShareService {
  readonly #database: Database;
  readonly #storage: ObjectStorage;
  readonly #photoService: PhotoService;
  readonly #likeService: MediaLikeService | undefined;
  readonly #operationsService: OperationsService | undefined;

  constructor(options: {
    readonly database: Database;
    readonly storage: ObjectStorage;
    readonly photoService: PhotoService;
    readonly likeService?: MediaLikeService;
    readonly operationsService?: OperationsService;
  }) {
    this.#database = options.database;
    this.#storage = options.storage;
    this.#photoService = options.photoService;
    this.#likeService = options.likeService;
    this.#operationsService = options.operationsService;
  }

  async createShare(options: {
    readonly slug: string;
    readonly visitorToken: string | undefined;
    readonly mediaId: string;
  }): Promise<{ readonly shareId: string }> {
    const album = await this.#photoService.getAuthorizedPublicAlbum(
      options.slug,
      options.visitorToken,
    );
    await this.#publishedMedia(album.id, options.mediaId);
    const [share] = await this.#database
      .insert(schema.photoShares)
      .values({
        albumId: album.id,
        mediaId: options.mediaId,
        accessVersion: album.accessVersion,
      })
      .returning({ id: schema.photoShares.id });
    if (share === undefined) throw new Error("Photo share insert returned no row");
    return { shareId: share.id };
  }

  async getShareView(options: { readonly shareId: string }): Promise<{
    readonly slug: string;
    readonly title: string;
    readonly description: string | null;
    readonly media: PublicMediaView;
  }> {
    const context = await this.#sharedContextById(options.shareId);
    return {
      slug: context.album.slug,
      title: context.album.title,
      description: context.album.description,
      media: await this.#mediaView(context.album.id, context.media.id),
    };
  }

  async sharedMicroPreviewUrl(options: { readonly shareId: string }): Promise<string> {
    const context = await this.#sharedContextById(options.shareId);
    const [preview] = await this.#database
      .select({ objectKey: schema.mediaMicroPreviews.objectKey })
      .from(schema.mediaMicroPreviews)
      .where(
        and(
          eq(schema.mediaMicroPreviews.mediaId, context.media.id),
          eq(schema.mediaMicroPreviews.albumId, context.album.id),
          eq(schema.mediaMicroPreviews.verified, true),
        ),
      )
      .limit(1);
    if (preview === undefined) throw this.#notFound();
    return this.#storage.signRead({
      key: preview.objectKey,
      expiresAt: previewExpiresAt(15 * 60 * 1_000),
      stable: true,
    });
  }

  async getAuthorizedMedia(options: {
    readonly slug: string;
    readonly visitorToken: string | undefined;
    readonly mediaId: string;
  }): Promise<PublicMediaView> {
    const album = await this.#photoService.getAuthorizedPublicAlbum(
      options.slug,
      options.visitorToken,
    );
    return this.#mediaView(album.id, options.mediaId);
  }

  async getSharedLikeState(options: {
    readonly shareId: string;
    readonly viewerId: string;
  }): Promise<MediaLikeState> {
    const context = await this.#sharedContextById(options.shareId);
    const likeService = this.#requireLikeService();
    const [state] = await likeService.listStates({
      albumId: context.album.id,
      mediaIds: [context.media.id],
      viewerId: options.viewerId,
    });
    return state ?? { mediaId: context.media.id, count: 0, likedByViewer: false };
  }

  async setSharedLike(options: {
    readonly shareId: string;
    readonly viewerId: string;
    readonly liked: boolean;
  }): Promise<MediaLikeState> {
    const context = await this.#sharedContextById(options.shareId);
    return this.#requireLikeService().setLike({
      albumId: context.album.id,
      mediaId: context.media.id,
      viewerId: options.viewerId,
      liked: options.liked,
    });
  }

  async issueSharedOriginalView(options: { readonly shareId: string }) {
    return this.#issueSharedMediaAccess({ ...options, kind: "original", intent: "view" });
  }

  async issueSharedDownload(options: {
    readonly shareId: string;
    readonly kind: DownloadKind;
    readonly visitorId: string;
  }) {
    return this.#issueSharedMediaAccess({ ...options, intent: "download" });
  }

  async refreshSharedVariant(options: {
    readonly shareId: string;
    readonly kind: DerivedPhotoVariantKind;
  }) {
    if (!publicVariantKinds.has(options.kind)) throw this.#notFound();
    const context = await this.#sharedContextById(options.shareId);
    const activeRevisionId = await this.#activeRevisionId(context.media.id);
    if (activeRevisionId !== null) {
      const [editVariant] = await this.#database
        .select()
        .from(schema.mediaEditVariants)
        .where(
          and(
            eq(schema.mediaEditVariants.editRevisionId, activeRevisionId),
            eq(schema.mediaEditVariants.kind, options.kind),
            eq(schema.mediaEditVariants.verified, true),
            isNotNull(schema.mediaEditVariants.bytes),
          ),
        )
        .limit(1);
      if (editVariant === undefined || editVariant.bytes === null) throw this.#notFound();
      const expiresAt = previewExpiresAt(2 * 60 * 60 * 1_000);
      return {
        url: this.#storage.signRead({ key: editVariant.objectKey, expiresAt, stable: true }),
        expiresAt: expiresAt.toISOString(),
        bytes: editVariant.bytes,
      };
    }
    const [variant] = await this.#database
      .select()
      .from(schema.mediaVariants)
      .where(
        and(
          eq(schema.mediaVariants.mediaId, context.media.id),
          eq(schema.mediaVariants.kind, options.kind),
          eq(schema.mediaVariants.verified, true),
          isNotNull(schema.mediaVariants.bytes),
        ),
      )
      .limit(1);
    if (variant === undefined || variant.bytes === null) throw this.#notFound();
    const expiresAt = previewExpiresAt(2 * 60 * 60 * 1_000);
    return {
      url: this.#storage.signRead({ key: variant.objectKey, expiresAt, stable: true }),
      expiresAt: expiresAt.toISOString(),
      bytes: variant.bytes,
    };
  }

  async #issueSharedMediaAccess(options: {
    readonly shareId: string;
    readonly kind: DownloadKind;
    readonly intent: "download" | "view";
    readonly visitorId?: string;
  }) {
    const context = await this.#sharedContextById(options.shareId);
    const variantKind = options.kind === "preview" ? "photo_1920" : "photo_original";
    const activeRevisionId = await this.#activeRevisionId(context.media.id);
    let selected:
      | { readonly objectKey: string; readonly format: string; readonly bytes: number }
      | undefined;
    if (activeRevisionId !== null) {
      const editKind = options.kind === "preview" ? "photo_1920" : "photo_download";
      const [editVariant] = await this.#database
        .select()
        .from(schema.mediaEditVariants)
        .where(
          and(
            eq(schema.mediaEditVariants.editRevisionId, activeRevisionId),
            eq(schema.mediaEditVariants.kind, editKind),
            eq(schema.mediaEditVariants.verified, true),
            isNotNull(schema.mediaEditVariants.bytes),
          ),
        )
        .limit(1);
      if (editVariant !== undefined && editVariant.bytes !== null) {
        selected = {
          objectKey: editVariant.objectKey,
          format: editVariant.format,
          bytes: editVariant.bytes,
        };
      }
    } else {
      const [baseVariant] = await this.#database
        .select()
        .from(schema.mediaVariants)
        .where(
          and(
            eq(schema.mediaVariants.mediaId, context.media.id),
            eq(schema.mediaVariants.kind, variantKind),
            eq(schema.mediaVariants.verified, true),
            isNotNull(schema.mediaVariants.bytes),
          ),
        )
        .limit(1);
      if (baseVariant !== undefined && baseVariant.bytes !== null) {
        selected = {
          objectKey: baseVariant.objectKey,
          format: baseVariant.format,
          bytes: baseVariant.bytes,
        };
      }
    }
    if (selected === undefined) {
      throw new AppError({
        code: "DOWNLOAD_NOT_READY",
        message: "当前版本的文件尚未准备完成",
        statusCode: 409,
        retryable: true,
      });
    }

    const expiresAt = new Date(Date.now() + 5 * 60 * 1_000);
    const filename = `${safeFilenamePart(context.album.title)}-${context.media.id.slice(0, 8)}-${options.kind}.${selected.format === "jpeg" ? "jpg" : selected.format}`;
    if (options.intent === "download" && options.visitorId !== undefined) {
      await this.#operationsService?.recordAnalytics({
        albumId: context.album.id,
        visitorId: options.visitorId,
        eventType: "download",
        mediaId: context.media.id,
        variantKind,
      });
    }
    return {
      url: this.#storage.signRead({ key: selected.objectKey, expiresAt }),
      filename,
      bytes: selected.bytes,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async #sharedContextById(shareId: string) {
    const [share] = await this.#database
      .select({
        albumId: schema.photoShares.albumId,
        mediaId: schema.photoShares.mediaId,
        accessVersion: schema.photoShares.accessVersion,
      })
      .from(schema.photoShares)
      .where(eq(schema.photoShares.id, shareId))
      .limit(1);
    if (share === undefined) throw this.#notFound();

    const [album] = await this.#database
      .select()
      .from(schema.albums)
      .where(
        and(
          eq(schema.albums.id, share.albumId),
          eq(schema.albums.accessVersion, share.accessVersion),
          or(
            eq(schema.albums.state, "live"),
            eq(schema.albums.state, "ended"),
            eq(schema.albums.state, "archived"),
          ),
        ),
      )
      .limit(1);
    if (album === undefined) throw this.#notFound();

    const media = await this.#publishedMedia(album.id, share.mediaId);
    return { album, media };
  }

  async #mediaView(albumId: string, mediaId: string): Promise<PublicMediaView> {
    const media = await this.#publishedMedia(albumId, mediaId);
    if (media.publishSequence === null || media.publishedAt === null) throw this.#notFound();
    const expiresAt = previewExpiresAt(2 * 60 * 60 * 1_000);
    const activeRevisionId = await this.#activeRevisionId(media.id);

    if (activeRevisionId !== null) {
      const variants = await this.#database
        .select()
        .from(schema.mediaEditVariants)
        .where(
          and(
            eq(schema.mediaEditVariants.editRevisionId, activeRevisionId),
            eq(schema.mediaEditVariants.verified, true),
          ),
        );
      const download = variants.find(
        (variant) => variant.kind === "photo_download" && variant.bytes !== null,
      );
      const browserVariants = variants.filter(
        (variant) => variant.kind !== "photo_download" && variant.bytes !== null,
      );
      return {
        id: media.id,
        width: media.width,
        height: media.height,
        publishSequence: media.publishSequence,
        publishedAt: iso(media.publishedAt),
        variants: browserVariants.map((variant) => ({
          kind: variant.kind as PhotoVariantKind,
          url: this.#storage.signRead({ key: variant.objectKey, expiresAt, stable: true }),
          width: variant.width,
          height: variant.height,
          bytes: variant.bytes as number,
          contentType: variant.contentType,
        })),
        downloads: {
          preview: browserVariants.some((variant) => variant.kind === "photo_1920"),
          original: download !== undefined,
          originalBytes: download?.bytes ?? null,
        },
      };
    }

    const variants = await this.#database
      .select()
      .from(schema.mediaVariants)
      .where(
        and(eq(schema.mediaVariants.mediaId, media.id), eq(schema.mediaVariants.verified, true)),
      );
    const original = variants.find(
      (variant) => variant.kind === "photo_original" && variant.bytes !== null,
    );
    const preview1920 = variants.find(
      (variant) => variant.kind === "photo_1920" && variant.bytes !== null,
    );
    return {
      id: media.id,
      width: media.width,
      height: media.height,
      publishSequence: media.publishSequence,
      publishedAt: iso(media.publishedAt),
      variants: variants
        .filter(
          (variant) =>
            publicVariantKinds.has(variant.kind as PhotoVariantKind) && variant.bytes !== null,
        )
        .map((variant) => ({
          kind: variant.kind as PhotoVariantKind,
          url: this.#storage.signRead({ key: variant.objectKey, expiresAt, stable: true }),
          width: variant.width,
          height: variant.height,
          bytes: variant.bytes as number,
          contentType: variant.contentType,
        })),
      downloads: {
        preview: preview1920 !== undefined,
        original: original !== undefined,
        originalBytes: original?.bytes ?? null,
      },
    };
  }

  async #activeRevisionId(mediaId: string): Promise<string | null> {
    const [state] = await this.#database
      .select({ activeRevisionId: schema.mediaEditStates.activeRevisionId })
      .from(schema.mediaEditStates)
      .where(eq(schema.mediaEditStates.mediaId, mediaId))
      .limit(1);
    return state?.activeRevisionId ?? null;
  }

  async #publishedMedia(albumId: string, mediaId: string) {
    const [media] = await this.#database
      .select()
      .from(schema.media)
      .where(
        and(
          eq(schema.media.id, mediaId),
          eq(schema.media.albumId, albumId),
          eq(schema.media.publicationStatus, "published"),
          isNotNull(schema.media.publishSequence),
          isNotNull(schema.media.publishedAt),
        ),
      )
      .limit(1);
    if (media === undefined) throw this.#notFound();
    return media;
  }

  #requireLikeService(): MediaLikeService {
    if (this.#likeService === undefined) throw new Error("Photo share likes are not configured");
    return this.#likeService;
  }

  #notFound(): AppError {
    return new AppError({
      code: "NOT_FOUND",
      message: "分享链接无效或已失效",
      statusCode: 404,
    });
  }
}
