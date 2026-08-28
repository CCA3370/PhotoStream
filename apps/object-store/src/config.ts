import { z } from "zod";

const configSchema = z.object({
  OBJECT_STORE_HOST: z.string().min(1).default("127.0.0.1"),
  OBJECT_STORE_PORT: z.coerce.number().int().min(1).max(65_535).default(3002),
  OBJECT_STORE_ROOT: z.string().min(1).default(".local-data/objects"),
  LOCAL_OBJECT_SECRET: z.string().min(32),
  APP_ORIGIN: z.string().url(),
});

export function loadObjectStoreConfig(environment: NodeJS.ProcessEnv) {
  return configSchema.parse(environment);
}
