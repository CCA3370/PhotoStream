"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { type DerivedPhotoVariantKind, loadDerivedImage } from "@/lib/derived-image-cache";

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
  const objectUrlRef = useRef<string | null>(null);
  const [active, setActive] = useState(priority);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);

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
    if (!active) return;
    let cancelled = false;
    setResolvedUrl(null);

    void loadDerivedImage({ scope, mediaId, kind, bytes, sourceUrl })
      .then((blob) => {
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        if (objectUrlRef.current !== null) URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = objectUrl;
        setResolvedUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setResolvedUrl(sourceUrl);
      });

    return () => {
      cancelled = true;
      if (objectUrlRef.current !== null) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [active, bytes, kind, mediaId, scope, sourceUrl]);

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
          unoptimized
        />
      )}
    </span>
  );
}
