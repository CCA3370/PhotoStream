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
