export const gridThumbnailUpgradeDelayMs = 150;
export const gridThumbnailRootMargin = "80px 0px";
export const microThumbnailLongEdgePx = 240;

const microThumbnailProcess = `image/resize,l_${microThumbnailLongEdgePx}/quality,Q_58/format,webp`;

/**
 * Derive a tiny grid preview from the already-authorized CDN URL.
 *
 * Aliyun CDN auth in PhotoStream signs the object path. The IMG transform is
 * therefore appended as a separate query parameter while preserving auth_key.
 * Non-CDN/local URLs intentionally return null so development signatures are
 * never mutated and old/local environments fall back to the skeleton + 480.
 */
export function microThumbnailUrl(sourceUrl: string): string | null {
  try {
    const url = new URL(sourceUrl);
    if (!url.searchParams.has("auth_key")) return null;
    url.searchParams.set("x-oss-process", microThumbnailProcess);
    return url.toString();
  } catch {
    return null;
  }
}
