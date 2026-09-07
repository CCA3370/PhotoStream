import { describe, expect, it } from "vitest";

import {
  createFaceSearchRequestSchema,
  faceConfigUpdateSchema,
  faceIndexExclusionsRequestSchema,
} from "./face.js";

describe("face search contracts", () => {
  it("uses a single strict switch as the album enablement contract", () => {
    expect(faceConfigUpdateSchema.safeParse({ enabled: true }).success).toBe(true);
    expect(faceConfigUpdateSchema.safeParse({ enabled: false }).success).toBe(true);
    expect(
      faceConfigUpdateSchema.safeParse({
        enabled: true,
        readiness: { evaluationGatePassed: false },
      }).success,
    ).toBe(false);
  });

  it("accepts only a bounded JPEG reference and an explicit authority declaration", () => {
    expect(
      createFaceSearchRequestSchema.safeParse({
        declaration: "self",
        noticeVersion: "face-notice-2026-08-31",
        reference: { contentType: "image/jpeg", bytes: 3 * 1024 * 1024 },
      }).success,
    ).toBe(true);
    expect(
      createFaceSearchRequestSchema.safeParse({
        declaration: "self",
        noticeVersion: "face-notice-2026-08-31",
        reference: { contentType: "image/heic", bytes: 10 },
      }).success,
    ).toBe(false);
    expect(
      createFaceSearchRequestSchema.safeParse({
        declaration: "verified_identity",
        noticeVersion: "face-notice-2026-08-31",
        reference: { contentType: "image/jpeg", bytes: 10 },
      }).success,
    ).toBe(false);
  });

  it("keeps media exclusions unique", () => {
    const id = "019d0000-0000-7000-8000-000000000101";
    expect(faceIndexExclusionsRequestSchema.safeParse({ mediaIds: [id] }).success).toBe(true);
    expect(faceIndexExclusionsRequestSchema.safeParse({ mediaIds: [id, id] }).success).toBe(false);
  });
});
