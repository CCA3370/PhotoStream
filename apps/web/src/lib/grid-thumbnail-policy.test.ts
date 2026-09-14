import { describe, expect, it } from "vitest";

import {
  gridThumbnailRootMargin,
  gridThumbnailUpgradeDelayMs,
  microThumbnailLongEdgePx,
  microThumbnailUrl,
} from "./grid-thumbnail-policy";

describe("grid thumbnail policy", () => {
  it("builds a 240px OSS IMG URL while preserving CDN authorization", () => {
    const result = microThumbnailUrl(
      "https://media.example.test/path/480.webp?auth_key=123-abc&other=value",
    );
    expect(result).not.toBeNull();
    const url = new URL(result as string);
    expect(url.searchParams.get("auth_key")).toBe("123-abc");
    expect(url.searchParams.get("other")).toBe("value");
    expect(url.searchParams.get("x-oss-process")).toBe(
      "image/resize,l_240/quality,Q_58/format,webp",
    );
  });

  it("does not mutate unsigned local or malformed URLs", () => {
    expect(microThumbnailUrl("http://127.0.0.1:3002/object.webp?token=local")).toBeNull();
    expect(microThumbnailUrl("not a url")).toBeNull();
  });

  it("keeps the grid upgrade deliberately conservative", () => {
    expect(microThumbnailLongEdgePx).toBe(240);
    expect(gridThumbnailUpgradeDelayMs).toBe(150);
    expect(gridThumbnailRootMargin).toBe("80px 0px");
  });
});
