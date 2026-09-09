import { describe, expect, it } from "vitest";

import {
  derivedCacheSegment,
  derivedSegmentBudget,
  mediaCacheBudget,
} from "./media-cache-policy";

const mib = 1024 * 1024;

describe("media cache policy", () => {
  it("allows a larger derived cache while respecting browser quota", () => {
    expect(mediaCacheBudget("photostream-derived-images-v1")).toBe(192 * mib);
    expect(mediaCacheBudget("photostream-derived-images-v1", 1024 * mib)).toBe(
      Math.floor(1024 * mib * 0.08),
    );
    expect(mediaCacheBudget("photostream-derived-images-v1", 8 * 1024 * mib)).toBe(192 * mib);
  });

  it("keeps original and internal caches on smaller quota shares", () => {
    expect(mediaCacheBudget("photostream-original-images-v1")).toBe(128 * mib);
    expect(mediaCacheBudget("photostream-internal-images-v1")).toBe(64 * mib);
    expect(mediaCacheBudget("photostream-original-images-v1", 1024 * mib)).toBe(
      Math.floor(1024 * mib * 0.05),
    );
  });

  it("classifies immutable derived cache keys without depending on query parameters", () => {
    expect(
      derivedCacheSegment("https://app.test/__photostream/cache/derived/a/b/photo_480?bytes=100"),
    ).toBe("photo_480");
    expect(
      derivedCacheSegment("https://app.test/__photostream/cache/derived/a/b/photo_960?bytes=200"),
    ).toBe("photo_960");
    expect(
      derivedCacheSegment("https://app.test/__photostream/cache/derived/a/b/photo_1920?bytes=300"),
    ).toBe("photo_1920");
    expect(derivedCacheSegment("https://app.test/__photostream/cache/original/a/b")).toBeNull();
  });

  it("prevents large 1920 images from consuming the entire derived cache", () => {
    const total = 192 * mib;
    expect(derivedSegmentBudget(total, "photo_480")).toBe(Math.floor(total * 0.3));
    expect(derivedSegmentBudget(total, "photo_960")).toBe(Math.floor(total * 0.55));
    expect(derivedSegmentBudget(total, "photo_1920")).toBe(Math.floor(total * 0.7));
  });
});
