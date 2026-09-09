"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import {
  type DerivedPhotoVariantKind,
  getWarmDerivedImageUrl,
  isWarmDerivedImageDecoded,
  loadDerivedImage,
} from "@/lib/derived-image-cache";

interface ResolvedImage {
  readonly identity: string;
  readonly url: string;
}

export function CachedPhotoImage({
  alt,
  bytes,
  className,
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
  const [active, setActive] = useState(priority);
  const [resolved, setResolved] = useState<ResolvedImage | null>(null);
  const identity = `${scope}\u0000${mediaId}\u0000${kind}\u0000${bytes}`;
  const cacheRequest = { scope, mediaId, kind, bytes };
  const warmUrl = getWarmDerivedImageUrl(cacheRequest);
  const warmDecoded = warmUrl !== null && isWarmDerivedImageDecoded(cacheRequest);
  const resolvedUrl =
    warmUrl ?? (resolved !== null && resolved.identity === identity ? resolved.url : null);

  useEffect(() => {
    if (priority || active) return;
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
  }, [active, priority]);

  useEffect(() => {
    if (!active || warmUrl !== null) return;
    let cancelled = false;
    setResolved((current) => (current?.identity === identity ? current : null));

    void loadDerivedImage({ scope, mediaId, kind, bytes, sourceUrl })
      .then(() => {
        if (cancelled) return;
        const nextUrl = getWarmDerivedImageUrl({ scope, mediaId, kind, bytes });
        setResolved({ identity, url: nextUrl ?? sourceUrl });
      })
      .catch(() => {
        if (!cancelled) setResolved({ identity, url: sourceUrl });
      });

    return () => {
      cancelled = true;
    };
  }, [active, bytes, identity, kind, mediaId, scope, sourceUrl, warmUrl]);

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
      {resolvedUrl === null ? null : (
        <Image
          alt={alt}
          className={className}
          draggable={draggable}
          fill
          onLoad={onLoad}
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
