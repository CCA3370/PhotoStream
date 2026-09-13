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

  async getAuthorizedMedia(options: {
    readonly slug: string;
    readonly visitorToken: string | undefined;
    readonly mediaId: string;
  }): Promise<PublicMediaView> {
    const album = await this.#photoService.getAuthorizedPublicAlbum(
      options.slug,
      options.visitorToken,
    );
    return this.#mediaView(album.id, options.mediaId, {
      preview: album.previewDownloadEnabled,
      original: album.originalDownloadEnabled,
    });
  }

  async getSharedMedia(options: {
    readonly slug: string;
    readonly mediaId: string;
    readonly shareId: string;
  }): Promise<PublicMediaView> {
    const context = await this.#sharedContext(options);
    return this.#mediaView(context.album.id, options.mediaId, { preview: true, original: true });
  }

  async getSharedLikeState(options: {
    readonly slug: string;
    readonly mediaId: string;
    readonly shareId: string;
    readonly viewerId: string;
  }): Promise<MediaLikeState> {
    const context = await this.#sharedContext(options);
    const likeService = this.#requireLikeService();
    const [state] = await likeService.listStates({
      albumId: context.album.id,
      mediaIds: [options.mediaId],
      viewerId: options.viewerId,
    });
    return state ?? { mediaId: options.mediaId, count: 0, likedByViewer: false };
  }

  async setSharedLike(options: {
    readonly slug: string;
    readonly mediaId: string;
    readonly shareId: string;
    readonly viewerId: string;
    readonly liked: boolean;
  }): Promise<MediaLikeState> {
    const context = await this.#sharedContext(options);
    return this.#requireLikeService().setLike({
      albumId: context.album.id,
      mediaId: options.mediaId,
      viewerId: options.viewerId,
      liked: options.liked,
    });
  }

  async issueSharedOriginalView(options: {
    readonly slug: string;
    readonly mediaId: string;
    readonly shareId: string;
  }) {
    return this.#issueSharedMediaAccess({ ...options, kind: "original", intent: "view" });
  }

  async issueSharedDownload(options: {
    readonly slug: string;
    readonly mediaId: string;
    readonly shareId: string;
    readonly kind: DownloadKind;
    readonly visitorId: string;
  }) {
    return this.#issueSharedMediaAccess({ ...options, intent: "download" });
  }

  async refreshSharedVariant(options: {
    readonly slug: string;
    readonly mediaId: string;
    readonly shareId: string;
    readonly kind: DerivedPhotoVariantKind;
  }) {
    if (!publicVariantKinds.has(options.kind)) throw this.#notFound();
    const context = await this.#sharedContext(options);
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
    readonly slug: string;
    readonly mediaId: string;
    readonly shareId: string;
    readonly kind: DownloadKind;
    readonly intent: "download" | "view";
    readonly visitorId?: string;
  }) {
    const context = await this.#sharedContext(options);
    const variantKind = options.kind === "preview" ? "photo_1920" : "photo_original";
    const [variant] = await this.#database
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
    if (variant === undefined || variant.bytes === null) {
      throw new AppError({
        code: "DOWNLOAD_NOT_READY",
        message: "该文件尚未上传完成",
        statusCode: 409,
        retryable: true,
      });
    }

    const expiresAt = new Date(Date.now() + 5 * 60 * 1_000);
    const filename = `${safeFilenamePart(context.album.title)}-${context.media.id.slice(0, 8)}-${options.kind}.${variant.format === "jpeg" ? "jpg" : variant.format}`;
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
      url: this.#storage.signRead({ key: variant.objectKey, expiresAt }),
      filename,
      bytes: variant.bytes,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async #sharedContext(options: {
    readonly slug: string;
    readonly mediaId: string;
    readonly shareId: string;
  }) {
    const album = await this.#publicAlbum(options.slug);
    await this.#assertShare({ ...options, albumId: album.id, accessVersion: album.accessVersion });
    const media = await this.#publishedMedia(album.id, options.mediaId);
    return { album, media };
  }

  async #publicAlbum(slug: string) {
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
    if (album === undefined) throw this.#notFound();
    return album;
  }

  async #mediaView(
    albumId: string,
    mediaId: string,
    downloads: { readonly preview: boolean; readonly original: boolean },
  ): Promise<PublicMediaView> {
    const media = await this.#publishedMedia(albumId, mediaId);
    const variants = await this.#database
      .select()
      .from(schema.mediaVariants)
      .where(
        and(eq(schema.mediaVariants.mediaId, media.id), eq(schema.mediaVariants.verified, true)),
      );
    if (media.publishSequence === null || media.publishedAt === null) throw this.#notFound();
    const expiresAt = previewExpiresAt(2 * 60 * 60 * 1_000);
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
        preview: downloads.preview && preview1920 !== undefined,
        original: downloads.original && original !== undefined,
        originalBytes: downloads.original ? (original?.bytes ?? null) : null,
      },
    };
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

  async #assertShare(options: {
    readonly albumId: string;
    readonly mediaId: string;
    readonly shareId: string;
    readonly accessVersion: number;
  }): Promise<void> {
    const [share] = await this.#database
      .select({ id: schema.photoShares.id })
      .from(schema.photoShares)
      .where(
        and(
          eq(schema.photoShares.id, options.shareId),
          eq(schema.photoShares.albumId, options.albumId),
          eq(schema.photoShares.mediaId, options.mediaId),
          eq(schema.photoShares.accessVersion, options.accessVersion),
        ),
      )
      .limit(1);
    if (share === undefined) throw this.#notFound();
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
