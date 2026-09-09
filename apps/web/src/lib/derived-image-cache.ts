import { loadMediaBlob, readMediaBlob } from "./media-blob-cache";

const derivedImageCacheName = "photostream-derived-images-v1";
const maxWarmImages = 18;

export type DerivedPhotoVariantKind = "photo_480" | "photo_960" | "photo_1920";

interface DerivedImageRequest {
  readonly scope: string;
  readonly mediaId: string;
  readonly kind: DerivedPhotoVariantKind;
  readonly bytes: number;
  readonly sourceUrl: string;
  readonly refreshUrl?: () => Promise<string>;
}

interface WarmImage {
  readonly blob: Blob;
  readonly objectUrl: string | null;
  decoded: boolean;
}

const listeners = new Map<() => void, string | undefined>();
const retained = new Map<string, number>();
export function subscribeDerivedImages(
  listener: () => void,
  request?: Omit<DerivedImageRequest, "sourceUrl">,
): () => void {
  listeners.set(listener, request === undefined ? undefined : imageIdentity(request));
  return () => {
    listeners.delete(listener);
  };
}
export function retainDerivedImage(request: Omit<DerivedImageRequest, "sourceUrl">): () => void {
  const key = imageIdentity(request);
  retained.set(key, (retained.get(key) ?? 0) + 1);
  return () => {
    const count = (retained.get(key) ?? 1) - 1;
    if (count === 0) retained.delete(key);
    else retained.set(key, count);
    trimWarmImages();
  };
}
const warmImages = new Map<string, WarmImage>();

function imageIdentity(request: Omit<DerivedImageRequest, "sourceUrl">): string {
  return `${request.scope}\u0000${request.mediaId}\u0000${request.kind}\u0000${request.bytes}`;
}

function cacheUrl(request: Omit<DerivedImageRequest, "sourceUrl">): string {
  const url = new URL(
    `/__photostream/cache/derived/${encodeURIComponent(request.scope)}/${encodeURIComponent(request.mediaId)}/${request.kind}`,
    window.location.origin,
  );
  url.searchParams.set("bytes", String(request.bytes));
  return url.toString();
}

function touchWarmImage(identity: string, image: WarmImage): WarmImage {
  warmImages.delete(identity);
  warmImages.set(identity, image);
  return image;
}

function trimWarmImages(protectedKey?: string): void {
  let bytes = [...warmImages.values()].reduce((sum, image) => sum + image.blob.size, 0);
  for (const [key, image] of warmImages) {
    if (warmImages.size <= maxWarmImages && bytes <= 24 * 1024 * 1024) break;
    if (key === protectedKey || retained.has(key)) continue;
    warmImages.delete(key);
    bytes -= image.blob.size;
    if (image.objectUrl !== null) URL.revokeObjectURL(image.objectUrl);
  }
}

export function markDerivedImageDecoded(request: Omit<DerivedImageRequest, "sourceUrl">): void {
  const image = warmImages.get(imageIdentity(request));
  if (image !== undefined) image.decoded = true;
}

function rememberWarmImage(request: Omit<DerivedImageRequest, "sourceUrl">, blob: Blob): WarmImage {
  const identity = imageIdentity(request);
  const existing = warmImages.get(identity);
  if (existing !== undefined) return touchWarmImage(identity, existing);

  const image: WarmImage = {
    blob,
    objectUrl:
      typeof window !== "undefined" && typeof URL.createObjectURL === "function"
        ? URL.createObjectURL(blob)
        : null,
    decoded: false,
  };
  touchWarmImage(identity, image);
  trimWarmImages(identity);
  for (const [listener, key] of listeners) if (key === undefined || key === identity) listener();
  return image;
}

export function getWarmDerivedImageUrl(
  request: Omit<DerivedImageRequest, "sourceUrl">,
): string | null {
  if (typeof window === "undefined") return null;
  const identity = imageIdentity(request);
  const image = warmImages.get(identity);
  if (image === undefined) return null;
  return touchWarmImage(identity, image).objectUrl;
}

export function isWarmDerivedImageDecoded(
  request: Omit<DerivedImageRequest, "sourceUrl">,
): boolean {
  if (typeof window === "undefined") return false;
  const identity = imageIdentity(request);
  const image = warmImages.get(identity);
  if (image === undefined) return false;
  touchWarmImage(identity, image);
  return image.decoded;
}

function blobIdentity(request: Omit<DerivedImageRequest, "sourceUrl">) {
  return {
    cacheName: derivedImageCacheName,
    key: cacheUrl(request),
    expectedBytes: request.bytes,
    ...(request.scope === "public-media" ? {} : { telemetryScope: request.scope }),
  };
}

export async function readCachedDerivedImage(
  request: Omit<DerivedImageRequest, "sourceUrl">,
): Promise<Blob | null> {
  if (typeof window === "undefined") return null;
  const warm = warmImages.get(imageIdentity(request));
  if (warm !== undefined) return touchWarmImage(imageIdentity(request), warm).blob;
  const blob = await readMediaBlob(blobIdentity(request));
  if (blob !== null) rememberWarmImage(request, blob);
  return blob;
}

export async function loadDerivedImage(request: DerivedImageRequest): Promise<Blob> {
  const warm = warmImages.get(imageIdentity(request));
  if (warm !== undefined) return touchWarmImage(imageIdentity(request), warm).blob;
  const blob = await loadMediaBlob({
    ...blobIdentity(request),
    sourceUrl: request.sourceUrl,
    ...(request.refreshUrl === undefined ? {} : { refreshUrl: request.refreshUrl }),
  });
  rememberWarmImage(request, blob);
  return blob;
}
