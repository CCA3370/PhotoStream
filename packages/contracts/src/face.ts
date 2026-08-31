import { z } from "zod";

export const faceIndexStateSchema = z.enum([
  "disabled",
  "provisioning",
  "indexing",
  "ready",
  "degraded",
  "deleting",
  "failed",
]);
export type FaceIndexState = z.infer<typeof faceIndexStateSchema>;

export const faceMediaIndexStatusSchema = z.enum([
  "pending",
  "indexing",
  "indexed",
  "deleting",
  "excluded",
  "failed",
]);
export type FaceMediaIndexStatus = z.infer<typeof faceMediaIndexStatusSchema>;

export const faceSearchStatusSchema = z.enum([
  "awaiting_upload",
  "processing",
  "partial",
  "completed",
  "failed",
  "cancelled",
  "expired",
]);
export type FaceSearchStatus = z.infer<typeof faceSearchStatusSchema>;

export const faceConsentDeclarationSchema = z.enum(["self", "guardian_or_authorized"]);
export type FaceConsentDeclaration = z.infer<typeof faceConsentDeclarationSchema>;

export const faceFailureCodeSchema = z.enum([
  "reference_format_invalid",
  "no_face",
  "multiple_faces",
  "quality_low",
  "provider_unavailable",
  "async_search_failed",
  "cleanup_failed",
  "expired",
]);
export type FaceFailureCode = z.infer<typeof faceFailureCodeSchema>;

export const faceReadinessConfirmationSchema = z
  .object({
    participantConsentRecordsConfirmed: z.boolean(),
    guardianConsentRequirementsConfirmed: z.boolean(),
    impactAssessmentCompleted: z.boolean(),
    providerResourcesValidated: z.boolean(),
    evaluationGatePassed: z.boolean(),
    billingAlertsConfigured: z.boolean(),
    indexedFacesAuthorized: z.boolean(),
  })
  .strict();
export type FaceReadinessConfirmation = z.infer<typeof faceReadinessConfirmationSchema>;

export const faceReadinessViewSchema = faceReadinessConfirmationSchema
  .extend({
    globalFeatureEnabled: z.boolean(),
    passwordAccess: z.boolean(),
    privacyNoticeConfigured: z.boolean(),
    complaintContactConfigured: z.boolean(),
    noticeVersionCurrent: z.boolean(),
    thresholdVersionQualified: z.boolean(),
  })
  .strict();
export type FaceReadinessView = z.infer<typeof faceReadinessViewSchema>;

export const faceConfigUpdateSchema = z
  .object({
    enabled: z.boolean(),
    noticeVersion: z.string().trim().min(1).max(80),
    retentionDays: z.number().int().min(1).max(30),
    readiness: faceReadinessConfirmationSchema,
  })
  .strict();
export type FaceConfigUpdate = z.infer<typeof faceConfigUpdateSchema>;

export const faceConfigViewSchema = z
  .object({
    albumId: z.string().uuid(),
    enabled: z.boolean(),
    readyToEnable: z.boolean(),
    noticeVersion: z.string().max(80).nullable(),
    thresholdVersion: z.string().min(1).max(80),
    indexState: faceIndexStateSchema,
    authorizationConfirmedAt: z.string().datetime().nullable(),
    retentionDays: z.number().int().min(1).max(30),
    readiness: faceReadinessViewSchema,
    counts: z
      .object({
        pending: z.number().int().min(0),
        indexed: z.number().int().min(0),
        failed: z.number().int().min(0),
        excluded: z.number().int().min(0),
      })
      .strict(),
    lastIndexedAt: z.string().datetime().nullable(),
    lastClusteredAt: z.string().datetime().nullable(),
    deletionDueAt: z.string().datetime().nullable(),
    lastErrorCode: z.string().max(100).nullable(),
  })
  .strict();
export type FaceConfigView = z.infer<typeof faceConfigViewSchema>;

export const faceIndexExclusionsRequestSchema = z
  .object({
    mediaIds: z.array(z.string().uuid()).min(1).max(200),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.mediaIds).size !== value.mediaIds.length) {
      context.addIssue({ code: "custom", message: "媒体 ID 不能重复", path: ["mediaIds"] });
    }
  });
export type FaceIndexExclusionsRequest = z.infer<typeof faceIndexExclusionsRequestSchema>;

export const createFaceSearchRequestSchema = z
  .object({
    declaration: faceConsentDeclarationSchema,
    noticeVersion: z.string().trim().min(1).max(80),
    reference: z
      .object({
        contentType: z.literal("image/jpeg"),
        bytes: z
          .number()
          .int()
          .min(1)
          .max(3 * 1024 * 1024),
      })
      .strict(),
  })
  .strict();
export type CreateFaceSearchRequest = z.infer<typeof createFaceSearchRequestSchema>;

export const faceReferenceUploadSchema = z
  .object({
    url: z.string().url(),
    headers: z.record(z.string(), z.string()),
    expiresAt: z.string().datetime(),
  })
  .strict();

export const createFaceSearchResponseSchema = z
  .object({
    id: z.string().uuid(),
    status: z.literal("awaiting_upload"),
    upload: faceReferenceUploadSchema,
    referenceExpiresAt: z.string().datetime(),
    resultExpiresAt: z.string().datetime(),
  })
  .strict();
export type CreateFaceSearchResponse = z.infer<typeof createFaceSearchResponseSchema>;

export const faceSearchParamsSchema = z
  .object({
    cursor: z.string().max(512).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();

export const faceSearchSafeStateSchema = z
  .object({
    id: z.string().uuid(),
    status: faceSearchStatusSchema,
    referenceExpiresAt: z.string().datetime(),
    resultExpiresAt: z.string().datetime(),
    failureCode: faceFailureCodeSchema.nullable(),
  })
  .strict();
export type FaceSearchSafeState = z.infer<typeof faceSearchSafeStateSchema>;
