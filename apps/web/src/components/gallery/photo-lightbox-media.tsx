"use client";

import type { PublicMediaView } from "@photostream/contracts";

import { CachedPhotoImage } from "@/components/gallery/cached-photo-image";
import { selectLightboxVariantKind } from "@/lib/lightbox-image-policy";
import { cn } from "@/lib/utils";

const neighborScale = 0.93;

type LightboxVariantKind = "photo_960" | "photo_1920";

interface NetworkInformationLike {
  readonly saveData?: boolean;
  readonly effectiveType?: string;
}

export function lightboxVariant(media: PublicMediaView, kind: LightboxVariantKind) {
  return media.variants.find((candidate) => candidate.kind === kind) ?? null;
}

export function selectDisplayVariant(
  media: PublicMediaView,
  viewportWidth = 0,
  viewportHeight = 0,
) {
  const has960 = lightboxVariant(media, "photo_960") !== null;
  const has1920 = lightboxVariant(media, "photo_1920") !== null;
  const connection =
    typeof navigator === "undefined"
      ? undefined
      : (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
  const preferred = selectLightboxVariantKind({
    mediaWidth: media.width,
    mediaHeight: media.height,
    viewportWidth,
    viewportHeight,
    devicePixelRatio: typeof window === "undefined" ? 1 : window.devicePixelRatio,
    saveData: connection?.saveData,
    effectiveType: connection?.effectiveType,
    has960,
    has1920,
  });
  if (preferred === null) return null;
  return (
    lightboxVariant(media, preferred) ??
    lightboxVariant(media, preferred === "photo_1920" ? "photo_960" : "photo_1920")
  );
}

export function fittedImageWidth(media: PublicMediaView): string {
  return `min(100%, calc(100dvh * ${media.width / media.height}))`;
}

export function lightboxSlideScale(side: -1 | 0 | 1, offset: number, width: number): number {
  if (width <= 0) return side === 0 ? 1 : neighborScale;
  const centerDistance = Math.min(1, Math.abs(side * width + offset) / width);
  return 1 - (1 - neighborScale) * centerDistance;
}

export function LightboxNeighborSlide({
  media,
  offset,
  scale,
  settling,
  slug,
  viewportHeight,
  viewportWidth,
}: Readonly<{
  media: PublicMediaView | null;
  offset: number;
  scale: number;
  settling: boolean;
  slug?: string | undefined;
  viewportHeight: number;
  viewportWidth: number;
}>) {
  if (media === null) return null;
  const source = selectDisplayVariant(media, viewportWidth, viewportHeight);
  if (source === null) return null;
  const thumbnail = media.variants.find((item) => item.kind === "photo_480");

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 will-change-transform",
        settling && "transition-transform duration-180 ease-out motion-reduce:transition-none",
      )}
      data-swipe-slide
      style={{ transform: `translate3d(${offset}px, 0, 0) scale(${scale})` }}
    >
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ aspectRatio: `${media.width} / ${media.height}`, width: fittedImageWidth(media) }}
      >
        {thumbnail ? (
          <CachedPhotoImage
            alt=""
            bytes={thumbnail.bytes}
            className="object-contain"
            cacheOnly
            kind="photo_480"
            mediaId={media.id}
            scope={slug ?? "public-media"}
            sizes="100vw"
            sourceUrl=""
          />
        ) : null}
        <CachedPhotoImage
          cacheOnly
          alt=""
          bytes={source.bytes}
          className="object-contain"
          draggable={false}
          kind={source.kind === "photo_1920" ? "photo_1920" : "photo_960"}
          mediaId={media.id}
          scope={slug ?? "public-media"}
          sizes="100vw"
          sourceUrl={source.url}
        />
      </div>
    </div>
  );
}
