import { describe, expect, it } from "vitest";

import {
  createFaceSearchRequestSchema,
  faceConfigUpdateSchema,
  faceIndexExclusionsRequestSchema,
} from "./face.js";

const readiness = {
  participantConsentRecordsConfirmed: true,
  guardianConsentRequirementsConfirmed: true,
  impactAssessmentCompleted: true,
  providerResourcesValidated: true,
  evaluationGatePassed: true,
  billingAlertsConfigured: true,
  indexedFacesAuthorized: true,
} as const;

describe("face search contracts", () => {
  it("requires every enablement confirmation and rejects undeclared fields", () => {
    expect(
      faceConfigUpdateSchema.safeParse({
        enabled: true,
        noticeVersion: "face-notice-2026-08-31",
        retentionDays: 30,
        readiness,
      }).success,
    ).toBe(true);
    expect(
      faceConfigUpdateSchema.safeParse({
        enabled: true,
        noticeVersion: "face-notice-2026-08-31",
        retentionDays: 31,
        readiness: { ...readiness, studentName: "禁止保存" },
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
