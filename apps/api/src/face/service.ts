import { createHmac, randomBytes, randomUUID } from "node:crypto";

import {
  type FaceConfigUpdate,
  type FaceConfigView,
  type FaceFailureCode,
  type FaceSearchSafeState,
  hasPermission,
} from "@photostream/contracts";
import type { Database } from "@photostream/db";
import { schema } from "@photostream/db";
import { and, asc, count, eq, gt, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { z } from "zod";

import { ALIYUN_REGION, type AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import type { InternalActor, PhotoService } from "../media/service.js";
import type { FaceProvider } from "./provider.js";
import type { FaceReferenceStorage } from "./reference-storage.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
const terminalStatuses = ["completed", "failed", "cancelled", "expired"] as const;
const readinessKeys = [
  "participantConsentRecordsConfirmed",
  "guardianConsentRequirementsConfirmed",
  "impactAssessmentCompleted",
  "providerResourcesValidated",
  "evaluationGatePassed",
  "billingAlertsConfigured",
  "indexedFacesAuthorized",
] as const;

const eventSchema = z
  .object({
    id: z.string().min(1).max(256),
    source: z.literal("acs.imm"),
    specversion: z.literal("1.0"),
    type: z.literal("imm:Task:FacesSearching"),
    aliyunaccountid: z.string(),
    aliyunregionid: z.literal(ALIYUN_REGION),
    data: z
      .object({
        ProjectName: z.string(),
        DatasetName: z.string(),
        TaskType: z.literal("FacesSearching"),
        TaskId: z.string().min(1).max(256),
        Status: z.enum(["Succeeded", "Failed"]),
        SimilarFaces: z
          .array(
            z
              .object({
                SimilarFaces: z
                  .array(
                    z
                      .object({ URI: z.string(), Similarity: z.number().min(0).max(1) })
                      .passthrough(),
                  )
                  .max(100)
                  .default([]),
              })
              .passthrough(),
          )
          .max(4)
          .default([]),
      })
      .passthrough(),
  })
  .passthrough();

function requirePermission(actor: InternalActor, permission: Parameters<typeof hasPermission>[1]) {
  if (!hasPermission(actor.role, permission)) {
    throw new AppError({ code: "FORBIDDEN", message: "当前角色无权执行此操作", statusCode: 403 });
  }
}

function digest(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value, "utf8").digest("hex");
}

function safeState(row: typeof schema.faceSearchIntents.$inferSelect): FaceSearchSafeState {
  return {
    id: row.id,
    status: row.status,
    referenceExpiresAt: row.referenceExpiresAt.toISOString(),
    resultExpiresAt: row.resultExpiresAt.toISOString(),
    failureCode: row.failureCode as FaceFailureCode | null,
  };
}

function providerFailure(): AppError {
  return new AppError({
    code: "FACE_PROVIDER_UNAVAILABLE",
    message: "人脸检索服务暂时不可用",
    statusCode: 503,
    retryable: true,
  });
}

function requireRecentAuthentication(authenticatedAt: Date): void {
  if (Date.now() - authenticatedAt.getTime() > 15 * 60_000) {
    throw new AppError({
      code: "RECENT_AUTH_REQUIRED",
      message: "请重新登录后执行此敏感操作",
      statusCode: 403,
    });
  }
}

function boundedJson(value: unknown): boolean {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    nodes += 1;
    if (nodes > 10_000 || current.depth > 20) return false;
    if (Array.isArray(current.value)) {
      for (const child of current.value) pending.push({ value: child, depth: current.depth + 1 });
    } else if (typeof current.value === "object" && current.value !== null) {
      for (const child of Object.values(current.value)) {
        pending.push({ value: child, depth: current.depth + 1 });
      }
    }
  }
  return true;
}

export class FaceService {
  readonly #database: Database;
  readonly #config: AppConfig;
  readonly #photoService: PhotoService;
  readonly #provider: FaceProvider;
  readonly #references: FaceReferenceStorage;
  #maintenanceRunning = false;

  constructor(options: {
    database: Database;
    config: AppConfig;
    photoService: PhotoService;
    provider: FaceProvider;
    references: FaceReferenceStorage;
  }) {
    this.#database = options.database;
    this.#config = options.config;
    this.#photoService = options.photoService;
    this.#provider = options.provider;
    this.#references = options.references;
  }

  async getConfig(actor: InternalActor, albumId: string): Promise<FaceConfigView> {
    requirePermission(actor, "album:configure");
    return this.#configView(albumId);
  }

  async updateConfig(options: {
    actor: InternalActor & { authenticatedAt: Date };
    albumId: string;
    input: FaceConfigUpdate;
    requestId: string;
  }): Promise<FaceConfigView> {
    requirePermission(options.actor, "album:configure");
    const [album] = await this.#database
      .select()
      .from(schema.albums)
      .where(eq(schema.albums.id, options.albumId))
      .limit(1);
    if (album === undefined) throw this.#notFound();
    const ready =
      this.#config.FACE_SEARCH_GLOBAL_ENABLED &&
      album.access === "password" &&
      album.privacyNotice.trim() !== "" &&
      album.complaintContact.trim() !== "" &&
      options.input.noticeVersion === this.#config.FACE_SEARCH_NOTICE_VERSION &&
      this.#config.FACE_SEARCH_THRESHOLD_VERSION !== "unqualified" &&
      readinessKeys.every((key) => options.input.readiness[key]);
    if (options.input.enabled && !ready) {
      throw new AppError({
        code: "FACE_SEARCH_DISABLED",
        message: "人脸检索启用条件尚未全部满足",
        statusCode: 409,
      });
    }
    const existing = await this.#index(options.albumId);
    if (options.input.enabled && existing?.enabled === false && existing.datasetName !== null) {
      throw new AppError({
        code: "FACE_INDEX_NOT_READY",
        message: "整册索引仍在删除中，请等待删除完成后重新启用",
        statusCode: 409,
        retryable: true,
      });
    }
    if ((existing?.enabled ?? false) !== options.input.enabled) {
      requireRecentAuthentication(options.actor.authenticatedAt);
    }
    const requestedDeletionDueAt = new Date(Date.now() + options.input.retentionDays * 86_400_000);
    const deletionDueAt =
      album.state !== "ended" && album.state !== "archived"
        ? null
        : existing?.deletionDueAt === null || existing?.deletionDueAt === undefined
          ? requestedDeletionDueAt
          : new Date(Math.min(existing.deletionDueAt.getTime(), requestedDeletionDueAt.getTime()));
    const datasetName = existing?.datasetName ?? `face_${randomBytes(18).toString("hex")}`;
    await this.#database.transaction(async (transaction) => {
      await transaction
        .insert(schema.albumFaceIndexes)
        .values({
          albumId: options.albumId,
          enabled: options.input.enabled,
          noticeVersion: options.input.noticeVersion,
          thresholdVersion: this.#config.FACE_SEARCH_THRESHOLD_VERSION,
          ...options.input.readiness,
          authorizationConfirmedAt: options.input.enabled ? new Date() : null,
          indexState: options.input.enabled
            ? existing?.enabled === true
              ? existing.indexState
              : "provisioning"
            : existing?.datasetName === null || existing === null
              ? "disabled"
              : "deleting",
          datasetName: options.input.enabled ? datasetName : existing?.datasetName,
          retentionDays: options.input.retentionDays,
          deletionDueAt,
          lastErrorCode: null,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: schema.albumFaceIndexes.albumId,
          set: {
            enabled: options.input.enabled,
            noticeVersion: options.input.noticeVersion,
            thresholdVersion: this.#config.FACE_SEARCH_THRESHOLD_VERSION,
            ...options.input.readiness,
            authorizationConfirmedAt: options.input.enabled ? new Date() : null,
            indexState: options.input.enabled
              ? existing?.enabled === true
                ? existing.indexState
                : "provisioning"
              : existing?.datasetName == null
                ? "disabled"
                : "deleting",
            datasetName: options.input.enabled ? datasetName : existing?.datasetName,
            retentionDays: options.input.retentionDays,
            deletionDueAt,
            lastErrorCode: null,
            updatedAt: new Date(),
          },
        });
      if (options.input.enabled) {
        if (existing?.enabled !== true) {
          await transaction
            .insert(schema.faceAlbumJobs)
            .values({ albumId: options.albumId, kind: "provision_dataset" })
            .onConflictDoNothing();
        }
      } else if (existing?.datasetName != null) {
        await transaction
          .insert(schema.faceAlbumJobs)
          .values({ albumId: options.albumId, kind: "delete_dataset" })
          .onConflictDoNothing();
      }
      if (!options.input.enabled) await this.#cancelAlbumSearches(transaction, options.albumId);
      await transaction.insert(schema.auditLogs).values({
        actorUserId: options.actor.id,
        action: options.input.enabled ? "enableFaceSearch" : "disableFaceSearch",
        targetType: "album",
        targetId: options.albumId,
        result: "success",
        changedFields: ["faceSearchEnabled", "faceNoticeVersion", "faceRetentionDays"],
        requestId: options.requestId,
      });
    });
    if (!options.input.enabled) await this.#cleanupAlbumReferences(options.albumId);
    return this.#configView(options.albumId);
  }

  async excludeMedia(options: {
    actor: InternalActor & { authenticatedAt: Date };
    albumId: string;
    mediaIds: readonly string[];
    requestId: string;
  }): Promise<FaceConfigView> {
    requirePermission(options.actor, "album:configure");
    requireRecentAuthentication(options.actor.authenticatedAt);
    const rows = await this.#database
      .select({ id: schema.media.id })
      .from(schema.media)
      .where(
        and(
          eq(schema.media.albumId, options.albumId),
          inArray(schema.media.id, [...options.mediaIds]),
        ),
      );
    if (rows.length !== options.mediaIds.length) throw this.#notFound();
    await this.#database.transaction(async (transaction) => {
      for (const mediaId of options.mediaIds) {
        await transaction
          .insert(schema.mediaFaceIndexTasks)
          .values({ albumId: options.albumId, mediaId, status: "excluded" })
          .onConflictDoUpdate({
            target: schema.mediaFaceIndexTasks.mediaId,
            set: {
              status: "excluded",
              deletionConfirmedAt: null,
              nextAttemptAt: new Date(),
              updatedAt: new Date(),
            },
          });
      }
      await transaction.insert(schema.auditLogs).values({
        actorUserId: options.actor.id,
        action: "excludeFaceIndexMedia",
        targetType: "album",
        targetId: options.albumId,
        result: "success",
        changedFields: ["faceIndexExclusions"],
        requestId: options.requestId,
      });
    });
    return this.#configView(options.albumId);
  }

  async retry(actor: InternalActor, albumId: string): Promise<FaceConfigView> {
    requirePermission(actor, "album:configure");
    const now = new Date();
    await this.#database
      .update(schema.faceAlbumJobs)
      .set({ providerTaskId: null, updatedAt: now })
      .where(
        and(
          eq(schema.faceAlbumJobs.albumId, albumId),
          eq(schema.faceAlbumJobs.kind, "cluster"),
          eq(schema.faceAlbumJobs.status, "failed"),
        ),
      );
    await Promise.all([
      this.#database
        .update(schema.faceAlbumJobs)
        .set({
          status: "pending",
          attempts: 0,
          nextAttemptAt: now,
          lastErrorCode: null,
          updatedAt: now,
        })
        .where(
          and(eq(schema.faceAlbumJobs.albumId, albumId), eq(schema.faceAlbumJobs.status, "failed")),
        ),
      this.#database
        .update(schema.mediaFaceIndexTasks)
        .set({
          status: "pending",
          attempts: 0,
          nextAttemptAt: now,
          lastErrorCode: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.mediaFaceIndexTasks.albumId, albumId),
            eq(schema.mediaFaceIndexTasks.status, "failed"),
          ),
        ),
    ]);
    return this.#configView(albumId);
  }

  async deleteIndex(
    actor: InternalActor & { authenticatedAt: Date },
    albumId: string,
    requestId: string,
  ): Promise<FaceConfigView> {
    requirePermission(actor, "album:configure");
    requireRecentAuthentication(actor.authenticatedAt);
    const index = await this.#index(albumId);
    await this.#database.transaction(async (transaction) => {
      await transaction
        .update(schema.albumFaceIndexes)
        .set({
          enabled: false,
          indexState: index?.datasetName == null ? "disabled" : "deleting",
          updatedAt: new Date(),
        })
        .where(eq(schema.albumFaceIndexes.albumId, albumId));
      if (index?.datasetName != null) {
        await transaction
          .insert(schema.faceAlbumJobs)
          .values({ albumId, kind: "delete_dataset" })
          .onConflictDoNothing();
      }
      await this.#cancelAlbumSearches(transaction, albumId);
      await transaction.insert(schema.auditLogs).values({
        actorUserId: actor.id,
        action: "deleteFaceIndex",
        targetType: "album",
        targetId: albumId,
        result: "success",
        changedFields: ["faceDataset"],
        requestId,
      });
    });
    await this.#cleanupAlbumReferences(albumId);
    return this.#configView(albumId);
  }

  async createSearch(options: {
    slug: string;
    visitorToken: string | undefined;
    ip: string;
    noticeVersion: string;
    declaration: "self" | "guardian_or_authorized";
    bytes: number;
  }) {
    const { album, index, sessionDigest, ipDigest } = await this.#authorizedSearchContext(options);
    if (options.noticeVersion !== index.noticeVersion) {
      throw new AppError({
        code: "FACE_SEARCH_DISABLED",
        message: "隐私告知版本已更新",
        statusCode: 409,
      });
    }
    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000);
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const id = randomUUID();
    const objectKey = `face-references/${new Date().toISOString().slice(0, 10)}/${id}.jpg`;
    const referenceExpiresAt = new Date(Date.now() + 60 * 60_000);
    const resultExpiresAt = new Date(Date.now() + 2 * 60 * 60_000);
    const upload = await this.#references.signPut(objectKey, 15 * 60);
    await this.#database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`face-session:${sessionDigest}`}, 0))`,
      );
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`face-ip:${ipDigest}`}, 0))`,
      );
      const [[sessionRecent], [ipRecent], [sessionDaily], [ipDaily]] = await Promise.all([
        transaction
          .select({ value: count() })
          .from(schema.faceSearchIntents)
          .where(
            and(
              eq(schema.faceSearchIntents.visitorSessionDigest, sessionDigest),
              sql`${schema.faceSearchIntents.createdAt} >= ${tenMinutesAgo}`,
            ),
          ),
        transaction
          .select({ value: count() })
          .from(schema.faceSearchIntents)
          .where(
            and(
              eq(schema.faceSearchIntents.ipDailyDigest, ipDigest),
              sql`${schema.faceSearchIntents.createdAt} >= ${tenMinutesAgo}`,
            ),
          ),
        transaction
          .select({ value: count() })
          .from(schema.faceSearchIntents)
          .where(
            and(
              eq(schema.faceSearchIntents.visitorSessionDigest, sessionDigest),
              sql`${schema.faceSearchIntents.createdAt} >= ${dayStart}`,
            ),
          ),
        transaction
          .select({ value: count() })
          .from(schema.faceSearchIntents)
          .where(
            and(
              eq(schema.faceSearchIntents.ipDailyDigest, ipDigest),
              sql`${schema.faceSearchIntents.createdAt} >= ${dayStart}`,
            ),
          ),
      ]);
      if (
        (sessionRecent?.value ?? 0) >= 3 ||
        (ipRecent?.value ?? 0) >= 3 ||
        (sessionDaily?.value ?? 0) >= 10 ||
        (ipDaily?.value ?? 0) >= 10
      ) {
        throw new AppError({
          code: "FACE_RATE_LIMITED",
          message: "检索次数已达上限，请稍后再试",
          statusCode: 429,
        });
      }
      const [receipt] = await transaction
        .insert(schema.faceConsentReceipts)
        .values({
          albumId: album.id,
          noticeVersion: options.noticeVersion,
          declaration: options.declaration,
        })
        .returning({ id: schema.faceConsentReceipts.id });
      await transaction.insert(schema.faceSearchIntents).values({
        id,
        albumId: album.id,
        visitorSessionDigest: sessionDigest,
        ipDailyDigest: ipDigest,
        objectKey,
        expectedBytes: options.bytes,
        noticeVersion: options.noticeVersion,
        declaration: options.declaration,
        consentReceiptId: receipt?.id,
        referenceExpiresAt,
        resultExpiresAt,
      });
    });
    return {
      id,
      status: "awaiting_upload" as const,
      upload: { ...upload, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() },
      referenceExpiresAt: referenceExpiresAt.toISOString(),
      resultExpiresAt: resultExpiresAt.toISOString(),
    };
  }

  async completeSearch(options: {
    slug: string;
    searchId: string;
    visitorToken: string | undefined;
    ip: string;
  }): Promise<FaceSearchSafeState> {
    const context = await this.#authorizedSearchContext(options);
    const intent = await this.#ownedIntent(
      options.searchId,
      context.album.id,
      context.sessionDigest,
    );
    if (intent.status !== "awaiting_upload") return safeState(intent);
    if (intent.referenceExpiresAt <= new Date()) return this.#expireIntent(intent);
    let metadata: Awaited<ReturnType<FaceReferenceStorage["head"]>>;
    try {
      metadata = await this.#references.head(intent.objectKey);
    } catch {
      throw new AppError({
        code: "FACE_REFERENCE_INVALID",
        message: "参考照上传未完成",
        statusCode: 409,
      });
    }
    if (metadata.bytes !== intent.expectedBytes || metadata.contentType !== "image/jpeg") {
      await this.#failAndDelete(intent, "reference_format_invalid");
      throw new AppError({
        code: "FACE_REFERENCE_INVALID",
        message: "参考照格式无效",
        statusCode: 400,
      });
    }
    const claimed = await this.#database
      .update(schema.faceSearchIntents)
      .set({ status: "processing", objectEtag: metadata.etag, updatedAt: new Date() })
      .where(
        and(
          eq(schema.faceSearchIntents.id, intent.id),
          eq(schema.faceSearchIntents.status, "awaiting_upload"),
        ),
      )
      .returning({ id: schema.faceSearchIntents.id });
    if (claimed.length === 0) {
      return safeState(await this.#ownedIntent(intent.id, context.album.id, context.sessionDigest));
    }
    const uri = this.#references.uri(intent.objectKey);
    let validation: Awaited<ReturnType<FaceProvider["validateReference"]>>;
    try {
      validation = await this.#provider.validateReference(uri);
    } catch {
      await this.#failAndDelete(intent, "provider_unavailable");
      throw providerFailure();
    }
    if (validation !== "ok") {
      await this.#failAndDelete(intent, validation);
      const mapping = {
        no_face: ["FACE_NO_FACE", "未检测到清晰人脸"],
        multiple_faces: ["FACE_MULTIPLE_FACES", "参考照中只能包含一张人脸"],
        quality_low: ["FACE_QUALITY_LOW", "参考照清晰度不足"],
      } as const;
      const [code, message] = mapping[validation];
      throw new AppError({ code, message, statusCode: 400 });
    }
    let mediaIds: string[];
    try {
      mediaIds = await this.#provider.findSynchronousCandidates(
        context.index.datasetName as string,
        uri,
      );
      await this.#database.transaction(async (transaction) => {
        await this.#insertAuthorizedCandidates(
          transaction,
          intent.id,
          context.album.id,
          mediaIds,
          intent.resultExpiresAt,
        );
        await transaction
          .update(schema.faceSearchIntents)
          .set({ initialSearchCompletedAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.faceSearchIntents.id, intent.id));
      });
    } catch {
      await this.#failAndDelete(intent, "provider_unavailable");
      throw providerFailure();
    }
    try {
      const providerTaskId = await this.#provider.startAsyncSearch(
        context.index.datasetName as string,
        uri,
      );
      await this.#database
        .update(schema.faceSearchIntents)
        .set({
          status: mediaIds.length > 0 ? "partial" : "processing",
          providerTaskId,
          updatedAt: new Date(),
        })
        .where(eq(schema.faceSearchIntents.id, intent.id));
    } catch {
      await this.#database.transaction(async (transaction) => {
        await transaction
          .update(schema.faceSearchIntents)
          .set({
            status: "failed",
            failureCode: "async_search_failed",
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(schema.faceSearchIntents.id, intent.id));
        if (intent.consentReceiptId !== null) {
          await transaction
            .update(schema.faceConsentReceipts)
            .set({
              resultCategory: mediaIds.length > 0 ? "completed_with_results" : "provider_failed",
              updatedAt: new Date(),
            })
            .where(eq(schema.faceConsentReceipts.id, intent.consentReceiptId));
        }
      });
      await this.#deleteReference(intent);
    }
    const updated = await this.#ownedIntent(intent.id, context.album.id, context.sessionDigest);
    return safeState(updated);
  }

  async getSearch(options: {
    slug: string;
    searchId: string;
    visitorToken: string | undefined;
    ip: string;
    cursor: string | undefined;
    limit: number;
  }) {
    const context = await this.#authorizedSearchContext(options);
    let intent = await this.#ownedIntent(options.searchId, context.album.id, context.sessionDigest);
    if (intent.resultExpiresAt <= new Date() && intent.status !== "expired") {
      await this.#expireIntent(intent);
      intent = await this.#ownedIntent(options.searchId, context.album.id, context.sessionDigest);
    }
    const candidateRows = await this.#database
      .select({ mediaId: schema.faceSearchCandidates.mediaId })
      .from(schema.faceSearchCandidates)
      .innerJoin(schema.media, eq(schema.media.id, schema.faceSearchCandidates.mediaId))
      .innerJoin(
        schema.mediaFaceIndexTasks,
        eq(schema.mediaFaceIndexTasks.mediaId, schema.media.id),
      )
      .where(
        and(
          eq(schema.faceSearchCandidates.searchIntentId, intent.id),
          gtNow(schema.faceSearchCandidates.expiresAt),
          eq(schema.media.albumId, context.album.id),
          eq(schema.media.publicationStatus, "published"),
          eq(schema.mediaFaceIndexTasks.status, "indexed"),
        ),
      );
    const media = await this.#photoService.listPublicMedia({
      slug: options.slug,
      visitorToken: options.visitorToken,
      cursor: options.cursor,
      categoryId: undefined,
      limit: options.limit,
      mediaIds: candidateRows.map((row) => row.mediaId),
    });
    return { search: safeState(intent), items: media.items, nextCursor: media.nextCursor };
  }

  async deleteSearch(options: {
    slug: string;
    searchId: string;
    visitorToken: string | undefined;
    ip: string;
  }) {
    const context = await this.#ownedSearchContext(options);
    const intent = await this.#ownedIntent(
      options.searchId,
      context.album.id,
      context.sessionDigest,
    );
    await this.#database.transaction(async (transaction) => {
      await transaction
        .delete(schema.faceSearchCandidates)
        .where(eq(schema.faceSearchCandidates.searchIntentId, intent.id));
      await transaction
        .update(schema.faceSearchIntents)
        .set({ status: "cancelled", completedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.faceSearchIntents.id, intent.id));
      if (intent.consentReceiptId !== null)
        await transaction
          .update(schema.faceConsentReceipts)
          .set({ resultCategory: "cancelled", updatedAt: new Date() })
          .where(eq(schema.faceConsentReceipts.id, intent.consentReceiptId));
    });
    await this.#deleteReference(intent);
    return { ok: true as const };
  }

  async processEvent(payload: unknown): Promise<{ ok: true }> {
    if (!boundedJson(payload)) {
      throw new AppError({
        code: "FACE_EVENT_SIGNATURE_INVALID",
        message: "事件结构无效",
        statusCode: 403,
      });
    }
    const parsed = eventSchema.safeParse(payload);
    if (
      !parsed.success ||
      parsed.data.aliyunaccountid !== this.#config.ALIYUN_ACCOUNT_ID ||
      parsed.data.data.ProjectName !== this.#config.ALIYUN_IMM_PROJECT_NAME
    ) {
      throw new AppError({
        code: "FACE_EVENT_SIGNATURE_INVALID",
        message: "事件绑定无效",
        statusCode: 403,
      });
    }
    const event = parsed.data;
    const [intent] = await this.#database
      .select({
        intent: schema.faceSearchIntents,
        datasetName: schema.albumFaceIndexes.datasetName,
      })
      .from(schema.faceSearchIntents)
      .innerJoin(
        schema.albumFaceIndexes,
        eq(schema.albumFaceIndexes.albumId, schema.faceSearchIntents.albumId),
      )
      .where(eq(schema.faceSearchIntents.providerTaskId, event.data.TaskId))
      .limit(1);
    if (intent === undefined || intent.datasetName !== event.data.DatasetName) {
      throw new AppError({
        code: "FACE_EVENT_SIGNATURE_INVALID",
        message: "事件任务绑定无效",
        statusCode: 403,
      });
    }
    const successful = event.data.Status === "Succeeded";
    const mediaIds = successful ? await this.#eventMediaIds(event.data.SimilarFaces) : [];
    const processed = await this.#database.transaction(async (transaction) => {
      const claimed = await transaction
        .insert(schema.faceIntegrationEvents)
        .values({
          eventId: event.id,
          providerTaskId: event.data.TaskId,
          processingResult: successful ? "processed" : "failed",
          errorCode: successful ? null : "provider_failed",
        })
        .onConflictDoNothing()
        .returning({ eventId: schema.faceIntegrationEvents.eventId });
      if (claimed.length === 0) return false;
      const terminalClaim = await transaction
        .update(schema.faceSearchIntents)
        .set({
          status: successful ? "completed" : "failed",
          failureCode: successful ? null : "provider_unavailable",
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.faceSearchIntents.id, intent.intent.id),
            inArray(schema.faceSearchIntents.status, ["processing", "partial"]),
            gt(schema.faceSearchIntents.resultExpiresAt, new Date()),
          ),
        )
        .returning({ id: schema.faceSearchIntents.id });
      if (terminalClaim.length === 0) {
        await transaction
          .update(schema.faceIntegrationEvents)
          .set({ processingResult: "ignored", errorCode: "task_not_active" })
          .where(eq(schema.faceIntegrationEvents.eventId, event.id));
        return true;
      }
      await this.#insertAuthorizedCandidates(
        transaction,
        intent.intent.id,
        intent.intent.albumId,
        mediaIds,
        intent.intent.resultExpiresAt,
      );
      const existingCount = await transaction
        .select({ value: count() })
        .from(schema.faceSearchCandidates)
        .where(eq(schema.faceSearchCandidates.searchIntentId, intent.intent.id));
      const hasResults = (existingCount[0]?.value ?? 0) > 0;
      await transaction
        .update(schema.faceSearchIntents)
        .set({
          status: successful || hasResults ? "completed" : "failed",
          failureCode: successful
            ? null
            : hasResults
              ? "async_search_failed"
              : "provider_unavailable",
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.faceSearchIntents.id, intent.intent.id));
      if (intent.intent.consentReceiptId !== null)
        await transaction
          .update(schema.faceConsentReceipts)
          .set({
            resultCategory:
              successful || hasResults
                ? hasResults
                  ? "completed_with_results"
                  : "completed_empty"
                : "provider_failed",
            updatedAt: new Date(),
          })
          .where(eq(schema.faceConsentReceipts.id, intent.intent.consentReceiptId));
      return true;
    });
    if (processed) await this.#deleteReference(intent.intent);
    return { ok: true };
  }

  async runMaintenance(): Promise<void> {
    if (this.#maintenanceRunning) return;
    this.#maintenanceRunning = true;
    try {
      await this.#enforceAlbumLifecycle();
      await this.#processAlbumJobs();
      await this.#reconcileMediaTasks();
      await this.#processMediaTasks();
      await this.#clusterQuietAlbums();
      await this.#cleanupExpiredSearches();
    } finally {
      this.#maintenanceRunning = false;
    }
  }

  async #authorizedSearchContext(options: {
    slug: string;
    visitorToken: string | undefined;
    ip: string;
  }) {
    const album = await this.#photoService.getAuthorizedPublicAlbum(
      options.slug,
      options.visitorToken,
      { requirePassword: true },
    );
    const index = await this.#index(album.id);
    if (!this.#config.FACE_SEARCH_GLOBAL_ENABLED || index?.enabled !== true) {
      throw new AppError({
        code: "FACE_SEARCH_DISABLED",
        message: "此相册未启用人脸检索",
        statusCode: 404,
      });
    }
    if (
      (index.indexState !== "ready" && index.indexState !== "degraded") ||
      index.datasetName === null
    ) {
      throw new AppError({
        code: "FACE_INDEX_NOT_READY",
        message: "人脸索引仍在准备中",
        statusCode: 409,
        retryable: true,
      });
    }
    const token = options.visitorToken;
    if (token === undefined) throw this.#notFound();
    const day = new Date().toISOString().slice(0, 10);
    return {
      album,
      index,
      sessionDigest: digest(this.#config.VISITOR_SESSION_SECRET, token),
      ipDigest: digest(this.#config.ANALYTICS_HMAC_SECRET, `${day}\nip\n${options.ip}`),
    };
  }

  async #ownedSearchContext(options: { slug: string; visitorToken: string | undefined }) {
    const token = options.visitorToken;
    if (token === undefined) throw this.#notFound();
    const [album] = await this.#database
      .select({ id: schema.albums.id })
      .from(schema.albums)
      .where(eq(schema.albums.slug, options.slug))
      .limit(1);
    if (album === undefined) throw this.#notFound();
    return {
      album,
      sessionDigest: digest(this.#config.VISITOR_SESSION_SECRET, token),
    };
  }

  async #ownedIntent(id: string, albumId: string, sessionDigest: string) {
    const [intent] = await this.#database
      .select()
      .from(schema.faceSearchIntents)
      .where(
        and(
          eq(schema.faceSearchIntents.id, id),
          eq(schema.faceSearchIntents.albumId, albumId),
          eq(schema.faceSearchIntents.visitorSessionDigest, sessionDigest),
        ),
      )
      .limit(1);
    if (intent === undefined) throw this.#notFound();
    return intent;
  }

  async #insertAuthorizedCandidates(
    transaction: Transaction,
    intentId: string,
    albumId: string,
    mediaIds: readonly string[],
    expiresAt: Date,
  ) {
    if (mediaIds.length === 0) return;
    const authorized = await transaction
      .select({ id: schema.media.id })
      .from(schema.media)
      .innerJoin(
        schema.mediaFaceIndexTasks,
        eq(schema.mediaFaceIndexTasks.mediaId, schema.media.id),
      )
      .where(
        and(
          eq(schema.media.albumId, albumId),
          eq(schema.media.publicationStatus, "published"),
          inArray(schema.media.id, [...new Set(mediaIds)]),
          eq(schema.mediaFaceIndexTasks.status, "indexed"),
        ),
      );
    if (authorized.length === 0) return;
    await transaction
      .insert(schema.faceSearchCandidates)
      .values(authorized.map((row) => ({ searchIntentId: intentId, mediaId: row.id, expiresAt })))
      .onConflictDoNothing();
  }

  async #eventMediaIds(
    groups: z.infer<typeof eventSchema>["data"]["SimilarFaces"],
  ): Promise<string[]> {
    const keys = groups
      .flatMap((group) => group.SimilarFaces)
      .filter((candidate) => candidate.Similarity >= this.#config.FACE_SEARCH_ASYNC_THRESHOLD)
      .flatMap((candidate) => {
        const prefix = `oss://${this.#config.ALIYUN_OSS_MEDIA_BUCKET}/`;
        return candidate.URI.startsWith(prefix) ? [candidate.URI.slice(prefix.length)] : [];
      });
    if (keys.length === 0) return [];
    const rows = await this.#database
      .select({ mediaId: schema.mediaVariants.mediaId })
      .from(schema.mediaVariants)
      .where(
        and(
          eq(schema.mediaVariants.kind, "photo_1920"),
          eq(schema.mediaVariants.verified, true),
          inArray(schema.mediaVariants.objectKey, [...new Set(keys)]),
        ),
      );
    return rows.map((row) => row.mediaId);
  }

  async #failAndDelete(
    intent: typeof schema.faceSearchIntents.$inferSelect,
    failureCode: FaceFailureCode,
  ) {
    await this.#database.transaction(async (transaction) => {
      await transaction
        .update(schema.faceSearchIntents)
        .set({ status: "failed", failureCode, completedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.faceSearchIntents.id, intent.id));
      if (intent.consentReceiptId !== null)
        await transaction
          .update(schema.faceConsentReceipts)
          .set({
            resultCategory:
              failureCode === "no_face" ||
              failureCode === "multiple_faces" ||
              failureCode === "quality_low"
                ? "reference_rejected"
                : "provider_failed",
            updatedAt: new Date(),
          })
          .where(eq(schema.faceConsentReceipts.id, intent.consentReceiptId));
    });
    await this.#deleteReference(intent);
  }

  async #deleteReference(intent: typeof schema.faceSearchIntents.$inferSelect) {
    if (intent.referenceDeletedAt !== null) return;
    try {
      await this.#references.delete(intent.objectKey);
      await this.#database
        .update(schema.faceSearchIntents)
        .set({
          referenceDeletedAt: new Date(),
          cleanupNextAttemptAt: null,
          cleanupLastErrorCode: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.faceSearchIntents.id, intent.id));
    } catch {
      await this.#database
        .update(schema.faceSearchIntents)
        .set({
          cleanupAttempts: sql`${schema.faceSearchIntents.cleanupAttempts} + 1`,
          cleanupNextAttemptAt: new Date(Date.now() + 60_000),
          cleanupLastErrorCode: "delete_failed",
          updatedAt: new Date(),
        })
        .where(eq(schema.faceSearchIntents.id, intent.id));
    }
  }

  async #expireIntent(
    intent: typeof schema.faceSearchIntents.$inferSelect,
  ): Promise<FaceSearchSafeState> {
    await this.#database.transaction(async (transaction) => {
      await transaction
        .delete(schema.faceSearchCandidates)
        .where(eq(schema.faceSearchCandidates.searchIntentId, intent.id));
      await transaction
        .update(schema.faceSearchIntents)
        .set({
          status: "expired",
          failureCode: "expired",
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.faceSearchIntents.id, intent.id));
      if (
        intent.consentReceiptId !== null &&
        !terminalStatuses.includes(intent.status as (typeof terminalStatuses)[number])
      ) {
        await transaction
          .update(schema.faceConsentReceipts)
          .set({ resultCategory: "expired", updatedAt: new Date() })
          .where(eq(schema.faceConsentReceipts.id, intent.consentReceiptId));
      }
    });
    await this.#deleteReference(intent);
    return { ...safeState(intent), status: "expired", failureCode: "expired" };
  }

  async #index(albumId: string) {
    const [row] = await this.#database
      .select()
      .from(schema.albumFaceIndexes)
      .where(eq(schema.albumFaceIndexes.albumId, albumId))
      .limit(1);
    return row ?? null;
  }

  async #configView(albumId: string): Promise<FaceConfigView> {
    const [album] = await this.#database
      .select()
      .from(schema.albums)
      .where(eq(schema.albums.id, albumId))
      .limit(1);
    if (album === undefined) throw this.#notFound();
    const index = await this.#index(albumId);
    const counts = await this.#database
      .select({ status: schema.mediaFaceIndexTasks.status, value: count() })
      .from(schema.mediaFaceIndexTasks)
      .where(eq(schema.mediaFaceIndexTasks.albumId, albumId))
      .groupBy(schema.mediaFaceIndexTasks.status);
    const byStatus = new Map(counts.map((row) => [row.status, row.value]));
    const readiness = {
      participantConsentRecordsConfirmed: index?.participantConsentRecordsConfirmed ?? false,
      guardianConsentRequirementsConfirmed: index?.guardianConsentRequirementsConfirmed ?? false,
      impactAssessmentCompleted: index?.impactAssessmentCompleted ?? false,
      providerResourcesValidated: index?.providerResourcesValidated ?? false,
      evaluationGatePassed: index?.evaluationGatePassed ?? false,
      billingAlertsConfigured: index?.billingAlertsConfigured ?? false,
      indexedFacesAuthorized: index?.indexedFacesAuthorized ?? false,
      globalFeatureEnabled: this.#config.FACE_SEARCH_GLOBAL_ENABLED,
      passwordAccess: album.access === "password",
      privacyNoticeConfigured: album.privacyNotice.trim() !== "",
      complaintContactConfigured: album.complaintContact.trim() !== "",
      noticeVersionCurrent: index?.noticeVersion === this.#config.FACE_SEARCH_NOTICE_VERSION,
      thresholdVersionQualified: this.#config.FACE_SEARCH_THRESHOLD_VERSION !== "unqualified",
    };
    return {
      albumId,
      enabled: index?.enabled ?? false,
      readyToEnable: Object.values(readiness).every(Boolean),
      noticeVersion: index?.noticeVersion ?? this.#config.FACE_SEARCH_NOTICE_VERSION,
      thresholdVersion: index?.thresholdVersion ?? this.#config.FACE_SEARCH_THRESHOLD_VERSION,
      indexState: index?.indexState ?? "disabled",
      authorizationConfirmedAt: index?.authorizationConfirmedAt?.toISOString() ?? null,
      retentionDays: index?.retentionDays ?? 30,
      readiness,
      counts: {
        pending: (byStatus.get("pending") ?? 0) + (byStatus.get("indexing") ?? 0),
        indexed: byStatus.get("indexed") ?? 0,
        failed: byStatus.get("failed") ?? 0,
        excluded: byStatus.get("excluded") ?? 0,
      },
      lastIndexedAt: index?.lastIndexedAt?.toISOString() ?? null,
      lastClusteredAt: index?.lastClusteredAt?.toISOString() ?? null,
      deletionDueAt: index?.deletionDueAt?.toISOString() ?? null,
      lastErrorCode: index?.lastErrorCode ?? null,
    };
  }

  async #cancelAlbumSearches(transaction: Transaction, albumId: string) {
    const intentIds = transaction
      .select({ id: schema.faceSearchIntents.id })
      .from(schema.faceSearchIntents)
      .where(eq(schema.faceSearchIntents.albumId, albumId));
    const receiptIds = transaction
      .select({ id: schema.faceSearchIntents.consentReceiptId })
      .from(schema.faceSearchIntents)
      .where(
        and(
          eq(schema.faceSearchIntents.albumId, albumId),
          inArray(schema.faceSearchIntents.status, ["awaiting_upload", "processing", "partial"]),
          sql`${schema.faceSearchIntents.consentReceiptId} is not null`,
        ),
      );
    await transaction
      .update(schema.faceConsentReceipts)
      .set({ resultCategory: "cancelled", updatedAt: new Date() })
      .where(inArray(schema.faceConsentReceipts.id, receiptIds));
    await transaction
      .update(schema.faceSearchIntents)
      .set({ status: "cancelled", completedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.faceSearchIntents.albumId, albumId),
          inArray(schema.faceSearchIntents.status, ["awaiting_upload", "processing", "partial"]),
        ),
      );
    await transaction
      .delete(schema.faceSearchCandidates)
      .where(inArray(schema.faceSearchCandidates.searchIntentId, intentIds));
  }

  async #cleanupAlbumReferences(albumId: string) {
    const intents = await this.#database
      .select()
      .from(schema.faceSearchIntents)
      .where(
        and(
          eq(schema.faceSearchIntents.albumId, albumId),
          isNull(schema.faceSearchIntents.referenceDeletedAt),
        ),
      );
    for (const intent of intents) await this.#deleteReference(intent);
  }

  async #enforceAlbumLifecycle() {
    const rows = await this.#database
      .select({ index: schema.albumFaceIndexes, album: schema.albums })
      .from(schema.albumFaceIndexes)
      .innerJoin(schema.albums, eq(schema.albums.id, schema.albumFaceIndexes.albumId));
    for (const { index, album } of rows) {
      if (album.access !== "password" && (index.enabled || index.datasetName !== null)) {
        await this.#database.transaction(async (transaction) => {
          await transaction
            .update(schema.albumFaceIndexes)
            .set({
              enabled: false,
              indexState: index.datasetName === null ? "disabled" : "deleting",
              indexedFacesAuthorized: false,
              authorizationConfirmedAt: null,
              updatedAt: new Date(),
            })
            .where(eq(schema.albumFaceIndexes.albumId, album.id));
          if (index.datasetName !== null) {
            await transaction
              .insert(schema.faceAlbumJobs)
              .values({ albumId: album.id, kind: "delete_dataset" })
              .onConflictDoNothing();
          }
          await this.#cancelAlbumSearches(transaction, album.id);
        });
        await this.#cleanupAlbumReferences(album.id);
      } else if (
        index.deletionDueAt !== null &&
        index.deletionDueAt <= new Date() &&
        album.state !== "live"
      ) {
        await this.#database
          .update(schema.albumFaceIndexes)
          .set({ enabled: false, indexState: "deleting", updatedAt: new Date() })
          .where(eq(schema.albumFaceIndexes.albumId, album.id));
        await this.#database
          .insert(schema.faceAlbumJobs)
          .values({ albumId: album.id, kind: "delete_dataset" })
          .onConflictDoNothing();
      } else if (
        (album.state === "ended" || album.state === "archived") &&
        index.deletionDueAt === null
      ) {
        await this.#database
          .update(schema.albumFaceIndexes)
          .set({
            deletionDueAt: new Date(Date.now() + index.retentionDays * 86_400_000),
            updatedAt: new Date(),
          })
          .where(eq(schema.albumFaceIndexes.albumId, album.id));
      } else if (album.state === "live" && index.deletionDueAt !== null) {
        await this.#database
          .update(schema.albumFaceIndexes)
          .set({ deletionDueAt: null, updatedAt: new Date() })
          .where(eq(schema.albumFaceIndexes.albumId, album.id));
      }
    }
  }

  async #processAlbumJobs() {
    const jobs = await this.#database
      .select()
      .from(schema.faceAlbumJobs)
      .where(
        and(
          inArray(schema.faceAlbumJobs.status, ["pending", "processing"]),
          lte(schema.faceAlbumJobs.nextAttemptAt, new Date()),
        ),
      )
      .orderBy(asc(schema.faceAlbumJobs.createdAt))
      .limit(10);
    for (const job of jobs) {
      const index = await this.#index(job.albumId);
      if (index?.datasetName == null) {
        if (job.kind === "delete_dataset") {
          await this.#database
            .update(schema.albumFaceIndexes)
            .set({ indexState: "disabled", lastErrorCode: null, updatedAt: new Date() })
            .where(eq(schema.albumFaceIndexes.albumId, job.albumId));
        }
        await this.#database
          .update(schema.faceAlbumJobs)
          .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.faceAlbumJobs.id, job.id));
        continue;
      }
      try {
        await this.#database
          .update(schema.faceAlbumJobs)
          .set({
            status: "processing",
            attempts: sql`${schema.faceAlbumJobs.attempts} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(schema.faceAlbumJobs.id, job.id));
        if (job.kind === "provision_dataset") {
          if (!(await this.#provider.datasetExists(index.datasetName)))
            await this.#provider.createDataset(index.datasetName);
          await this.#database
            .update(schema.albumFaceIndexes)
            .set({ indexState: "indexing", updatedAt: new Date() })
            .where(eq(schema.albumFaceIndexes.albumId, job.albumId));
        } else if (job.kind === "delete_dataset") {
          await this.#cleanupAlbumReferences(job.albumId);
          if (await this.#provider.datasetExists(index.datasetName)) {
            await this.#provider.deleteDatasetContents(index.datasetName);
            await this.#provider.deleteDataset(index.datasetName);
            if (await this.#provider.datasetExists(index.datasetName))
              throw new Error("dataset_delete_not_confirmed");
          }
          await this.#database.transaction(async (transaction) => {
            await transaction
              .delete(schema.mediaFaceIndexTasks)
              .where(
                and(
                  eq(schema.mediaFaceIndexTasks.albumId, job.albumId),
                  ne(schema.mediaFaceIndexTasks.status, "excluded"),
                ),
              );
            await transaction
              .update(schema.albumFaceIndexes)
              .set({
                datasetName: null,
                indexState: "disabled",
                deletionDueAt: null,
                lastErrorCode: null,
                updatedAt: new Date(),
              })
              .where(eq(schema.albumFaceIndexes.albumId, job.albumId));
          });
        } else if (job.providerTaskId === null) {
          const providerTaskId = await this.#provider.cluster(index.datasetName);
          await this.#database
            .update(schema.faceAlbumJobs)
            .set({
              status: "processing",
              providerTaskId,
              nextAttemptAt: new Date(Date.now() + 15_000),
              updatedAt: new Date(),
            })
            .where(eq(schema.faceAlbumJobs.id, job.id));
          continue;
        } else {
          const taskStatus = await this.#provider.taskStatus(
            job.providerTaskId,
            "FigureClustering",
          );
          if (taskStatus === "running") {
            if (job.attempts + 1 >= 40) throw new Error("clustering_confirmation_timeout");
            await this.#database
              .update(schema.faceAlbumJobs)
              .set({ nextAttemptAt: new Date(Date.now() + 15_000), updatedAt: new Date() })
              .where(eq(schema.faceAlbumJobs.id, job.id));
            continue;
          }
          if (taskStatus === "failed") throw new Error("clustering_failed");
          const [failedTasks] = await this.#database
            .select({ value: count() })
            .from(schema.mediaFaceIndexTasks)
            .where(
              and(
                eq(schema.mediaFaceIndexTasks.albumId, job.albumId),
                eq(schema.mediaFaceIndexTasks.status, "failed"),
              ),
            );
          await this.#database
            .update(schema.albumFaceIndexes)
            .set({
              lastClusteredAt: new Date(),
              indexState: (failedTasks?.value ?? 0) > 0 ? "degraded" : "ready",
              updatedAt: new Date(),
            })
            .where(eq(schema.albumFaceIndexes.albumId, job.albumId));
        }
        await this.#database
          .update(schema.faceAlbumJobs)
          .set({
            status: "completed",
            completedAt: new Date(),
            lastErrorCode: null,
            updatedAt: new Date(),
          })
          .where(eq(schema.faceAlbumJobs.id, job.id));
      } catch {
        const attempts = job.attempts + 1;
        await this.#database
          .update(schema.faceAlbumJobs)
          .set({
            status: attempts >= 5 ? "failed" : "pending",
            nextAttemptAt: new Date(Date.now() + Math.min(30 * 60_000, 2 ** attempts * 30_000)),
            lastErrorCode: "provider_unavailable",
            updatedAt: new Date(),
          })
          .where(eq(schema.faceAlbumJobs.id, job.id));
        await this.#database
          .update(schema.albumFaceIndexes)
          .set({
            indexState: attempts >= 5 ? "failed" : "degraded",
            lastErrorCode: "provider_unavailable",
            updatedAt: new Date(),
          })
          .where(eq(schema.albumFaceIndexes.albumId, job.albumId));
      }
    }
  }

  async #reconcileMediaTasks() {
    const eligible = await this.#database
      .select({ albumId: schema.media.albumId, mediaId: schema.media.id })
      .from(schema.media)
      .innerJoin(schema.albumFaceIndexes, eq(schema.albumFaceIndexes.albumId, schema.media.albumId))
      .innerJoin(
        schema.mediaVariants,
        and(
          eq(schema.mediaVariants.mediaId, schema.media.id),
          eq(schema.mediaVariants.kind, "photo_1920"),
          eq(schema.mediaVariants.verified, true),
        ),
      )
      .where(
        and(
          eq(schema.albumFaceIndexes.enabled, true),
          eq(schema.media.publicationStatus, "published"),
        ),
      );
    for (const row of eligible)
      await this.#database
        .insert(schema.mediaFaceIndexTasks)
        .values({ albumId: row.albumId, mediaId: row.mediaId })
        .onConflictDoNothing();
    await this.#database
      .update(schema.mediaFaceIndexTasks)
      .set({
        status: "deleting",
        deletionConfirmedAt: null,
        nextAttemptAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          ne(schema.mediaFaceIndexTasks.status, "excluded"),
          inArray(
            schema.mediaFaceIndexTasks.mediaId,
            this.#database
              .select({ id: schema.media.id })
              .from(schema.media)
              .where(ne(schema.media.publicationStatus, "published")),
          ),
        ),
      );
  }

  async #processMediaTasks() {
    const tasks = await this.#database
      .select({
        task: schema.mediaFaceIndexTasks,
        datasetName: schema.albumFaceIndexes.datasetName,
        indexEnabled: schema.albumFaceIndexes.enabled,
        objectKey: schema.mediaVariants.objectKey,
      })
      .from(schema.mediaFaceIndexTasks)
      .innerJoin(
        schema.albumFaceIndexes,
        eq(schema.albumFaceIndexes.albumId, schema.mediaFaceIndexTasks.albumId),
      )
      .leftJoin(
        schema.mediaVariants,
        and(
          eq(schema.mediaVariants.mediaId, schema.mediaFaceIndexTasks.mediaId),
          eq(schema.mediaVariants.kind, "photo_1920"),
          eq(schema.mediaVariants.verified, true),
        ),
      )
      .where(
        and(
          or(
            inArray(schema.mediaFaceIndexTasks.status, ["pending", "indexing", "deleting"]),
            and(
              eq(schema.mediaFaceIndexTasks.status, "excluded"),
              isNull(schema.mediaFaceIndexTasks.deletionConfirmedAt),
            ),
          ),
          lte(schema.mediaFaceIndexTasks.nextAttemptAt, new Date()),
        ),
      )
      .limit(25);
    for (const row of tasks) {
      if (row.datasetName === null || row.objectKey === null) continue;
      const uri = `oss://${this.#config.ALIYUN_OSS_MEDIA_BUCKET}/${row.objectKey}`;
      const deletionTask =
        !row.indexEnabled || row.task.status === "deleting" || row.task.status === "excluded";
      let indexedNow = false;
      try {
        if (!deletionTask && row.task.status === "pending") {
          const providerTaskId = await this.#provider.indexMedia({
            datasetName: row.datasetName,
            mediaId: row.task.mediaId,
            uri,
          });
          await this.#database
            .update(schema.mediaFaceIndexTasks)
            .set({
              status: "indexing",
              providerTaskId,
              attempts: sql`${schema.mediaFaceIndexTasks.attempts} + 1`,
              nextAttemptAt: new Date(Date.now() + 15_000),
              updatedAt: new Date(),
            })
            .where(eq(schema.mediaFaceIndexTasks.id, row.task.id));
        } else if (!deletionTask && row.task.status === "indexing") {
          if (await this.#provider.mediaIndexed(row.datasetName, row.task.mediaId)) {
            indexedNow = true;
            await this.#database
              .update(schema.mediaFaceIndexTasks)
              .set({
                status: "indexed",
                attempts: row.task.attempts + 1,
                lastErrorCode: null,
                updatedAt: new Date(),
              })
              .where(eq(schema.mediaFaceIndexTasks.id, row.task.id));
          } else {
            const attempts = row.task.attempts + 1;
            await this.#database
              .update(schema.mediaFaceIndexTasks)
              .set({
                status: attempts >= 20 ? "failed" : "indexing",
                attempts,
                nextAttemptAt: new Date(Date.now() + 15_000),
                lastErrorCode: attempts >= 20 ? "index_confirmation_timeout" : null,
                updatedAt: new Date(),
              })
              .where(eq(schema.mediaFaceIndexTasks.id, row.task.id));
            if (attempts >= 20) {
              await this.#database
                .update(schema.albumFaceIndexes)
                .set({
                  indexState: "degraded",
                  lastErrorCode: "index_confirmation_timeout",
                  updatedAt: new Date(),
                })
                .where(eq(schema.albumFaceIndexes.albumId, row.task.albumId));
            }
          }
        } else {
          await this.#provider.deleteMedia(row.datasetName, [uri]);
          if (await this.#provider.mediaIndexed(row.datasetName, row.task.mediaId))
            throw new Error("media_delete_not_confirmed");
          if (row.task.status === "excluded")
            await this.#database
              .update(schema.mediaFaceIndexTasks)
              .set({ deletionConfirmedAt: new Date(), lastErrorCode: null, updatedAt: new Date() })
              .where(eq(schema.mediaFaceIndexTasks.id, row.task.id));
          else
            await this.#database
              .delete(schema.mediaFaceIndexTasks)
              .where(eq(schema.mediaFaceIndexTasks.id, row.task.id));
        }
        if (indexedNow) {
          await this.#database
            .update(schema.albumFaceIndexes)
            .set({ lastIndexedAt: new Date(), updatedAt: new Date() })
            .where(eq(schema.albumFaceIndexes.albumId, row.task.albumId));
        }
      } catch {
        const attempts = row.task.attempts + 1;
        await this.#database
          .update(schema.mediaFaceIndexTasks)
          .set({
            status:
              row.task.status === "excluded"
                ? "excluded"
                : deletionTask
                  ? "deleting"
                  : attempts >= 5
                    ? "failed"
                    : row.task.status,
            attempts,
            nextAttemptAt: new Date(Date.now() + Math.min(30 * 60_000, 2 ** attempts * 30_000)),
            lastErrorCode: "provider_unavailable",
            updatedAt: new Date(),
          })
          .where(eq(schema.mediaFaceIndexTasks.id, row.task.id));
        await this.#database
          .update(schema.albumFaceIndexes)
          .set({
            indexState: "degraded",
            lastErrorCode: "provider_unavailable",
            updatedAt: new Date(),
          })
          .where(eq(schema.albumFaceIndexes.albumId, row.task.albumId));
      }
    }
  }

  async #clusterQuietAlbums() {
    const indexes = await this.#database
      .select()
      .from(schema.albumFaceIndexes)
      .where(
        and(
          eq(schema.albumFaceIndexes.enabled, true),
          inArray(schema.albumFaceIndexes.indexState, ["indexing", "ready", "degraded"]),
        ),
      );
    for (const index of indexes) {
      const [pending] = await this.#database
        .select({ value: count() })
        .from(schema.mediaFaceIndexTasks)
        .where(
          and(
            eq(schema.mediaFaceIndexTasks.albumId, index.albumId),
            inArray(schema.mediaFaceIndexTasks.status, ["pending", "indexing"]),
          ),
        );
      if (
        (pending?.value ?? 0) > 0 ||
        index.lastIndexedAt === null ||
        (index.lastClusteredAt !== null && index.lastIndexedAt <= index.lastClusteredAt) ||
        (index.lastIndexedAt !== null && Date.now() - index.lastIndexedAt.getTime() < 10_000) ||
        (index.lastClusteredAt !== null &&
          Date.now() - index.lastClusteredAt.getTime() < 5 * 60_000)
      )
        continue;
      await this.#database
        .insert(schema.faceAlbumJobs)
        .values({ albumId: index.albumId, kind: "cluster" })
        .onConflictDoNothing();
    }
  }

  async #cleanupExpiredSearches() {
    const now = new Date();
    const intents = await this.#database
      .select()
      .from(schema.faceSearchIntents)
      .where(
        or(
          and(
            ne(schema.faceSearchIntents.status, "expired"),
            lte(schema.faceSearchIntents.resultExpiresAt, now),
          ),
          and(
            isNull(schema.faceSearchIntents.referenceDeletedAt),
            or(
              lte(schema.faceSearchIntents.referenceExpiresAt, now),
              lte(schema.faceSearchIntents.cleanupNextAttemptAt, now),
            ),
          ),
        ),
      )
      .limit(100);
    for (const intent of intents) {
      if (intent.resultExpiresAt <= now && intent.status !== "expired")
        await this.#expireIntent(intent);
      else await this.#deleteReference(intent);
    }
    await this.#database
      .delete(schema.faceSearchCandidates)
      .where(lte(schema.faceSearchCandidates.expiresAt, now));
    const historyCutoff = new Date(now.getTime() - 26 * 60 * 60_000);
    await this.#database
      .delete(schema.faceSearchIntents)
      .where(
        and(
          lt(schema.faceSearchIntents.createdAt, historyCutoff),
          sql`${schema.faceSearchIntents.referenceDeletedAt} is not null`,
        ),
      );
    await this.#database
      .delete(schema.faceIntegrationEvents)
      .where(lt(schema.faceIntegrationEvents.processedAt, historyCutoff));
  }

  #notFound() {
    return new AppError({ code: "NOT_FOUND", message: "资源不存在", statusCode: 404 });
  }
}

function gtNow(column: typeof schema.faceSearchCandidates.expiresAt) {
  return sql`${column} > now()`;
}
