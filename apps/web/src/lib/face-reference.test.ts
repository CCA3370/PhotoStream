import { describe, expect, it } from "vitest";

import { FaceReferenceProcessingError, fitFaceReferenceDimensions } from "./face-reference";

describe("face reference dimensions", () => {
  it("keeps small images and bounds either orientation to 1920 pixels", () => {
    expect(fitFaceReferenceDimensions(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitFaceReferenceDimensions(4_000, 3_000)).toEqual({ width: 1_920, height: 1_440 });
    expect(fitFaceReferenceDimensions(3_000, 4_000)).toEqual({ width: 1_440, height: 1_920 });
  });

  it("rejects invalid decoded dimensions", () => {
    expect(() => fitFaceReferenceDimensions(0, 100)).toThrow(FaceReferenceProcessingError);
    expect(() => fitFaceReferenceDimensions(Number.NaN, 100)).toThrow("无法读取照片尺寸");
  });
});
