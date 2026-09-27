import { loadMediaBlob, readMediaBlob, writeMediaBlob } from "./media-blob-cache";

const originalImageCacheName = "photostream-original-images-v1";

function cacheKey(
  slug: string,
  mediaId: string,
  bytes: number | null,
  contentRevision = 0,
): Request {
  const url = new URL(
    `/__photostream/cache/original/${encodeURIComponent(slug)}/${encodeURIComponent(mediaId)}`,
    window.location.origin,
  );
  if (bytes !== null) url.searchParams.set("bytes", String(bytes));
  url.searchParams.set("revision", String(contentRevision));
  return new Request(url.toString(), { method: "GET" });
}

function identity(
  slug: string,
  mediaId: string,
  expectedBytes: number | null,
  contentRevision = 0,
) {
  return {
    cacheName: originalImageCacheName,
    key: cacheKey(slug, mediaId, expectedBytes, contentRevision).url,
    expectedBytes,
    telemetryScope: slug,
  };
}

export async function readCachedOriginalImage(
  slug: string,
  mediaId: string,
  expectedBytes: number | null,
  contentRevision = 0,
): Promise<Blob | null> {
  if (typeof window === "undefined") return null;
  return readMediaBlob(identity(slug, mediaId, expectedBytes, contentRevision));
}

export async function writeCachedOriginalImage(
  slug: string,
  mediaId: string,
  expectedBytes: number | null,
  blob: Blob,
  contentRevision = 0,
): Promise<void> {
  return writeMediaBlob(identity(slug, mediaId, expectedBytes, contentRevision), blob);
}

export async function loadOriginalImage(request: {
  readonly slug: string;
  readonly mediaId: string;
  readonly expectedBytes: number | null;
  readonly contentRevision?: number;
  readonly sourceUrl: string;
}): Promise<Blob> {
  return loadMediaBlob({
    ...identity(request.slug, request.mediaId, request.expectedBytes, request.contentRevision ?? 0),
    sourceUrl: request.sourceUrl,
  });
}
