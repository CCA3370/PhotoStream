import { loadMediaBlob, readMediaBlob, writeMediaBlob } from "./media-blob-cache";

const originalImageCacheName = "photostream-original-images-v1";

function cacheKey(slug: string, mediaId: string, bytes: number | null): Request {
  const url = new URL(
    `/__photostream/cache/original/${encodeURIComponent(slug)}/${encodeURIComponent(mediaId)}`,
    window.location.origin,
  );
  if (bytes !== null) url.searchParams.set("bytes", String(bytes));
  return new Request(url.toString(), { method: "GET" });
}

function identity(slug: string, mediaId: string, expectedBytes: number | null) {
  return {
    cacheName: originalImageCacheName,
    key: cacheKey(slug, mediaId, expectedBytes).url,
    expectedBytes,
  };
}

export async function readCachedOriginalImage(
  slug: string,
  mediaId: string,
  expectedBytes: number | null,
): Promise<Blob | null> {
  if (typeof window === "undefined") return null;
  return readMediaBlob(identity(slug, mediaId, expectedBytes));
}

export async function writeCachedOriginalImage(
  slug: string,
  mediaId: string,
  expectedBytes: number | null,
  blob: Blob,
): Promise<void> {
  return writeMediaBlob(identity(slug, mediaId, expectedBytes), blob);
}

export async function loadOriginalImage(request: {
  readonly slug: string;
  readonly mediaId: string;
  readonly expectedBytes: number | null;
  readonly sourceUrl: string;
}): Promise<Blob> {
  return loadMediaBlob({
    ...identity(request.slug, request.mediaId, request.expectedBytes),
    sourceUrl: request.sourceUrl,
  });
}
