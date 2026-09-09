"use client";

import Image, { type ImageProps } from "next/image";
import { useEffect, useRef, useState } from "react";
import { clientGet } from "@/lib/client-api";
import { loadMediaBlob } from "@/lib/media-blob-cache";

// Keep internal media separate from public album caches. Only the rotating CDN
// signature is excluded; image-processing and other functional parameters remain.
export function internalImageKey(src: string): string {
  const url = new URL(src);
  url.searchParams.delete("auth_key");
  url.hash = "";
  return url.toString();
}

interface FallbackState {
  readonly source: string;
  readonly failed: boolean;
}

export function InternalCachedImage({
  src,
  mediaId,
  variantKind,
  onError,
  ...props
}: Omit<ImageProps, "src" | "onError"> & {
  readonly src: string;
  readonly mediaId?: string | null;
  readonly variantKind?: string | undefined;
  readonly onError?: () => void;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [resolved, setResolved] = useState<{ source: string; url: string } | null>(null);
  const [fallback, setFallback] = useState<FallbackState | null>(null);
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const direct = !/^https?:\/\//.test(src);
  const stableSource = direct ? src : internalImageKey(src);
  const sourceRef = useRef(src);
  sourceRef.current = src;
  const eager = props.loading === "eager" || props.priority || props.preload;

  useEffect(() => {
    if (direct || eager || visible) return;
    const element = host.current;
    if (element === null) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [direct, eager, visible]);

  useEffect(() => {
    if (direct || (!visible && !eager)) return;
    let disposed = false;
    let objectUrl: string | null = null;
    void loadMediaBlob({
      cacheName: "photostream-internal-images-v1",
      key: stableSource,
      expectedBytes: null,
      sourceUrl: sourceRef.current,
      ...(mediaId && variantKind && variantKind !== "photo_original"
        ? {
            refreshUrl: async () => {
              const result = await clientGet<{ url: string }>(
                `/api/v1/media/${encodeURIComponent(mediaId)}/variants/${encodeURIComponent(variantKind)}`,
              );
              return result.url;
            },
          }
        : {}),
    })
      .then((blob) => {
        if (disposed) return;
        objectUrl = URL.createObjectURL(blob);
        setResolved({ source: stableSource, url: objectUrl });
        setFallback((current) => (current?.source === stableSource ? null : current));
      })
      .catch(() => {
        if (!disposed) setFallback({ source: stableSource, failed: false });
      });
    return () => {
      disposed = true;
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
  }, [direct, eager, mediaId, stableSource, variantKind, visible]);

  const fallbackState = fallback?.source === stableSource ? fallback : null;
  const cachedDisplay = resolved?.source === stableSource ? resolved.url : null;
  const display = direct
    ? src
    : fallbackState?.failed
      ? null
      : fallbackState !== null
        ? src
        : cachedDisplay;
  const usingDirectFallback = !direct && fallbackState !== null && !fallbackState.failed;

  return (
    <span className="absolute inset-0" ref={host}>
      {display === null ? null : (
        <Image
          {...props}
          src={display}
          unoptimized
          onError={() => {
            if (!direct && !usingDirectFallback) {
              setFallback({ source: stableSource, failed: false });
              return;
            }
            if (usingDirectFallback) setFallback({ source: stableSource, failed: true });
            errorRef.current?.();
          }}
        />
      )}
    </span>
  );
}
