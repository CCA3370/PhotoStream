import {
  type DerivedPhotoVariantKind,
  type PhotoVariantKind,
  type PublicMediaView,
} from "@photostream/contracts";
import type { Database } from "@photostream/db";
import { schema } from "@photostream/db";
import { and, eq, isNotNull } from "drizzle-orm";

import { AppError } from "../errors.js";
import type { ObjectStorage } from "./object-storage.js";
import { previewExpiresAt } from "./preview-expiry.js";
import type { PhotoService } from "./service.js";

const publicVariantKinds = new Set<PhotoVariantKind>(["photo_480", "photo_960", "photo_1920"]);

function iso(value: Date): string {
  return value.toISOString();
}

export class PhotoShareService {
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
    const { album } = await this.#photoService.getPublicAlbum(options.slug);
    await this.#assertShare({ ...options, albumId: album.id, accessVersion: album.accessVersion });
    return this.#mediaView(album.id, options.mediaId, { preview: false, original: false });
  }

  async refreshSharedVariant(options: {
    readonly slug: string;
    readonly mediaId: string;
    readonly shareId: string;
    readonly kind: DerivedPhotoVariantKind;
  }) {
    if (!publicVariantKinds.has(options.kind)) throw this.#notFound();
    const { album } = await this.#photoService.getPublicAlbum(options.slug);
    await this.#assertShare({ ...options, albumId: album.id, accessVersion: album.accessVersion });
    await this.#publishedMedia(album.id, options.mediaId);
    const [variant] = await this.#database
      .select()
      .from(schema.mediaVariants)
      .where(
        and(
          eq(schema.mediaVariants.mediaId, options.mediaId),
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
        and(
          eq(schema.mediaVariants.mediaId, media.id),
          eq(schema.mediaVariants.verified, true),
        ),
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

  #notFound(): AppError {
    return new AppError({
      code: "NOT_FOUND",
      message: "分享链接无效或已失效",
      statusCode: 404,
    });
  }
}
