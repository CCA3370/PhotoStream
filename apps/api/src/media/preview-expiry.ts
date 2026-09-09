/** Reuse a URL within a minute without extending its existing authorization lifetime. */
export function previewExpiresAt(ttlMilliseconds: number, now = Date.now()): Date {
  return new Date(Math.floor(now / 60_000) * 60_000 + ttlMilliseconds);
}
