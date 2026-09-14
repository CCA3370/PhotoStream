import { describe, expect, it } from "vitest";

import {
  microPreviewDimensions,
  microPreviewLongEdgePx,
  microPreviewUploadRequestSchema,
} from "./micro-preview.js";

describe("micro preview contract", () => {
  it("uses a 240px long edge", () => {
    expect(microPreviewLongEdgePx).toBe(240);
    expect(microPreviewDimensions(4_000, 3_000)).toEqual({ width: 240, height: 180 });
    expect(microPreviewDimensions(3_000, 4_000)).toEqual({ width: 180, height: 240 });
  });

  it("accepts canonical image metadata and rejects mismatched content types", () => {
    expect(
      microPreviewUploadRequestSchema.safeParse({
        format: "webp",
        contentType: "image/webp",
        width: 240,
        height: 180,
        bytes: 12_000,
      }).success,
    ).toBe(true);
    expect(
      microPreviewUploadRequestSchema.safeParse({
        format: "webp",
        contentType: "image/jpeg",
        width: 240,
        height: 180,
        bytes: 12_000,
      }).success,
    ).toBe(false);
  });
});
