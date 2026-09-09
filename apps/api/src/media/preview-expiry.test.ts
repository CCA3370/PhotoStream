import { describe, expect, it } from "vitest";
import { previewExpiresAt } from "./preview-expiry.js";

describe("preview URL expiry", () => {
  it("reuses minute windows without extending authorization", () => {
    const ttl = 15 * 60_000;
    const start = Date.parse("2026-09-09T12:00:00Z");
    expect(previewExpiresAt(ttl, start + 1).getTime()).toBe(
      previewExpiresAt(ttl, start + 59_999).getTime(),
    );
    expect(previewExpiresAt(ttl, start + 60_000).getTime()).toBe(start + ttl + 60_000);
    expect(previewExpiresAt(ttl, start + 59_999).getTime() - (start + 59_999)).toBeLessThanOrEqual(
      ttl,
    );
  });
});
