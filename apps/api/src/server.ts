import { createDatabase, createPool } from "@photostream/db";

import { buildApp } from "./app.js";
import { argon2PasswordHasher } from "./auth/password.js";
import { PostgresAuthStore } from "./auth/postgres-store.js";
import { loadConfig } from "./config.js";
import { LiveEventBroker } from "./media/live-event-broker.js";
import { LocalObjectStorage } from "./media/object-storage.js";
import { PhotoService } from "./media/service.js";

const config = loadConfig(process.env);
const pool = createPool(config.DATABASE_URL);
const database = createDatabase(pool);
const authStore = new PostgresAuthStore(database);
const broker = new LiveEventBroker();
await broker.start(pool);
const photoService = new PhotoService({
  database,
  storage: new LocalObjectStorage({
    baseUrl: config.LOCAL_OBJECT_BASE_URL,
    secret: config.LOCAL_OBJECT_SECRET,
  }),
  passwordHasher: argon2PasswordHasher,
  config,
});
const app = await buildApp({ config, authStore, photoService, broker });

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "shutdown requested");
  await app.close();
  await broker.close();
  await pool.end();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.fatal({ errorName: error instanceof Error ? error.name : "unknown" }, "startup failed");
  await broker.close();
  await pool.end();
  process.exitCode = 1;
}
