import { z } from "zod";

const secretSchema = z.string().min(32);
const optionalEnvironmentValue = (value: unknown): unknown => (value === "" ? undefined : value);
const environmentBoolean = (value: unknown): unknown => {
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
};
const bibDataKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/u, "must use base64url characters")
  .refine((value) => Buffer.from(value, "base64url").byteLength === 32, {
    message: "must be a base64url encoded 32-byte key",
  });

const configSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    HOST: z.string().min(1).default("127.0.0.1"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
    APP_ORIGIN: z.string().url(),
    MEDIA_BASE_URL: z.string().url(),
    DATABASE_URL: z.string().startsWith("postgresql://"),
    SESSION_SECRET_CURRENT: secretSchema,
    SESSION_SECRET_PREVIOUS: secretSchema.optional(),
    CSRF_SECRET: secretSchema,
    CURSOR_SIGNING_SECRET: secretSchema,
    VISITOR_SESSION_SECRET: secretSchema,
    ALBUM_PASSWORD_GENERATION_SECRET: secretSchema,
    USER_PASSWORD_GENERATION_SECRET: secretSchema,
    ANALYTICS_HMAC_SECRET: secretSchema,
    BIB_DATA_KEY: z.preprocess(optionalEnvironmentValue, bibDataKeySchema.optional()),
    BIB_SEARCH_KEY: z.preprocess(optionalEnvironmentValue, secretSchema.optional()),
    BIB_KEY_VERSION: z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,40}$/u)
      .default("v1"),
    BIB_DATA_KEY_PREVIOUS: z.preprocess(optionalEnvironmentValue, bibDataKeySchema.optional()),
    BIB_SEARCH_KEY_PREVIOUS: z.preprocess(optionalEnvironmentValue, secretSchema.optional()),
    BIB_KEY_VERSION_PREVIOUS: z.preprocess(
      optionalEnvironmentValue,
      z
        .string()
        .regex(/^[A-Za-z0-9._-]{1,40}$/u)
        .optional(),
    ),
    BIB_OCR_AUTOMATION_STATUS: z
      .enum(["disabled", "experimental", "qualified"])
      .default("experimental"),
    FACE_SEARCH_GLOBAL_ENABLED: z
      .preprocess(environmentBoolean, z.boolean())
      .default(false),
    FACE_SEARCH_NOTICE_VERSION: z.string().min(1).max(80).default("face-notice-2026-08-31"),
    FACE_SEARCH_THRESHOLD_VERSION: z.string().min(1).max(80).default("unqualified"),
    FACE_SEARCH_CLUSTER_THRESHOLD: z.coerce.number().min(0).max(1).default(0.92),
    FACE_SEARCH_ASYNC_THRESHOLD: z.coerce.number().min(0).max(1).default(0.92),
    FACE_SEARCH_MIN_QUALITY: z.coerce.number().min(0).max(1).default(0.8),
    FACE_SEARCH_MIN_SHARPNESS: z.coerce.number().min(0).max(1).default(0.6),
    FACE_SEARCH_MIN_FACE_EDGE: z.coerce.number().int().min(32).max(1_920).default(120),
    ALIYUN_FACE_ACCESS_KEY_ID: z.preprocess(optionalEnvironmentValue, z.string().min(1).optional()),
    ALIYUN_FACE_ACCESS_KEY_SECRET: z.preprocess(
      optionalEnvironmentValue,
      z.string().min(1).optional(),
    ),
    ALIYUN_ACCOUNT_ID: z.preprocess(optionalEnvironmentValue, z.string().min(1).optional()),
    ALIYUN_IMM_REGION: z.literal("cn-hangzhou").default("cn-hangzhou"),
    ALIYUN_IMM_PROJECT_NAME: z.preprocess(optionalEnvironmentValue, z.string().min(1).optional()),
    ALIYUN_OSS_MEDIA_BUCKET: z.preprocess(optionalEnvironmentValue, z.string().min(3).optional()),
    ALIYUN_OSS_FACE_REFERENCE_BUCKET: z.preprocess(
      optionalEnvironmentValue,
      z.string().min(3).optional(),
    ),
    ALIYUN_OSS_ENDPOINT: z.string().url().default("https://oss-cn-hangzhou.aliyuncs.com"),
    EVENTBRIDGE_SIGNATURE_TOKEN: z.preprocess(
      optionalEnvironmentValue,
      z.string().min(16).optional(),
    ),
    LOCAL_OBJECT_SECRET: secretSchema,
    LOCAL_OBJECT_BASE_URL: z.string().url().default("http://127.0.0.1:3002"),
    BOOTSTRAP_ADMIN_TOKEN: secretSchema.optional(),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  })
  .superRefine((value, context) => {
    if ((value.BIB_DATA_KEY === undefined) !== (value.BIB_SEARCH_KEY === undefined)) {
      context.addIssue({
        code: "custom",
        message: "BIB_DATA_KEY and BIB_SEARCH_KEY must be configured together",
        path: [value.BIB_DATA_KEY === undefined ? "BIB_DATA_KEY" : "BIB_SEARCH_KEY"],
      });
    }
    const previous = [
      value.BIB_DATA_KEY_PREVIOUS,
      value.BIB_SEARCH_KEY_PREVIOUS,
      value.BIB_KEY_VERSION_PREVIOUS,
    ];
    const previousCount = previous.filter((candidate) => candidate !== undefined).length;
    if (previousCount !== 0 && previousCount !== previous.length) {
      context.addIssue({
        code: "custom",
        message: "previous bib key material must be configured as one complete set",
        path: [
          value.BIB_DATA_KEY_PREVIOUS === undefined
            ? "BIB_DATA_KEY_PREVIOUS"
            : value.BIB_SEARCH_KEY_PREVIOUS === undefined
              ? "BIB_SEARCH_KEY_PREVIOUS"
              : "BIB_KEY_VERSION_PREVIOUS",
        ],
      });
    }
    if (previousCount > 0 && value.BIB_DATA_KEY === undefined) {
      context.addIssue({
        code: "custom",
        message: "current bib key material is required during rotation",
        path: ["BIB_DATA_KEY"],
      });
    }
    if (
      value.BIB_KEY_VERSION_PREVIOUS !== undefined &&
      value.BIB_KEY_VERSION_PREVIOUS === value.BIB_KEY_VERSION
    ) {
      context.addIssue({
        code: "custom",
        message: "current and previous bib key versions must differ",
        path: ["BIB_KEY_VERSION_PREVIOUS"],
      });
    }
    if (value.FACE_SEARCH_GLOBAL_ENABLED) {
      const required = [
        "ALIYUN_FACE_ACCESS_KEY_ID",
        "ALIYUN_FACE_ACCESS_KEY_SECRET",
        "ALIYUN_ACCOUNT_ID",
        "ALIYUN_IMM_PROJECT_NAME",
        "ALIYUN_OSS_MEDIA_BUCKET",
        "ALIYUN_OSS_FACE_REFERENCE_BUCKET",
      ] as const;
      for (const field of required) {
        if (value[field] === undefined) {
          context.addIssue({ code: "custom", message: `${field} is required`, path: [field] });
        }
      }
      if (value.FACE_SEARCH_THRESHOLD_VERSION === "unqualified") {
        context.addIssue({
          code: "custom",
          message: "a qualified threshold version is required",
          path: ["FACE_SEARCH_THRESHOLD_VERSION"],
        });
      }
      if (value.ALIYUN_OSS_MEDIA_BUCKET === value.ALIYUN_OSS_FACE_REFERENCE_BUCKET) {
        context.addIssue({
          code: "custom",
          message: "media and temporary face references must use separate buckets",
          path: ["ALIYUN_OSS_FACE_REFERENCE_BUCKET"],
        });
      }
    }
  });

export type AppConfig = z.infer<typeof configSchema>;

export class ConfigurationError extends Error {
  readonly fields: readonly string[];

  constructor(fields: readonly string[]) {
    super(`Invalid configuration: ${fields.join(", ")}`);
    this.name = "ConfigurationError";
    this.fields = fields;
  }
}

export function loadConfig(environment: NodeJS.ProcessEnv): AppConfig {
  const result = configSchema.safeParse(environment);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))].sort();
    throw new ConfigurationError(fields);
  }

  return result.data;
}

export function trustedHosts(config: AppConfig): ReadonlySet<string> {
  return new Set([
    new URL(config.APP_ORIGIN).host,
    `localhost:${config.PORT}`,
    `127.0.0.1:${config.PORT}`,
  ]);
}
