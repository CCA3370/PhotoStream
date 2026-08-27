import { z } from "zod";

const secretSchema = z.string().min(32);

const configSchema = z.object({
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
  BOOTSTRAP_ADMIN_TOKEN: secretSchema.optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
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
