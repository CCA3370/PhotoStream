const derivedImageCacheName = "photostream-derived-images-v1";

export type DerivedPhotoVariantKind = "photo_480" | "photo_960" | "photo_1920";

interface DerivedImageRequest {
  readonly scope: string;
  readonly mediaId: string;
  readonly kind: DerivedPhotoVariantKind;
  readonly bytes: number;
  readonly sourceUrl: string;
}

const inFlight = new Map<string, Promise<Blob>>();

function supportsCacheStorage(): boolean {
  return typeof window !== "undefined" && "caches" in window;
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
  const identity = cacheUrl(request);
  const existing = inFlight.get(identity);
  if (existing !== undefined) return existing;

  const task = (async () => {
    const cached = await readCached(request);
    if (cached !== null) return cached;

    const response = await fetch(request.sourceUrl, {
      cache: "no-store",
      credentials: "omit",
      mode: "cors",
    });
    if (!response.ok) throw new Error(`图片加载失败（${response.status}）`);
    const blob = await response.blob();
    if (blob.size === 0) throw new Error("图片内容为空");
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
