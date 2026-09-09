"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
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

interface ResolvedImage {
  readonly identity: string;
  readonly url: string;
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
  scope: string;
  sizes: string;
  sourceUrl: string;
}>) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const [, setCacheRevision] = useState(0);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(priority);
  const [resolved, setResolved] = useState<ResolvedImage | null>(null);
  const identity = `${scope}\u0000${mediaId}\u0000${kind}\u0000${bytes}`;
  const cacheRequest = { scope, mediaId, kind, bytes };
  const warmUrl = getWarmDerivedImageUrl(cacheRequest);
  const warmDecoded = warmUrl !== null && isWarmDerivedImageDecoded(cacheRequest);
  const resolvedUrl =
    warmUrl ?? (resolved !== null && resolved.identity === identity ? resolved.url : null);

  useEffect(() => {
    if (cacheOnly || priority || active) return;
    const host = hostRef.current;
    if (host === null) return;
    if (!("IntersectionObserver" in window)) {
      setActive(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setActive(true);
        observer.disconnect();
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, [active, cacheOnly, priority]);

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
    setFailed(false);
    setResolved((current) => (current?.identity === identity ? current : null));
    const request = { scope, mediaId, kind, bytes };
    const work = cacheOnly
      ? readCachedDerivedImage(request)
      : loadDerivedImage({
          ...request,
          sourceUrl,
          refreshUrl: async () => {
            const path =
              scope === "public-media"
                ? `/api/v1/media/${encodeURIComponent(mediaId)}/variants/${kind}`
                : `/api/v1/public/albums/${encodeURIComponent(scope)}/media/${encodeURIComponent(mediaId)}/variants/${kind}`;
            return (await clientGet<{ url: string }>(path)).url;
          },
        });
    void work
      .then(() => {
        if (cancelled) return;
        const nextUrl = getWarmDerivedImageUrl(request);
        if (nextUrl !== null) setResolved({ identity, url: nextUrl });
      })
      .catch(() => {
        if (!cancelled && !cacheOnly) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [active, priority, cacheOnly, bytes, identity, kind, mediaId, scope, sourceUrl, warmUrl]);

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
      {resolvedUrl === null ? (
        failed ? (
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
          onLoad={() => {
            markDerivedImageDecoded(cacheRequest);
            onLoad?.();
          }}
          priority={priority}
          sizes={sizes}
          src={resolvedUrl}
          style={warmDecoded ? { filter: "none", opacity: 1 } : undefined}
          unoptimized
        />
      )}
    </span>
  );
}
