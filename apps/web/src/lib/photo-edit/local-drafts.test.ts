import { describe, expect, it } from "vitest";

import { photoEditSourceFingerprint } from "./local-drafts";

describe("local photo edit drafts", () => {
  it("uses source identity fields that remain stable across edit retries", () => {
    expect(
      photoEditSourceFingerprint({
        bytes: 12_345_678,
        width: 6_000,
        height: 4_000,
        contentType: "image/jpeg",
      }),
    ).toBe("12345678:6000x4000:image/jpeg");
  });

  it("changes when the underlying local source changes", () => {
    const first = photoEditSourceFingerprint({
      bytes: 1_000,
      width: 1_920,
      height: 1_080,
      contentType: "image/jpeg",
    });
    const second = photoEditSourceFingerprint({
      bytes: 1_001,
      width: 1_920,
      height: 1_080,
      contentType: "image/jpeg",
    });
    expect(second).not.toBe(first);
  });
});
