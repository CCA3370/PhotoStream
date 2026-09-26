"use client";

import Image, { type ImageProps } from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";

import { clientGet } from "@/lib/client-api";
import { internalImageKey } from "@/lib/internal-media-url";
import {
  findLocalReviewPhotoByMediaId,
  getLocalReviewPhoto,
  type LocalReviewPhoto,
} from "@/lib/local-review-queue";
import { loadMediaBlob } from "@/lib/media-blob-cache";

export type InternalPreviewVariantKind =
  | "photo_240"
  | "photo_480"
  | "photo_960"
  | "photo_1920";

interface RemoteVariantSource {
  readonly kind: string;
  readonly url: string;
}

const previewKinds = new Set<InternalPreviewVariantKind>([
  "photo_240",
  "photo_480",
  "photo_960",
  "photo_1920",
]);

function previewKind(value: string | undefined): InternalPreviewVariantKind | null {
  return value !== undefined && previewKinds.has(value as InternalPreviewVariantKind)
    ? (value as InternalPreviewVariantKind)
    : null;
}

function localVariantBlob(
  photo: LocalReviewPhoto,
  kind: InternalPreviewVariantKind,
): Blob | null {
  if (kind === "photo_240") return photo.microPreviewBlob ?? null;
  return photo.variants.find((variant) => variant.kind === kind)?.blob ?? null;
}

async function freshRemoteVariantUrl(
  mediaId: string,
  kind: InternalPreviewVariantKind,
): Promise<string> {
  const path =
    kind === "photo_240"
      ? `/api/v1/media/${encodeURIComponent(mediaId)}/micro-preview`
      : `/api/v1/media/${encodeURIComponent(mediaId)}/variants/${encodeURIComponent(kind)}`;
  const result = await clientGet<{ readonly url: string }>(path);
  return result.url;
}

export function InternalCachedImage({
  src,
  mediaId,
  localPhotoId,
  localPhoto,
  variantKind,
  remoteVariants,
  localVariantOrder,
  remoteVariantOrder,
  onError,
  ...props
}: Omit<ImageProps, "src" | "onError"> & {
  readonly src: string | null;
  readonly mediaId?: string | null;
  readonly localPhotoId?: string | null;
  readonly localPhoto?: LocalReviewPhoto | null | undefined;
  readonly variantKind?: string | undefined;
  readonly remoteVariants?: readonly RemoteVariantSource[] | undefined;
  readonly localVariantOrder?: readonly InternalPreviewVariantKind[] | undefined;
  readonly remoteVariantOrder?: readonly InternalPreviewVariantKind[] | undefined;
  readonly onError?: () => void;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const failedCandidatesRef = useRef(new Set<string>());
  const [visible, setVisible] = useState(false);
  const [retryRevision, setRetryRevision] = useState(0);
  const [resolved, setResolved] = useState<{
    readonly strategy: string;
    readonly candidateId: string;
    readonly url: string;
  } | null>(null);
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const eager = props.loading === "eager" || props.priority || props.preload;

  const exactKind = previewKind(variantKind);
  const strategy = useMemo(
    () =>
      JSON.stringify({
        src,
        mediaId: mediaId ?? null,
        localPhotoId: localPhotoId ?? null,
        localOrder: localVariantOrder ?? (exactKind === null ? [] : [exactKind]),
        remoteOrder: remoteVariantOrder ?? (exactKind === null ? [] : [exactKind]),
        remoteVariants:
          remoteVariants?.map((variant) => [variant.kind, internalImageKey(variant.url)]) ?? [],
      }),
    [
      exactKind,
      localPhotoId,
      localVariantOrder,
      mediaId,
      remoteVariantOrder,
      remoteVariants,
      src,
    ],
  );

  useEffect(() => {
    failedCandidatesRef.current.clear();
    setResolved(null);
    setRetryRevision(0);
  }, [strategy]);

  useEffect(() => {
    if (eager || visible) return;
    const element = host.current;
    if (element === null) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [eager, visible]);

  useEffect(() => {
    if (!eager && !visible) return;
    let disposed = false;
    let objectUrl: string | null = null;

    const resolveImage = async (): Promise<void> => {
      const failed = failedCandidatesRef.current;
      const localOrder =
        localVariantOrder ?? (exactKind === null ? [] : ([exactKind] as const));
      const remoteOrder =
        remoteVariantOrder ?? (exactKind === null ? [] : ([exactKind] as const));

      let local = localPhoto ?? null;
      if (local === null && localPhotoId) {
        try {
          local = await getLocalReviewPhoto(localPhotoId);
        } catch {
          local = null;
        }
      }
      if (local === null && mediaId) {
        try {
          local = await findLocalReviewPhotoByMediaId(mediaId);
        } catch {
          local = null;
        }
      }
      if (disposed) return;

      if (local !== null) {
        for (const kind of localOrder) {
          const candidateId = `local:${kind}`;
          if (failed.has(candidateId)) continue;
          const blob = localVariantBlob(local, kind);
          if (blob === null || blob.size === 0) continue;
          objectUrl = URL.createObjectURL(blob);
          setResolved({ strategy, candidateId, url: objectUrl });
          return;
        }
      }

      const attemptedRemoteKeys = new Set<string>();
      if (mediaId) {
        for (const kind of remoteOrder) {
          const candidateId = `remote:${kind}`;
          if (failed.has(candidateId)) continue;
          try {
            const known =
              remoteVariants?.find((variant) => variant.kind === kind)?.url ??
              (variantKind === kind ? src : null);
            const sourceUrl = known ?? (await freshRemoteVariantUrl(mediaId, kind));
            const key = internalImageKey(sourceUrl);
            attemptedRemoteKeys.add(key);
            const blob = await loadMediaBlob({
              cacheName: "photostream-internal-images-v1",
              key,
              expectedBytes: null,
              sourceUrl,
              refreshUrl: () => freshRemoteVariantUrl(mediaId, kind),
            });
            if (disposed) return;
            objectUrl = URL.createObjectURL(blob);
            setResolved({ strategy, candidateId, url: objectUrl });
            return;
          } catch {
            // Continue through the requested fallback order.
          }
        }
      }

      if (src !== null) {
        const candidateId = "direct";
        if (!failed.has(candidateId)) {
          if (/^https?:\/\//u.test(src)) {
            const key = internalImageKey(src);
            if (!attemptedRemoteKeys.has(key)) {
              try {
                const blob = await loadMediaBlob({
                  cacheName: "photostream-internal-images-v1",
                  key,
                  expectedBytes: null,
                  sourceUrl: src,
                  ...(mediaId && exactKind
                    ? { refreshUrl: () => freshRemoteVariantUrl(mediaId, exactKind) }
                    : {}),
                });
                if (disposed) return;
                objectUrl = URL.createObjectURL(blob);
                setResolved({ strategy, candidateId, url: objectUrl });
                return;
              } catch {
                // Fall through to the user-facing failure below.
              }
            }
          } else {
            setResolved({ strategy, candidateId, url: src });
            return;
          }
        }
      }

      if (!disposed) errorRef.current?.();
    };

    void resolveImage();
    return () => {
      disposed = true;
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
  }, [
    eager,
    exactKind,
    localPhoto,
    localPhotoId,
    localVariantOrder,
    mediaId,
    remoteVariantOrder,
    remoteVariants,
    retryRevision,
    src,
    strategy,
    variantKind,
    visible,
  ]);

  const display = resolved?.strategy === strategy ? resolved.url : null;

  return (
    <span className="absolute inset-0" ref={host}>
      {display === null ? null : (
        <Image
          {...props}
          src={display}
          unoptimized
          onError={() => {
            const candidateId = resolved?.candidateId;
            if (candidateId === undefined) {
              errorRef.current?.();
              return;
            }
            failedCandidatesRef.current.add(candidateId);
            setResolved(null);
            setRetryRevision((current) => current + 1);
          }}
        />
      )}
    </span>
  );
}
