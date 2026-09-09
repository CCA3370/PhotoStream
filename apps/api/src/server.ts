import { createDatabase, createPool } from "@photostream/db";

import {
  AliyunCdnMetricsProvider,
  UnavailableCdnMetricsProvider,
} from "./analytics/cdn-metrics-provider.js";
import { DashboardService } from "./analytics/dashboard-service.js";
import { buildApp } from "./app.js";
import { argon2PasswordHasher } from "./auth/password.js";
import { PostgresAuthStore } from "./auth/postgres-store.js";
import { UserAdminService } from "./auth/user-admin-service.js";
import { BibService } from "./bib/service.js";
import { type AppConfig, loadConfig } from "./config.js";
import { EventBridgeVerifier } from "./face/eventbridge-verifier.js";
import { AliyunFaceProvider, UnavailableFaceProvider } from "./face/provider.js";
import { FacePublicStateService } from "./face/public-state-service.js";
import {
  AliyunFaceReferenceStorage,
  UnavailableFaceReferenceStorage,
} from "./face/reference-storage.js";
import { FaceService } from "./face/service.js";
import { AliyunCdnInvalidator, LocalCdnInvalidator } from "./media/cdn-invalidator.js";
import { FeaturedService } from "./media/featured-service.js";
import { MediaLikeService } from "./media/like-service.js";
import { LiveEventBroker } from "./media/live-event-broker.js";
import { AliyunObjectStorage, LocalObjectStorage } from "./media/object-storage.js";
import { OperationsService } from "./media/operations-service.js";
import { PhotoService } from "./media/service.js";
import { RuntimeMetrics } from "./observability/runtime-metrics.js";

const config = loadConfig(process.env);
const pool = createPool(config.DATABASE_URL);
const database = createDatabase(pool);
const authStore = new PostgresAuthStore(database);
const broker = new LiveEventBroker();
await broker.start(pool);
const runtimeMetrics = new RuntimeMetrics({
  pool,
  broker,
  ...(process.env.PHOTOSTREAM_RELEASE === undefined
    ? {}
    : { release: process.env.PHOTOSTREAM_RELEASE }),
  ...(process.env.PHOTOSTREAM_SLOT === undefined ? {} : { slot: process.env.PHOTOSTREAM_SLOT }),
});
const storage =
  config.OBJECT_STORAGE_DRIVER === "aliyun"
    ? new AliyunObjectStorage({
        accessKeyId: config.ALIYUN_ACCESS_KEY_ID as string,
        accessKeySecret: config.ALIYUN_ACCESS_KEY_SECRET as string,
        bucket: config.ALIYUN_OSS_MEDIA_BUCKET as string,
        cdnAuthKey: config.ALIYUN_CDN_AUTH_KEY_CURRENT as string,
        cdnAuthValiditySeconds: config.ALIYUN_CDN_AUTH_VALIDITY_SECONDS,
        endpoint: config.ALIYUN_OSS_ENDPOINT,
        mediaBaseUrl: config.MEDIA_BASE_URL,
        region: config.ALIYUN_OSS_REGION,
      })
    : new LocalObjectStorage({
        baseUrl: config.LOCAL_OBJECT_BASE_URL,
        secret: config.LOCAL_OBJECT_SECRET as string,
      });
const cdnInvalidator =
  config.OBJECT_STORAGE_DRIVER === "aliyun"
    ? new AliyunCdnInvalidator({
        accessKeyId: config.ALIYUN_ACCESS_KEY_ID as string,
        accessKeySecret: config.ALIYUN_ACCESS_KEY_SECRET as string,
        mediaBaseUrl: config.MEDIA_BASE_URL,
      })
    : new LocalCdnInvalidator();
const cdnMetrics =
  config.OBJECT_STORAGE_DRIVER === "aliyun"
    ? new AliyunCdnMetricsProvider({
        accessKeyId: config.ALIYUN_ACCESS_KEY_ID as string,
        accessKeySecret: config.ALIYUN_ACCESS_KEY_SECRET as string,
        mediaBaseUrl: config.MEDIA_BASE_URL,
      })
    : new UnavailableCdnMetricsProvider();
const photoService = new PhotoService({
  database,
  storage,
  passwordHasher: argon2PasswordHasher,
  config,
  cdnInvalidator,
});
const likeService = new MediaLikeService({
  database,
  secret: config.VISITOR_SESSION_SECRET,
});
const featuredService = new FeaturedService({ database });
const userAdminService = new UserAdminService({
  database,
  passwordHasher: argon2PasswordHasher,
  config,
});
const operationsService = new OperationsService({ database, storage, config, cdnInvalidator });
const dashboardService = new DashboardService({ database, storage, cdnMetrics });
const bibService = new BibService({ database, config, photoService });

function faceInfrastructureConfigured(value: AppConfig): boolean {
  return (
    value.ALIYUN_FACE_ACCESS_KEY_ID !== undefined &&
    value.ALIYUN_FACE_ACCESS_KEY_SECRET !== undefined &&
    value.ALIYUN_ACCOUNT_ID !== undefined &&
    value.ALIYUN_IMM_PROJECT_NAME !== undefined &&
    value.ALIYUN_OSS_MEDIA_BUCKET !== undefined &&
    value.ALIYUN_OSS_FACE_REFERENCE_BUCKET !== undefined
  );
}

const hasFaceInfrastructure = faceInfrastructureConfigured(config);
const faceProvider = hasFaceInfrastructure
  ? new AliyunFaceProvider(config)
  : new UnavailableFaceProvider();
const faceReferenceStorage = hasFaceInfrastructure
  ? new AliyunFaceReferenceStorage(config)
  : new UnavailableFaceReferenceStorage();
const faceService = new FaceService({
  database,
  config,
  photoService,
  provider: faceProvider,
  references: faceReferenceStorage,
});
const facePublicStateService = new FacePublicStateService({ database, config, photoService });
const eventBridgeVerifier = new EventBridgeVerifier(config);
await bibService.assertKeyCoverage();
const app = await buildApp({
  config,
  authStore,
  photoService,
  likeService,
  featuredService,
  broker,
  userAdminService,
  operationsService,
  dashboardService,
  bibService,
  faceService,
  facePublicStateService,
  eventBridgeVerifier,
  runtimeMetrics,
});
const deletionPoll = setInterval(() => {
  void runtimeMetrics
    .runJob("deletion", async () => {
      await Promise.all([
        operationsService.processPendingDeletionTasks(),
        photoService.processExpiredUploadCleanups(),
      ]);
    })
    .catch((error: unknown) => {
      app.log.error(
        { errorName: error instanceof Error ? error.name : "unknown" },
        "deletion poll failed",
      );
    });
}, 30_000);
deletionPoll.unref();
const analyticsCleanup = setInterval(
  () => {
    void runtimeMetrics
      .runJob("analyticsCleanup", async () => {
        await Promise.all([
          operationsService.cleanupAnalytics(),
          operationsService.cleanupOperationalRecords(),
          dashboardService.cleanupSearchUsage(),
        ]);
      })
      .catch((error: unknown) => {
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
  void runtimeMetrics
    .runJob("bibMaintenance", async () => {
      await Promise.all([
        bibService.processPendingRecalculations(),
        bibService.expireStaleOcrActivities(),
        bibService.processKeyRotation(),
      ]);
    })
    .catch((error: unknown) => {
      app.log.error(
        { errorName: error instanceof Error ? error.name : "unknown" },
        "bib maintenance poll failed",
      );
    });
}, 30_000);
bibMaintenance.unref();
const faceMaintenance = setInterval(() => {
  void runtimeMetrics.runJob("faceMaintenance", () => faceService.runMaintenance()).catch((error) => {
    app.log.error(
      { errorName: error instanceof Error ? error.name : "unknown" },
      "face maintenance poll failed",
    );
  });
}, 30_000);
faceMaintenance.unref();
const bibCleanup = setInterval(
  () => {
    void runtimeMetrics
      .runJob("bibCleanup", () => bibService.cleanupStaleCandidates())
      .catch((error: unknown) => {
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
  clearInterval(faceMaintenance);
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
