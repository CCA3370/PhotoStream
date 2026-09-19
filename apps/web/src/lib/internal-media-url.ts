// Internal signed media URLs rotate authorization tokens without changing image identity.
// Keep visual identity separate from transport authorization so admin UI state changes do not
// remount already-decoded images.
export function internalImageKey(src: string): string {
  const url = new URL(src);
  url.searchParams.delete("auth_key");
  url.hash = "";
  return url.toString();
}

export function internalImageSourceIdentity(src: string | null): string | null {
  if (src === null) return null;
  return /^https?:\/\//u.test(src) ? internalImageKey(src) : src;
}
