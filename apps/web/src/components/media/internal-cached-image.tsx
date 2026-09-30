"use client";

import Image, { type ImageProps } from "next/image";
import { memo, useEffect, useMemo, useRef, useState } from "react";

import { clientGet } from "@/lib/client-api";
import { notifyCurrentInternalImageLoad } from "@/lib/internal-image-load";
import { internalImageKey, internalImageSourceIdentity } from "@/lib/internal-media-url";
import {
  findLocalReviewPhotoByMediaId,
  getLocalReviewPhoto,
  type LocalReviewPhoto,
} from "@/lib/local-review-queue";
import { loadMediaBlob } from "@/lib/media-blob-cache";

export type InternalPreviewVariantKind = "photo_240" | "photo_480" | "photo_960" | "photo_1920";

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

type VisibilityCallback = () => void;

const visibilityCallbacks = new Map<Element, VisibilityCallback>();
let visibilityObserver: IntersectionObserver | null = null;

function observeNearViewport(element: Element, callback: VisibilityCallback): () => void {
  if (typeof IntersectionObserver === "undefined") {
    callback();
    return () => undefined;
  }
  if (visibilityObserver === null) {
    visibilityObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const pending = visibilityCallbacks.get(entry.target);
          if (pending === undefined) continue;
          visibilityCallbacks.delete(entry.target);
          visibilityObserver?.unobserve(entry.target);
          pending();
        }
      },
      { rootMargin: "200px 0px" },
    );
  }
  visibilityCallbacks.set(element, callback);
  visibilityObserver.observe(element);
  return () => {
    if (visibilityCallbacks.get(element) !== callback) return;
    visibilityCallbacks.delete(element);
    visibilityObserver?.unobserve(element);
  };
}

function previewKind(value: string | undefined): InternalPreviewVariantKind | null {
  return value !== undefined && previewKinds.has(value as InternalPreviewVariantKind)
    ? (value as InternalPreviewVariantKind)
    : null;
}

function localVariantBlob(photo: LocalReviewPhoto, kind: InternalPreviewVariantKind): Blob | null {
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

function InternalCachedImageComponent({
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
  const strategyRef = useRef<string | null>(null);
  const retryRevisionRef = useRef(0);
  const [visible, setVisible] = useState(false);
  const [retryRevision, setRetryRevision] = useState(0);
  type ResolvedImage = {
    readonly strategy: string;
    readonly candidateId: string;
    readonly url: string;
    readonly ownedObjectUrl: boolean;
  };
  const [resolved, setResolved] = useState<ResolvedImage | null>(null);
  const resolvedRef = useRef<ResolvedImage | null>(null);
  const retiredObjectUrlsRef = useRef(new Set<string>());
  const requestRef = useRef({
    src,
    mediaId,
    localPhotoId,
    localPhoto,
    variantKind,
    remoteVariants,
    localVariantOrder,
    remoteVariantOrder,
  });
  requestRef.current = {
    src,
    mediaId,
    localPhotoId,
    localPhoto,
    variantKind,
    remoteVariants,
    localVariantOrder,
    remoteVariantOrder,
  };
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const eager = props.loading === "eager" || props.priority || props.preload;

  const exactKind = previewKind(variantKind);
  const localOrder = localVariantOrder ?? (exactKind === null ? [] : ([exactKind] as const));
  const localVariantSignature =
    localPhoto === null || localPhoto === undefined
      ? null
      : localOrder
          .map((kind) => {
            const blob = localVariantBlob(localPhoto, kind);
            return blob === null ? `${kind}:missing` : `${kind}:${blob.size}:${blob.type}`;
          })
          .join("|");
  const strategy = useMemo(
    () =>
      JSON.stringify({
        src: internalImageSourceIdentity(src),
        mediaId: mediaId ?? null,
        localPhotoId: localPhotoId ?? null,
        localVariants: localVariantSignature,
        localOrder,
        remoteOrder: remoteVariantOrder ?? (exactKind === null ? [] : [exactKind]),
        remoteVariants:
          remoteVariants?.map((variant) => [variant.kind, internalImageKey(variant.url)]) ?? [],
      }),
    [
      exactKind,
      localOrder,
      localPhotoId,
      localVariantSignature,
      mediaId,
      remoteVariantOrder,
      remoteVariants,
      src,
    ],
  );

  useEffect(
    () => () => {
      const current = resolvedRef.current;
      if (current?.ownedObjectUrl) URL.revokeObjectURL(current.url);
      for (const url of retiredObjectUrlsRef.current) URL.revokeObjectURL(url);
      retiredObjectUrlsRef.current.clear();
      resolvedRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (eager || visible) return;
    const element = host.current;
    if (element === null) return;
    return observeNearViewport(element, () => setVisible(true));
  }, [eager, visible]);

  useEffect(() => {
    if (strategyRef.current !== strategy) {
      strategyRef.current = strategy;
      failedCandidatesRef.current.clear();
      retryRevisionRef.current = 0;
      setRetryRevision(0);
    } else {
      retryRevisionRef.current = retryRevision;
    }
    if (!eager && !visible) return;
    const startedRetryRevision = retryRevision;
    let disposed = false;

    const commitResolved = (next: ResolvedImage): void => {
      if (disposed) {
        if (next.ownedObjectUrl) URL.revokeObjectURL(next.url);
        return;
      }
      const previous = resolvedRef.current;
      resolvedRef.current = next;
      setResolved(next);
      if (previous?.ownedObjectUrl && previous.url !== next.url) {
        retiredObjectUrlsRef.current.add(previous.url);
      }
    };

    const resolveImage = async (): Promise<void> => {
      const request = requestRef.current;
      const failed = failedCandidatesRef.current;
      const requestExactKind = previewKind(request.variantKind);
      const requestLocalOrder =
        request.localVariantOrder ??
        (requestExactKind === null ? [] : ([requestExactKind] as const));
      const requestRemoteOrder =
        request.remoteVariantOrder ??
        (requestExactKind === null ? [] : ([requestExactKind] as const));

      let local = request.localPhoto ?? null;
      if (local === null && request.localPhotoId) {
        try {
          local = await getLocalReviewPhoto(request.localPhotoId);
        } catch {
          local = null;
        }
      }
      if (local === null && request.mediaId) {
        try {
          local = await findLocalReviewPhotoByMediaId(request.mediaId);
        } catch {
          local = null;
        }
      }
      if (disposed || retryRevisionRef.current !== startedRetryRevision) return;

      if (local !== null) {
        for (const kind of requestLocalOrder) {
          const candidateId = `local:${kind}`;
          if (failed.has(candidateId)) continue;
          const blob = localVariantBlob(local, kind);
          if (blob === null || blob.size === 0) continue;
          const objectUrl = URL.createObjectURL(blob);
          commitResolved({
            strategy,
            candidateId,
            url: objectUrl,
            ownedObjectUrl: true,
          });
          return;
        }
      }

      const attemptedRemoteKeys = new Set<string>();
      if (request.mediaId) {
        for (const kind of requestRemoteOrder) {
          const candidateId = `remote:${kind}`;
          if (failed.has(candidateId)) continue;
          try {
            const known =
              request.remoteVariants?.find((variant) => variant.kind === kind)?.url ??
              (request.variantKind === kind ? request.src : null);
            const sourceUrl = known ?? (await freshRemoteVariantUrl(request.mediaId, kind));
            const key = internalImageKey(sourceUrl);
            attemptedRemoteKeys.add(key);
            const blob = await loadMediaBlob({
              cacheName: "photostream-internal-images-v1",
              key,
              expectedBytes: null,
              sourceUrl,
              refreshUrl: () => freshRemoteVariantUrl(request.mediaId as string, kind),
            });
            if (disposed) return;
            const objectUrl = URL.createObjectURL(blob);
            commitResolved({
              strategy,
              candidateId,
              url: objectUrl,
              ownedObjectUrl: true,
            });
            return;
          } catch {
            // Continue through the requested fallback order.
          }
        }
      }

      if (request.src !== null) {
        const candidateId = "direct";
        if (!failed.has(candidateId)) {
          if (/^https?:\/\//u.test(request.src)) {
            const key = internalImageKey(request.src);
            if (!attemptedRemoteKeys.has(key)) {
              try {
                const blob = await loadMediaBlob({
                  cacheName: "photostream-internal-images-v1",
                  key,
                  expectedBytes: null,
                  sourceUrl: request.src,
                  ...(request.mediaId && requestExactKind
                    ? {
                        refreshUrl: () =>
                          freshRemoteVariantUrl(request.mediaId as string, requestExactKind),
                      }
                    : {}),
                });
                if (disposed) return;
                const objectUrl = URL.createObjectURL(blob);
                commitResolved({
                  strategy,
                  candidateId,
                  url: objectUrl,
                  ownedObjectUrl: true,
                });
                return;
              } catch {
                // Fall through to the user-facing failure below.
              }
            }
          } else {
            commitResolved({
              strategy,
              candidateId,
              url: request.src,
              ownedObjectUrl: false,
            });
            return;
          }
        }
      }

      if (!disposed && retryRevisionRef.current === startedRetryRevision) errorRef.current?.();
    };

    void resolveImage();
    return () => {
      disposed = true;
    };
  }, [eager, retryRevision, strategy, visible]);

  const display = resolved?.url ?? null;

  return (
    <span className="absolute inset-0" ref={host}>
      {display === null ? null : (
        <Image
          {...props}
          src={display}
          unoptimized
          onLoad={(event) => {
            notifyCurrentInternalImageLoad(
              {
                resolvedStrategy: resolved?.strategy,
                currentStrategy: strategy,
                displayedSource: event.currentTarget.currentSrc,
                requestedSource: event.currentTarget.src,
              },
              () => {
                for (const url of retiredObjectUrlsRef.current) URL.revokeObjectURL(url);
                retiredObjectUrlsRef.current.clear();
                props.onLoad?.(event);
              },
            );
          }}
          onError={() => {
            const candidateId = resolved?.strategy === strategy ? resolved.candidateId : undefined;
            if (candidateId === undefined) {
              errorRef.current?.();
              return;
            }
            failedCandidatesRef.current.add(candidateId);
            setRetryRevision((current) => current + 1);
          }}
        />
      )}
    </span>
  );
}

export const InternalCachedImage = memo(InternalCachedImageComponent);
