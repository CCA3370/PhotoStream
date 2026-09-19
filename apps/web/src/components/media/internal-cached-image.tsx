"use client";

import Image, { type ImageProps } from "next/image";
import { useEffect, useRef, useState } from "react";
import { clientGet } from "@/lib/client-api";
import { internalImageKey } from "@/lib/internal-media-url";
import { findLocalReviewPhotoByMediaId } from "@/lib/local-review-queue";
import { loadMediaBlob } from "@/lib/media-blob-cache";

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

    const resolveImage = async (): Promise<void> => {
      if (mediaId) {
        try {
          const localPhoto = await findLocalReviewPhotoByMediaId(mediaId);
          if (localPhoto !== null && !disposed) {
            objectUrl = URL.createObjectURL(localPhoto.originalBlob);
            setResolved({ source: stableSource, url: objectUrl });
            return;
          }
        } catch {
          // Local IndexedDB is an optimization. Fall through to the remote source.
        }
      }

      const blob = await loadMediaBlob({
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
      });
      if (disposed) return;
      objectUrl = URL.createObjectURL(blob);
      setResolved({ source: stableSource, url: objectUrl });
    };

    void resolveImage().catch(() => {
      if (!disposed) errorRef.current?.();
    });
    return () => {
      disposed = true;
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
  }, [direct, eager, mediaId, stableSource, variantKind, visible]);

  const cachedDisplay = resolved?.source === stableSource ? resolved.url : null;
  // Remote HTTP(S) media is never rendered directly from a signed CDN URL.
  // It must pass through loadMediaBlob first so concurrent requests coalesce and
  // successfully fetched bytes enter the PhotoStream media cache before display.
  const display = direct ? src : cachedDisplay;

  return (
    <span className="absolute inset-0" ref={host}>
      {display === null ? null : (
        <Image
          {...props}
          src={display}
          unoptimized
          onError={() => {
            if (!direct) {
              setResolved((current) => (current?.source === stableSource ? null : current));
            }
            errorRef.current?.();
          }}
        />
      )}
    </span>
  );
}
