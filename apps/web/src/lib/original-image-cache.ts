const originalImageCacheName = "photostream-original-images-v1";

function cacheKey(slug: string, mediaId: string, bytes: number | null): Request {
  const url = new URL(
    `/__photostream/cache/original/${encodeURIComponent(slug)}/${encodeURIComponent(mediaId)}`,
    window.location.origin,
  );
  if (bytes !== null) url.searchParams.set("bytes", String(bytes));
  return new Request(url, { method: "GET" });
}

function supportsCacheStorage(): boolean {
  return typeof window !== "undefined" && "caches" in window;
}

export async function readCachedOriginalImage(
  slug: string,
  mediaId: string,
  expectedBytes: number | null,
): Promise<Blob | null> {
  if (!supportsCacheStorage()) return null;
  try {
    const cache = await caches.open(originalImageCacheName);
    const key = cacheKey(slug, mediaId, expectedBytes);
    const response = await cache.match(key);
    if (response === undefined) return null;
    const blob = await response.blob();
    if (expectedBytes !== null && blob.size !== expectedBytes) {
      await cache.delete(key);
      return null;
    }
    return blob;
  } catch {
    return null;
  }
}

export async function writeCachedOriginalImage(
  slug: string,
  mediaId: string,
  expectedBytes: number | null,
  blob: Blob,
): Promise<void> {
  if (!supportsCacheStorage()) return;
  try {
    const cache = await caches.open(originalImageCacheName);
    const headers = new Headers();
    if (blob.type !== "") headers.set("Content-Type", blob.type);
    await cache.put(cacheKey(slug, mediaId, expectedBytes), new Response(blob, { headers }));
  } catch {
    // Persistent caching is an enhancement; viewing the fetched original should still work.
  }
}
