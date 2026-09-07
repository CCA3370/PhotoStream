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

export const faceOperationDiagnosticSchema = z
  .object({
    id: z.string().uuid(),
    source: z.enum(["aliyun_imm", "aliyun_oss", "internal"]),
    operation: z.string().min(1).max(120),
    providerCode: z.string().max(200).nullable(),
    providerMessage: z.string().min(1).max(4_000),
    providerRequestId: z.string().max(256).nullable(),
    httpStatus: z.number().int().min(0).max(999).nullable(),
    region: z.string().max(64).nullable(),
    endpoint: z.string().max(255).nullable(),
    projectName: z.string().max(128).nullable(),
    datasetName: z.string().max(128).nullable(),
    context: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
    occurredAt: z.string().datetime(),
  })
  .strict();
export type FaceOperationDiagnostic = z.infer<typeof faceOperationDiagnosticSchema>;

/**
 * The per-album switch is the only product-level enablement control. Provider
 * credentials, index progress and failures are runtime state, not prerequisites
 * that an administrator has to acknowledge before turning the feature on.
 */
export const faceConfigUpdateSchema = z.object({ enabled: z.boolean() }).strict();
export type FaceConfigUpdate = z.infer<typeof faceConfigUpdateSchema>;

export const faceConfigViewSchema = z
  .object({
    albumId: z.string().uuid(),
    enabled: z.boolean(),
    indexState: faceIndexStateSchema,
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
    lastErrorCode: z.string().max(100).nullable(),
    recentErrors: z.array(faceOperationDiagnosticSchema).max(5),
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
