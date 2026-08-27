import { createDatabase, createPool } from "@photostream/db";

import { buildApp } from "./app.js";
import { PostgresAuthStore } from "./auth/postgres-store.js";
import { loadConfig } from "./config.js";

const config = loadConfig(process.env);
const pool = createPool(config.DATABASE_URL);
const authStore = new PostgresAuthStore(createDatabase(pool));
const app = await buildApp({ config, authStore });

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "shutdown requested");
  await app.close();
  await pool.end();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.fatal({ errorName: error instanceof Error ? error.name : "unknown" }, "startup failed");
  await pool.end();
  process.exitCode = 1;
}
