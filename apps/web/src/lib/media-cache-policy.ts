export type DerivedCacheSegment = "photo_480" | "photo_960" | "photo_1920";

const mib = 1024 * 1024;
const fallbackCaps = {
  derived: 192 * mib,
  original: 128 * mib,
  default: 64 * mib,
} as const;

export function mediaCacheBudget(cacheName: string, quota?: number): number {
  const derived = cacheName.includes("derived");
  const original = cacheName.includes("original");
  const cap = derived
    ? fallbackCaps.derived
    : original
      ? fallbackCaps.original
      : fallbackCaps.default;
  const quotaShare = derived ? 0.08 : 0.05;
  if (quota === undefined || !Number.isFinite(quota) || quota <= 0) return cap;
  return Math.min(cap, Math.floor(quota * quotaShare));
}

export function derivedCacheSegment(key: string): DerivedCacheSegment | null {
  try {
    const pathname = new URL(key).pathname;
    if (pathname.endsWith("/photo_480")) return "photo_480";
    if (pathname.endsWith("/photo_960")) return "photo_960";
    if (pathname.endsWith("/photo_1920")) return "photo_1920";
  } catch {
    return null;
  }
  return null;
}

export function derivedSegmentBudget(totalBudget: number, segment: DerivedCacheSegment): number {
  const share = segment === "photo_480" ? 0.3 : segment === "photo_960" ? 0.55 : 0.7;
  return Math.floor(totalBudget * share);
}
