import { z } from "zod";

const secretSchema = z.string().min(32);
const optionalEnvironmentValue = (value: unknown): unknown => (value === "" ? undefined : value);
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
