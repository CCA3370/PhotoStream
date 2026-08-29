import { createDatabase, createPool } from "@photostream/db";

import { buildApp } from "./app.js";
import { argon2PasswordHasher } from "./auth/password.js";
import { PostgresAuthStore } from "./auth/postgres-store.js";
import { UserAdminService } from "./auth/user-admin-service.js";
import { BibService } from "./bib/service.js";
import { loadConfig } from "./config.js";
import { LiveEventBroker } from "./media/live-event-broker.js";
import { LocalObjectStorage } from "./media/object-storage.js";
import { OperationsService } from "./media/operations-service.js";
import { PhotoService } from "./media/service.js";

const config = loadConfig(process.env);
const pool = createPool(config.DATABASE_URL);
const database = createDatabase(pool);
const authStore = new PostgresAuthStore(database);
const broker = new LiveEventBroker();
await broker.start(pool);
const storage = new LocalObjectStorage({
  baseUrl: config.LOCAL_OBJECT_BASE_URL,
  secret: config.LOCAL_OBJECT_SECRET,
});
const photoService = new PhotoService({
  database,
  storage,
  passwordHasher: argon2PasswordHasher,
  config,
});
const userAdminService = new UserAdminService({
  database,
  passwordHasher: argon2PasswordHasher,
  config,
});
const operationsService = new OperationsService({ database, storage, config });
const bibService = new BibService({ database, config, photoService });
const app = await buildApp({
  config,
  authStore,
  photoService,
  broker,
  userAdminService,
  operationsService,
  bibService,
});
const deletionPoll = setInterval(() => {
  void operationsService.processPendingDeletionTasks().catch((error: unknown) => {
    app.log.error(
      { errorName: error instanceof Error ? error.name : "unknown" },
      "deletion poll failed",
    );
  });
}, 30_000);
deletionPoll.unref();
const analyticsCleanup = setInterval(
  () => {
    void operationsService.cleanupAnalytics().catch((error: unknown) => {
      app.log.error(
        { errorName: error instanceof Error ? error.name : "unknown" },
        "analytics cleanup failed",
      );
    });
  },
  24 * 60 * 60 * 1_000,
);
analyticsCleanup.unref();
const bibMaintenance = setInterval(() => {
  void Promise.all([
    bibService.processPendingRecalculations(),
    bibService.expireStaleOcrActivities(),
  ]).catch((error: unknown) => {
    app.log.error(
      { errorName: error instanceof Error ? error.name : "unknown" },
      "bib maintenance poll failed",
    );
  });
}, 30_000);
bibMaintenance.unref();
const bibCleanup = setInterval(
  () => {
    void bibService.cleanupStaleCandidates().catch((error: unknown) => {
      app.log.error(
        { errorName: error instanceof Error ? error.name : "unknown" },
        "bib candidate cleanup failed",
      );
    });
  },
  24 * 60 * 60 * 1_000,
);
bibCleanup.unref();

async function shutdown(signal: string): Promise<void> {
  clearInterval(deletionPoll);
  clearInterval(analyticsCleanup);
  clearInterval(bibMaintenance);
  clearInterval(bibCleanup);
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
