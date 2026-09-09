const derivedImageCacheName = "photostream-derived-images-v1";
const maxWarmImages = 18;

export type DerivedPhotoVariantKind = "photo_480" | "photo_960" | "photo_1920";

interface DerivedImageRequest {
  readonly scope: string;
  readonly mediaId: string;
  readonly kind: DerivedPhotoVariantKind;
  readonly bytes: number;
  readonly sourceUrl: string;
}

interface WarmImage {
  readonly blob: Blob;
  readonly objectUrl: string | null;
  decoded: boolean;
}

const inFlight = new Map<string, Promise<Blob>>();
const warmImages = new Map<string, WarmImage>();

function supportsCacheStorage(): boolean {
  return typeof window !== "undefined" && "caches" in window;
}

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

function cacheKey(request: Omit<DerivedImageRequest, "sourceUrl">): Request {
  return new Request(cacheUrl(request), {
    method: "GET",
    credentials: "same-origin",
  });
}

function touchWarmImage(identity: string, image: WarmImage): WarmImage {
  warmImages.delete(identity);
  warmImages.set(identity, image);
  return image;
}

function trimWarmImages(): void {
  while (warmImages.size > maxWarmImages) {
    const oldest = warmImages.entries().next().value as [string, WarmImage] | undefined;
    if (oldest === undefined) return;
    warmImages.delete(oldest[0]);
    if (oldest[1].objectUrl !== null) URL.revokeObjectURL(oldest[1].objectUrl);
  }
}

function beginDecode(image: WarmImage): void {
  if (image.objectUrl === null || image.decoded || typeof window === "undefined") return;
  const decoder = new window.Image();
  decoder.decoding = "async";
  decoder.src = image.objectUrl;
  if (typeof decoder.decode !== "function") {
    decoder.onload = () => {
      image.decoded = true;
    };
    return;
  }
  void decoder
    .decode()
    .then(() => {
      image.decoded = true;
    })
    .catch(() => undefined);
}

function rememberWarmImage(
  request: Omit<DerivedImageRequest, "sourceUrl">,
  blob: Blob,
): WarmImage {
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
  trimWarmImages();
  beginDecode(image);
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

async function readCached(request: Omit<DerivedImageRequest, "sourceUrl">): Promise<Blob | null> {
  if (!supportsCacheStorage()) return null;
  try {
    const cache = await caches.open(derivedImageCacheName);
    const key = cacheKey(request);
    const response = await cache.match(key);
    if (response === undefined) return null;
    const blob = await response.blob();
    if (blob.size !== request.bytes) {
      await cache.delete(key);
      return null;
    }
    return blob;
  } catch {
    return null;
  }
}

async function writeCached(
  request: Omit<DerivedImageRequest, "sourceUrl">,
  blob: Blob,
): Promise<void> {
  if (!supportsCacheStorage()) return;
  try {
    const cache = await caches.open(derivedImageCacheName);
    const headers = new Headers();
    if (blob.type !== "") headers.set("Content-Type", blob.type);
    headers.set("Content-Length", String(blob.size));
    await cache.put(cacheKey(request), new Response(blob, { headers }));
  } catch {
    // Cache Storage is best-effort; the caller can still display the fetched image.
  }
}

export async function loadDerivedImage(request: DerivedImageRequest): Promise<Blob> {
  const identity = imageIdentity(request);
  const warm = warmImages.get(identity);
  if (warm !== undefined) return touchWarmImage(identity, warm).blob;

  const existing = inFlight.get(identity);
  if (existing !== undefined) return existing;

  const task = (async () => {
    const cached = await readCached(request);
    if (cached !== null) {
      rememberWarmImage(request, cached);
      return cached;
    }

    const response = await fetch(request.sourceUrl, {
      cache: "no-store",
      credentials: "omit",
      mode: "cors",
    });
    if (!response.ok) throw new Error(`图片加载失败（${response.status}）`);
    const blob = await response.blob();
    if (blob.size === 0) throw new Error("图片内容为空");
    rememberWarmImage(request, blob);
    if (blob.size !== request.bytes) return blob;
    await writeCached(request, blob);
    return blob;
  })();

  inFlight.set(identity, task);
  try {
    return await task;
  } finally {
    if (inFlight.get(identity) === task) inFlight.delete(identity);
  }
}
