import { z } from "zod";

export const userRoleSchema = z.enum(["admin", "reviewer", "uploader"]);
export type UserRole = z.infer<typeof userRoleSchema>;

export const permissionSchema = z.enum([
  "album:create",
  "album:read",
  "album:configure",
  "media:upload",
  "media:review",
  "media:manage",
  "bib:own",
  "bib:any",
  "user:manage",
  "audit:read",
]);
export type Permission = z.infer<typeof permissionSchema>;

const permissionMatrix = {
  admin: permissionSchema.options,
  reviewer: ["album:read", "media:review", "media:manage", "bib:any"],
  uploader: ["album:read", "media:upload", "bib:own"],
} as const satisfies Record<UserRole, readonly Permission[]>;

export function permissionsFor(role: UserRole): readonly Permission[] {
  return permissionMatrix[role];
}

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return permissionMatrix[role].includes(permission as never);
}

export const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[A-Za-z0-9._-]+$/u, "用户名只能包含字母、数字、点、下划线和连字符");

export const passwordSchema = z.string().min(12).max(128);

export const loginRequestSchema = z
  .object({
    username: usernameSchema,
    password: z.string().min(1).max(128),
  })
  .strict();
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const changePasswordRequestSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: passwordSchema,
  })
  .strict()
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: "新密码不能与当前密码相同",
    path: ["newPassword"],
  });
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export const userViewSchema = z
  .object({
    id: z.string().uuid(),
    username: usernameSchema,
    displayName: z.string().min(1).max(80),
    role: userRoleSchema,
    mustChangePassword: z.boolean(),
  })
  .strict();
export type UserView = z.infer<typeof userViewSchema>;

export const authSessionSchema = z
  .object({
    user: userViewSchema,
    csrfToken: z.string().min(32),
    permissions: z.array(permissionSchema),
  })
  .strict();
export type AuthSession = z.infer<typeof authSessionSchema>;

export const apiErrorCodeSchema = z.enum([
  "BAD_REQUEST",
  "AUTH_INVALID_CREDENTIALS",
  "AUTH_REQUIRED",
  "AUTH_ACCOUNT_DISABLED",
  "AUTH_PASSWORD_POLICY",
  "AUTH_CSRF_INVALID",
  "AUTH_ORIGIN_INVALID",
  "AUTH_RATE_LIMITED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "INTERNAL_ERROR",
  "SERVICE_UNAVAILABLE",
  "ALBUM_NOT_FOUND",
  "ALBUM_NOT_LIVE",
  "ALBUM_PASSWORD_INVALID",
  "ALBUM_PASSWORD_RATE_LIMITED",
  "UPLOAD_INVALID",
  "UPLOAD_NOT_FOUND",
  "OBJECT_VERIFICATION_FAILED",
  "STATE_CONFLICT",
  "MEDIA_LIMIT_EXCEEDED",
]);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const apiErrorSchema = z
  .object({
    code: apiErrorCodeSchema,
    message: z.string(),
    requestId: z.string(),
    retryable: z.boolean(),
  })
  .strict();
export type ApiError = z.infer<typeof apiErrorSchema>;

export const okResponseSchema = z.object({ ok: z.literal(true) }).strict();

export const healthResponseSchema = z
  .object({
    status: z.enum(["ok", "unavailable"]),
  })
  .strict();

export function normalizeUsername(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

export const albumStateSchema = z.enum(["draft", "live", "ended", "archived"]);
export const albumAccessSchema = z.enum(["password", "public"]);
export const publishModeSchema = z.enum(["review", "auto"]);
export const ingestStatusSchema = z.enum([
  "created",
  "local_processing",
  "uploading_preview",
  "preview_ready",
  "uploading_source",
  "ready",
  "failed",
  "cancelled",
]);
export const publicationStatusSchema = z.enum([
  "draft",
  "pending_review",
  "published",
  "hidden",
  "deleted",
]);
export const photoVariantKindSchema = z.enum([
  "photo_480",
  "photo_960",
  "photo_1920",
  "photo_original",
]);
export type PhotoVariantKind = z.infer<typeof photoVariantKindSchema>;

export const idempotencyKeySchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);

export const albumViewSchema = z
  .object({
    id: z.string().uuid(),
    slug: z.string().min(12).max(32),
    title: z.string().min(1).max(120),
    description: z.string().max(1_000),
    state: albumStateSchema,
    access: albumAccessSchema,
    publishMode: publishModeSchema,
    previewDownloadEnabled: z.boolean(),
    originalDownloadEnabled: z.boolean(),
    videoDownloadEnabled: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type AlbumView = z.infer<typeof albumViewSchema>;

export const createAlbumRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1_000).default(""),
    publishMode: publishModeSchema.default("review"),
  })
  .strict();
export type CreateAlbumRequest = z.infer<typeof createAlbumRequestSchema>;

export const createAlbumResponseSchema = z
  .object({
    album: albumViewSchema,
    generatedPassword: z.string().min(8),
  })
  .strict();

export const categoryViewSchema = z
  .object({
    id: z.string().uuid(),
    albumId: z.string().uuid(),
    name: z.string().min(1).max(60),
    sortOrder: z.number().int(),
    enabled: z.boolean(),
  })
  .strict();

export const createCategoryRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    sortOrder: z.number().int().min(0).max(10_000).default(0),
  })
  .strict();

const derivedPhotoVariantSchema = z
  .object({
    kind: z.enum(["photo_480", "photo_960", "photo_1920"]),
    format: z.enum(["webp", "jpeg"]),
    contentType: z.enum(["image/webp", "image/jpeg"]),
    width: z.number().int().min(1).max(1_920),
    height: z.number().int().min(1).max(1_920),
    bytes: z
      .number()
      .int()
      .min(1)
      .max(50 * 1024 * 1024),
  })
  .strict();

const originalPhotoVariantSchema = z
  .object({
    kind: z.literal("photo_original"),
    format: z.enum(["jpeg", "png", "webp"]),
    contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    width: z.number().int().min(1).max(100_000),
    height: z.number().int().min(1).max(100_000),
    bytes: z
      .number()
      .int()
      .min(1)
      .max(50 * 1024 * 1024),
  })
  .strict();

export const photoVariantInputSchema = z.discriminatedUnion("kind", [
  derivedPhotoVariantSchema,
  originalPhotoVariantSchema,
]);
export type PhotoVariantInput = z.infer<typeof photoVariantInputSchema>;

const requiredPhotoVariants = new Set<PhotoVariantKind>([
  "photo_480",
  "photo_960",
  "photo_1920",
  "photo_original",
]);

export const createPhotoUploadRequestSchema = z
  .object({
    albumId: z.string().uuid(),
    categoryId: z.string().uuid().nullable().default(null),
    width: z.number().int().min(1),
    height: z.number().int().min(1),
    totalBytes: z
      .number()
      .int()
      .min(1)
      .max(50 * 1024 * 1024),
    capturedAt: z.string().datetime().nullable().default(null),
    variants: z.array(photoVariantInputSchema).length(4),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.width * value.height > 100_000_000) {
      context.addIssue({ code: "custom", message: "照片总像素不能超过 100MP", path: ["width"] });
    }
    const kinds = new Set(value.variants.map((variant) => variant.kind));
    if (
      kinds.size !== requiredPhotoVariants.size ||
      [...requiredPhotoVariants].some((kind) => !kinds.has(kind))
    ) {
      context.addIssue({ code: "custom", message: "照片必须包含四个唯一变体", path: ["variants"] });
    }
    const derived = value.variants.filter((variant) => variant.kind !== "photo_original");
    const derivedFormats = new Set(derived.map((variant) => variant.format));
    if (derivedFormats.size !== 1) {
      context.addIssue({
        code: "custom",
        message: "三个派生图必须使用相同格式",
        path: ["variants"],
      });
    }
    for (const variant of value.variants) {
      const expectedType = variant.format === "jpeg" ? "image/jpeg" : `image/${variant.format}`;
      if (variant.contentType !== expectedType) {
        context.addIssue({
          code: "custom",
          message: "照片格式与 Content-Type 必须一致",
          path: ["variants"],
        });
      }
    }
    const original = value.variants.find((variant) => variant.kind === "photo_original");
    if (
      original !== undefined &&
      (original.bytes !== value.totalBytes ||
        original.width !== value.width ||
        original.height !== value.height)
    ) {
      context.addIssue({
        code: "custom",
        message: "原图规格必须与照片声明一致",
        path: ["variants"],
      });
    }
    const maxEdges = { photo_480: 480, photo_960: 960, photo_1920: 1_920 } as const;
    for (const variant of derived) {
      const maxEdge = maxEdges[variant.kind];
      const scale = Math.min(1, maxEdge / Math.max(value.width, value.height));
      const expectedWidth = Math.max(1, Math.round(value.width * scale));
      const expectedHeight = Math.max(1, Math.round(value.height * scale));
      if (variant.width !== expectedWidth || variant.height !== expectedHeight) {
        context.addIssue({
          code: "custom",
          message: `${variant.kind} 尺寸不符合固定派生规格`,
          path: ["variants"],
        });
      }
    }
  });
export type CreatePhotoUploadRequest = z.infer<typeof createPhotoUploadRequestSchema>;

export const uploadObjectViewSchema = z
  .object({
    kind: photoVariantKindSchema,
    objectKey: z.string().min(1).max(512),
    expectedBytes: z.number().int().positive(),
    contentType: z.string().min(1).max(80),
    completed: z.boolean(),
    uploadMode: z.enum(["single", "multipart"]),
    multipartUploadId: z.string().uuid().nullable(),
    parts: z.array(
      z
        .object({
          partNumber: z.number().int().positive(),
          expectedBytes: z.number().int().positive(),
          completed: z.boolean(),
          etag: z.string().min(1).max(128).nullable(),
        })
        .strict(),
    ),
  })
  .strict();

export const completeUploadPartRequestSchema = z
  .object({
    etag: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[\u0021-\u007e]+$/u),
  })
  .strict();

export const uploadIntentViewSchema = z
  .object({
    id: z.string().uuid(),
    mediaId: z.string().uuid(),
    ingestStatus: ingestStatusSchema,
    publicationStatus: publicationStatusSchema,
    expiresAt: z.string().datetime(),
    objects: z.array(uploadObjectViewSchema),
  })
  .strict();
export type UploadIntentView = z.infer<typeof uploadIntentViewSchema>;

export const signedUploadSchema = z
  .object({
    url: z.string().url(),
    headers: z.record(z.string(), z.string()),
    expiresAt: z.string().datetime(),
  })
  .strict();
export type SignedUpload = z.infer<typeof signedUploadSchema>;

export const mediaVariantViewSchema = z
  .object({
    kind: photoVariantKindSchema,
    url: z.string().url(),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    bytes: z.number().int().positive(),
    contentType: z.string(),
  })
  .strict();

export const publicMediaViewSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.literal("photo"),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    publishSequence: z.number().int().positive(),
    publishedAt: z.string().datetime(),
    variants: z.array(mediaVariantViewSchema),
  })
  .strict();
export type PublicMediaView = z.infer<typeof publicMediaViewSchema>;

export const internalMediaViewSchema = z
  .object({
    id: z.string().uuid(),
    albumId: z.string().uuid(),
    uploaderId: z.string().uuid(),
    kind: z.literal("photo"),
    ingestStatus: ingestStatusSchema,
    publicationStatus: publicationStatusSchema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type InternalMediaView = z.infer<typeof internalMediaViewSchema>;

export const publicAlbumViewSchema = z
  .object({
    slug: z.string(),
    title: z.string(),
    description: z.string(),
    state: albumStateSchema,
    access: albumAccessSchema,
    accessRequired: z.boolean(),
    categories: z.array(categoryViewSchema),
  })
  .strict();

export const unlockAlbumRequestSchema = z.object({ password: z.string().min(1).max(128) }).strict();
export const unlockAlbumResponseSchema = z.object({ unlocked: z.literal(true) }).strict();

export const publicMediaListSchema = z
  .object({
    items: z.array(publicMediaViewSchema),
    nextCursor: z.string().nullable(),
    eventCursor: z.number().int().min(0),
  })
  .strict();

export const liveEventViewSchema = z
  .object({
    id: z.number().int().positive(),
    type: z.string(),
    albumId: z.string().uuid(),
    mediaId: z.string().uuid().nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();
