"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { isAlbumDataSaverActive } from "@/lib/album-data-saver";
import { clientGet } from "@/lib/client-api";
import {
  type DerivedPhotoVariantKind,
  getWarmDerivedImageUrl,
  isWarmDerivedImageDecoded,
  loadDerivedImage,
  markDerivedImageDecoded,
  readCachedDerivedImage,
  retainDerivedImage,
  subscribeDerivedImages,
} from "@/lib/derived-image-cache";
import { gridThumbnailRootMargin, gridThumbnailUpgradeDelayMs } from "@/lib/grid-thumbnail-policy";
import { recordMediaCacheDiagnostic } from "@/lib/media-blob-cache";

interface ResolvedImage {
  readonly identity: string;
  readonly url: string;
}

interface FallbackState {
  readonly identity: string;
  readonly mode: "direct" | "failed";
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function CachedPhotoImage({
  alt,
  bytes,
  className,
  cacheOnly = false,
  draggable,
  kind,
  mediaId,
  onLoad,
  priority = false,
  refreshUrl,
  scope,
  sizes,
  sourceUrl,
}: Readonly<{
  alt: string;
  bytes: number;
  className?: string;
  cacheOnly?: boolean;
  draggable?: boolean;
  kind: DerivedPhotoVariantKind;
  mediaId: string;
  onLoad?: () => void;
  priority?: boolean;
  refreshUrl?: () => Promise<string>;
  scope: string;
  sizes: string;
  sourceUrl: string;
}>) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const [, setCacheRevision] = useState(0);
  const [fallback, setFallback] = useState<FallbackState | null>(null);
  const [active, setActive] = useState(priority);
  const [resolved, setResolved] = useState<ResolvedImage | null>(null);
  const [failedMicroUrl, setFailedMicroUrl] = useState<string | null>(null);
  const identity = `${scope}\u0000${mediaId}\u0000${kind}\u0000${bytes}`;
  const cacheRequest = { scope, mediaId, kind, bytes };
  const telemetryScope = scope === "public-media" ? undefined : scope;
  const warmUrl = getWarmDerivedImageUrl(cacheRequest);
  const warmDecoded = warmUrl !== null && isWarmDerivedImageDecoded(cacheRequest);
  const resolvedUrl =
    warmUrl ?? (resolved !== null && resolved.identity === identity ? resolved.url : null);
  const fallbackMode = fallback?.identity === identity ? fallback.mode : null;
  const displayUrl =
    fallbackMode === "direct" ? sourceUrl : fallbackMode === "failed" ? null : resolvedUrl;
  const deferredGridThumbnail = kind === "photo_480" && !cacheOnly && !priority;
  const microUrl =
    deferredGridThumbnail && scope !== "public-media"
      ? `/api/v1/public/albums/${encodeURIComponent(scope)}/media/${encodeURIComponent(mediaId)}/micro-preview`
      : null;
  const microFailed = microUrl !== null && failedMicroUrl === microUrl;

  useEffect(() => {
    if (cacheOnly || priority) return;
    const host = hostRef.current;
    if (host === null) return;
    if (!("IntersectionObserver" in window)) {
      setActive(true);
      return;
    }

    let timer: number | null = null;
    const clearTimer = () => {
      if (timer === null) return;
      window.clearTimeout(timer);
      timer = null;
    };
    const observer = new IntersectionObserver(
      (entries) => {
        const intersecting = entries.some((entry) => entry.isIntersecting);
        if (deferredGridThumbnail) {
          if (!intersecting) {
            clearTimer();
            setActive(false);
            return;
          }
          if (timer !== null) return;
          timer = window.setTimeout(() => {
            timer = null;
            setActive(true);
          }, gridThumbnailUpgradeDelayMs);
          return;
        }
        if (!intersecting) return;
        setActive(true);
        observer.disconnect();
      },
      { rootMargin: deferredGridThumbnail ? gridThumbnailRootMargin : "800px 0px" },
    );
    observer.observe(host);
    return () => {
      clearTimer();
      observer.disconnect();
    };
  }, [cacheOnly, deferredGridThumbnail, priority]);

  useEffect(
    () =>
      subscribeDerivedImages(() => setCacheRevision((value) => value + 1), {
        scope,
        mediaId,
        kind,
        bytes,
      }),
    [scope, mediaId, kind, bytes],
  );

  useEffect(
    () => retainDerivedImage({ scope, mediaId, kind, bytes }),
    [scope, mediaId, kind, bytes],
  );

  useEffect(() => {
    if ((!active && !priority && !cacheOnly) || warmUrl !== null) return;
    let cancelled = false;
    const controller =
      deferredGridThumbnail && !cacheOnly && !isAlbumDataSaverActive()
        ? new AbortController()
        : null;
    setResolved((current) => (current?.identity === identity ? current : null));
    const request = { scope, mediaId, kind, bytes };
    const work = cacheOnly
      ? readCachedDerivedImage(request)
      : loadDerivedImage({
          ...request,
          sourceUrl,
          ...(controller === null ? {} : { signal: controller.signal }),
          refreshUrl:
            refreshUrl ??
            (async () => {
              const path =
                scope === "public-media"
                  ? `/api/v1/media/${encodeURIComponent(mediaId)}/variants/${kind}`
                  : `/api/v1/public/albums/${encodeURIComponent(scope)}/media/${encodeURIComponent(mediaId)}/variants/${kind}`;
              return (await clientGet<{ url: string }>(path)).url;
            }),
        });
    void work
      .then(() => {
        if (cancelled) return;
        const nextUrl = getWarmDerivedImageUrl(request);
        if (nextUrl !== null) {
          setResolved({ identity, url: nextUrl });
          setFallback((current) => (current?.identity === identity ? null : current));
        }
      })
      .catch((error: unknown) => {
        if (cancelled || cacheOnly || isAbortError(error)) return;
        recordMediaCacheDiagnostic("directFallback", telemetryScope);
        setFallback({ identity, mode: "direct" });
      });
    return () => {
      cancelled = true;
      controller?.abort();
    };
  }, [
    active,
    priority,
    cacheOnly,
    bytes,
    deferredGridThumbnail,
    identity,
    kind,
    mediaId,
    refreshUrl,
    scope,
    sourceUrl,
    telemetryScope,
    warmUrl,
  ]);

  useEffect(() => {
    if (!warmDecoded || onLoad === undefined) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) onLoad();
    });
    return () => {
      cancelled = true;
    };
  }, [onLoad, warmDecoded]);

  return (
    <span className="absolute inset-0" ref={hostRef}>
      {microUrl !== null && !microFailed && displayUrl === null ? (
        <Image
          alt=""
          aria-hidden="true"
          className="scale-[1.015] object-cover blur-[1px]"
          fill
          loading="eager"
          onError={() => setFailedMicroUrl(microUrl)}
          sizes={sizes}
          src={microUrl}
          unoptimized
        />
      ) : null}
      {displayUrl === null ? (
        fallbackMode === "failed" ? (
          <span className="absolute inset-0 grid place-items-center text-xs text-white/70">
            图片加载失败，请重新打开重试
          </span>
        ) : null
      ) : (
        <Image
          alt={alt}
          className={className}
          draggable={draggable}
          fill
          onError={() => {
            if (cacheOnly) return;
            if (fallbackMode !== "direct") {
              recordMediaCacheDiagnostic("directFallback", telemetryScope);
            }
            setFallback({
              identity,
              mode: fallbackMode === "direct" ? "failed" : "direct",
            });
          }}
          onLoad={() => {
            if (fallbackMode !== "direct") markDerivedImageDecoded(cacheRequest);
            onLoad?.();
          }}
          priority={priority}
          sizes={sizes}
          src={displayUrl}
          style={
            fallbackMode !== "direct" && warmDecoded ? { filter: "none", opacity: 1 } : undefined
          }
          unoptimized
        />
      )}
    </span>
  );
}
