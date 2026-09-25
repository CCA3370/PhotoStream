import { createHash, createHmac } from "node:crypto";

import {
  type AlbumDeletionErrorList,
  type DeletionTaskView,
  type DownloadKind,
  hasPermission,
  type MediaBatchRequest,
  type MediaBatchResult,
  type UserRole,
} from "@photostream/contracts";
import type { Database } from "@photostream/db";
import { schema } from "@photostream/db";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { safeEqual } from "../auth/crypto.js";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import {
  findOperationRequest,
  lockOperationRequest,
  operationRequestHash,
  saveOperationRequest,
} from "../idempotency.js";
import type { CdnInvalidator } from "./cdn-invalidator.js";
import { LocalCdnInvalidator } from "./cdn-invalidator.js";
import { liveEventChannel } from "./live-event-broker.js";
import { ObjectStorageProviderError, type ObjectStorage } from "./object-storage.js";
import type { InternalActor } from "./service.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type AlbumDeletionErrorSource = "object_storage" | "cdn";

class AlbumCdnCleanupError extends Error {
  readonly operation: string;
  readonly providerError: unknown;

  constructor(operation: string, providerError: unknown) {
    super(providerError instanceof Error ? providerError.message : String(providerError));
    this.name = "AlbumCdnCleanupError";
    this.operation = operation;
    this.providerError = providerError;
  }
}

interface ProviderErrorFields {
  readonly code?: unknown;
  readonly requestId?: unknown;
  readonly requestid?: unknown;
  readonly status?: unknown;
  readonly statusCode?: unknown;
  readonly hostId?: unknown;
  readonly name?: unknown;
  readonly stack?: unknown;
}

function providerErrorFields(error: unknown): ProviderErrorFields {
  return typeof error === "object" && error !== null ? (error as ProviderErrorFields) : {};
}

function stringField(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.length > 0 ? value.slice(0, maxLength) : null;
}

function numberField(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

const recentAuthenticationMs = 15 * 60 * 1_000;
const analyticsRetentionMs = 30 * 24 * 60 * 60 * 1_000;
const operationRetentionMs = 30 * 24 * 60 * 60 * 1_000;
const presignedUploadDeletionGraceMs = 20 * 60 * 1_000;
const presignedFaceReferenceDeletionGraceMs = 20 * 60 * 1_000;

function requirePermission(role: UserRole, permission: Parameters<typeof hasPermission>[1]): void {
  if (!hasPermission(role, permission)) {
    throw new AppError({ code: "FORBIDDEN", message: "当前角色无权执行此操作", statusCode: 403 });
  }
}

function requireIdempotency(value: string | undefined): string {
  if (value === undefined || value.length < 16 || value.length > 128) {
    throw new AppError({ code: "BAD_REQUEST", message: "缺少有效幂等键", statusCode: 400 });
  }
  return value;
}

function assertRecentAuthentication(authenticatedAt: Date, now: Date): void {
  if (now.getTime() - authenticatedAt.getTime() > recentAuthenticationMs) {
    throw new AppError({
      code: "RECENT_AUTH_REQUIRED",
      message: "该高风险操作需要重新登录后执行",
      statusCode: 403,
    });
  }
}

function taskView(task: typeof schema.deletionTasks.$inferSelect): DeletionTaskView {
  return {
    id: task.id,
    mediaId: task.mediaId,
    status: task.status,
    attempts: task.attempts,
    lastErrorCode: task.lastErrorCode,
    nextAttemptAt: task.nextAttemptAt.toISOString(),
    completedAt: task.completedAt?.toISOString() ?? null,
  };
}

function safeFilenamePart(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 60);
  return normalized || "album";
}

export class OperationsService {
  readonly #database: Database;
  readonly #storage: ObjectStorage;
  readonly #cdn: CdnInvalidator;
  readonly #config: AppConfig;

  constructor(options: {
    readonly database: Database;
    readonly storage: ObjectStorage;
    readonly config: AppConfig;
    readonly cdnInvalidator?: CdnInvalidator;
  }) {
    this.#database = options.database;
    this.#storage = options.storage;
    this.#config = options.config;
    this.#cdn = options.cdnInvalidator ?? new LocalCdnInvalidator();
  }

  async deleteAlbum(options: {
    readonly actor: InternalActor & { authenticatedAt: Date };
    readonly albumId: string;
    readonly confirmation: string;
    readonly purgeFaceData?: () => Promise<void>;
  }): Promise<void> {
    requirePermission(options.actor.role, "album:configure");
    assertRecentAuthentication(options.actor.authenticatedAt, new Date());

    const albumPrefix = `media/albums/${options.albumId}/`;
    await this.#database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`album-state:${options.albumId}`}, 0))`,
      );
      const [album] = await transaction
        .select({
          id: schema.albums.id,
          title: schema.albums.title,
          state: schema.albums.state,
          updatedAt: schema.albums.updatedAt,
        })
        .from(schema.albums)
        .where(eq(schema.albums.id, options.albumId))
        .limit(1);
      if (album === undefined) {
        throw new AppError({ code: "NOT_FOUND", message: "活动不存在", statusCode: 404 });
      }
      if (!safeEqual(options.confirmation, album.title)) {
        throw new AppError({
          code: "BAD_REQUEST",
          message: "请输入完整活动标题以确认删除",
          statusCode: 400,
        });
      }

      const now = new Date();
      const deletingSince = album.state === "deleting" ? album.updatedAt : now;
      if (album.state !== "deleting") {
        await transaction
          .update(schema.albums)
          .set({
            state: "deleting",
            accessVersion: sql`${schema.albums.accessVersion} + 1`,
            updatedAt: deletingSince,
          })
          .where(eq(schema.albums.id, options.albumId));
      }
      await transaction.execute(sql`
        update upload_intents
        set status = 'cancelled', updated_at = ${now}
        where status = 'active'
          and media_id in (
            select id from media where album_id = ${options.albumId}
          )
      `);
      const executeAfter = new Date(deletingSince.getTime() + presignedUploadDeletionGraceMs);
      if (executeAfter > now) {
        await transaction
          .insert(schema.albumObjectDeletionSweeps)
          .values({
            albumId: options.albumId,
            objectPrefix: albumPrefix,
            executeAfter,
            attempts: 0,
            lastErrorCode: null,
            updatedAt: now,
          })
          .onConflictDoNothing();
      }
    });

    try {
      await this.#continueAlbumDeletion(options.albumId, options.purgeFaceData);
    } catch {
      // The album is already quiesced and has a durable recovery gate.
      // External cleanup continues from the deletion maintenance loop.
    }
  }

  async retryAlbumDeletion(options: {
    readonly actor: InternalActor;
    readonly albumId: string;
    readonly retryFaceData?: (deletingSince: Date, now: Date) => Promise<void>;
    readonly now?: Date;
  }): Promise<void> {
    requirePermission(options.actor.role, "album:configure");
    const now = options.now ?? new Date();
    const [album] = await this.#database
      .select({ state: schema.albums.state, deletingSince: schema.albums.updatedAt })
      .from(schema.albums)
      .where(eq(schema.albums.id, options.albumId))
      .limit(1);
    if (album === undefined) {
      throw new AppError({ code: "NOT_FOUND", message: "活动不存在", statusCode: 404 });
    }
    if (album.state !== "deleting") {
      throw new AppError({
        code: "STATE_CONFLICT",
        message: "该活动当前不在删除流程中",
        statusCode: 409,
      });
    }

    await this.#ensureAlbumDeletionRecoveryGate(options.albumId, album.deletingSince, now);
    const graceEndsAt = new Date(album.deletingSince.getTime() + presignedUploadDeletionGraceMs);
    const [sweep] = await this.#database
      .select({ albumId: schema.albumObjectDeletionSweeps.albumId })
      .from(schema.albumObjectDeletionSweeps)
      .where(eq(schema.albumObjectDeletionSweeps.albumId, options.albumId))
      .limit(1);
    if (sweep !== undefined && now >= graceEndsAt) {
      await this.#database
        .update(schema.albumObjectDeletionSweeps)
        .set({ executeAfter: now, updatedAt: now })
        .where(eq(schema.albumObjectDeletionSweeps.albumId, options.albumId));
    }

    let objectCleanupComplete = false;
    try {
      await this.#purgeAlbumObjects(options.albumId);
      objectCleanupComplete = true;
      if (now >= graceEndsAt) {
        await this.#database
          .delete(schema.albumObjectDeletionSweeps)
          .where(eq(schema.albumObjectDeletionSweeps.albumId, options.albumId));
      } else {
        await this.#database
          .update(schema.albumObjectDeletionSweeps)
          .set({ lastErrorCode: null, executeAfter: graceEndsAt, updatedAt: now })
          .where(eq(schema.albumObjectDeletionSweeps.albumId, options.albumId));
      }
    } catch (error) {
      await this.#recordAlbumObjectDeletionFailure(options.albumId, error, now);
    }

    let faceCleanupComplete = options.retryFaceData === undefined;
    if (options.retryFaceData !== undefined) {
      try {
        await options.retryFaceData(album.deletingSince, now);
        faceCleanupComplete = true;
      } catch {
        faceCleanupComplete = false;
      }
    }

    if (objectCleanupComplete && faceCleanupComplete && now >= graceEndsAt) {
      await this.#finalizeAlbumDeletionIfReady(options.albumId);
    }
  }

  async listAlbumDeletionErrors(
    actor: InternalActor,
    albumId: string,
  ): Promise<AlbumDeletionErrorList> {
    requirePermission(actor.role, "album:configure");
    const [album] = await this.#database
      .select({ state: schema.albums.state, deletingSince: schema.albums.updatedAt })
      .from(schema.albums)
      .where(eq(schema.albums.id, albumId))
      .limit(1);
    if (album === undefined) {
      throw new AppError({ code: "NOT_FOUND", message: "活动不存在", statusCode: 404 });
    }
    if (album.state !== "deleting") {
      throw new AppError({
        code: "STATE_CONFLICT",
        message: "该活动当前不在删除流程中",
        statusCode: 409,
      });
    }

    const [cleanupErrors, faceDiagnostics] = await Promise.all([
      this.#database
        .select()
        .from(schema.albumDeletionErrors)
        .where(eq(schema.albumDeletionErrors.albumId, albumId))
        .orderBy(desc(schema.albumDeletionErrors.occurredAt)),
      this.#database
        .select()
        .from(schema.faceOperationDiagnostics)
        .where(
          and(
            eq(schema.faceOperationDiagnostics.albumId, albumId),
            gt(schema.faceOperationDiagnostics.occurredAt, album.deletingSince),
          ),
        )
        .orderBy(asc(schema.faceOperationDiagnostics.occurredAt)),
    ]);

    const faceAttempts = new Map<string, number>();
    const faceErrors = faceDiagnostics.map((diagnostic) => {
      const key = `${diagnostic.source}:${diagnostic.operation}`;
      const attempt = (faceAttempts.get(key) ?? 0) + 1;
      faceAttempts.set(key, attempt);
      return {
        id: diagnostic.id,
        source:
          diagnostic.source === "aliyun_oss"
            ? ("face_reference" as const)
            : ("face_provider" as const),
        stage: "face_cleanup" as const,
        operation: diagnostic.operation,
        code: diagnostic.providerCode,
        message: diagnostic.providerMessage,
        providerRequestId: diagnostic.providerRequestId,
        httpStatus: diagnostic.httpStatus,
        attempt,
        details: {
          diagnosticSource: diagnostic.source,
          region: diagnostic.region,
          endpoint: diagnostic.endpoint,
          projectName: diagnostic.projectName,
          datasetName: diagnostic.datasetName,
          context: diagnostic.context,
        },
        occurredAt: diagnostic.occurredAt.toISOString(),
      };
    });

    return {
      items: [
        ...cleanupErrors.map((error) => ({
          id: error.id,
          source: error.source as "object_storage" | "cdn",
          stage: "object_cleanup" as const,
          operation: error.operation,
          code: error.code,
          message: error.message,
          providerRequestId: error.providerRequestId,
          httpStatus: error.httpStatus,
          attempt: error.attempt,
          details: error.details,
          occurredAt: error.occurredAt.toISOString(),
        })),
        ...faceErrors,
      ].sort(
        (left, right) =>
          new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime(),
      ),
    };
  }

  async hideMedia(options: {
    readonly actor: InternalActor;
    readonly mediaId: string;
    readonly requestId: string;
    readonly idempotencyKey: string | undefined;
  }): Promise<void> {
    requirePermission(options.actor.role, "media:manage");
    const idempotencyKey = requireIdempotency(options.idempotencyKey);
    await this.#database.transaction(async (transaction) => {
      const actorScope = `user:${options.actor.id}`;
      const operation = `media.hide:${options.mediaId}`;
      const requestHash = operationRequestHash({ mediaId: options.mediaId });
      await lockOperationRequest(transaction, { actorScope, operation, idempotencyKey });
      if (
        (await findOperationRequest(transaction, {
          actorScope,
          operation,
          idempotencyKey,
          requestHash,
        })) !== null
      ) {
        return;
      }
      const media = await this.#lockedMedia(transaction, options.mediaId);
      if (media.publicationStatus !== "hidden") {
        if (
          media.publicationStatus !== "published" &&
          media.publicationStatus !== "pending_review"
        ) {
          throw this.#stateConflict("该媒体当前不能隐藏");
        }
        await this.#hideInTransaction(transaction, media, options.actor.id, options.requestId);
      }
      await saveOperationRequest(transaction, {
        actorScope,
        operation,
        idempotencyKey,
        requestHash,
        result: { mediaId: options.mediaId },
      });
    });
  }

  async restoreMedia(options: {
    readonly actor: InternalActor;
    readonly mediaId: string;
    readonly requestId: string;
    readonly idempotencyKey: string | undefined;
  }): Promise<void> {
    requirePermission(options.actor.role, "media:manage");
    const idempotencyKey = requireIdempotency(options.idempotencyKey);
    await this.#database.transaction(async (transaction) => {
      const actorScope = `user:${options.actor.id}`;
      const operation = `media.restore:${options.mediaId}`;
      const requestHash = operationRequestHash({ mediaId: options.mediaId });
      await lockOperationRequest(transaction, { actorScope, operation, idempotencyKey });
      if (
        (await findOperationRequest(transaction, {
          actorScope,
          operation,
          idempotencyKey,
          requestHash,
        })) !== null
      ) {
        return;
      }
      const media = await this.#lockedMedia(transaction, options.mediaId);
      if (media.publicationStatus !== "published") {
        if (media.publicationStatus !== "hidden") throw this.#stateConflict("该媒体当前不能恢复");
        await this.#restoreInTransaction(transaction, media, options.actor.id, options.requestId);
      }
      await saveOperationRequest(transaction, {
        actorScope,
        operation,
        idempotencyKey,
        requestHash,
        result: { mediaId: options.mediaId },
      });
    });
  }

  async changeMediaCategory(options: {
    readonly actor: InternalActor;
    readonly mediaId: string;
    readonly categoryId: string | null;
    readonly requestId: string;
  }): Promise<void> {
    requirePermission(options.actor.role, "media:manage");
    await this.#database.transaction(async (transaction) => {
      const media = await this.#lockedMedia(transaction, options.mediaId);
      if (media.publicationStatus === "deleted") throw this.#stateConflict("已删除媒体不能改分类");
      if (options.categoryId !== null) {
        const [category] = await transaction
          .select({ id: schema.categories.id })
          .from(schema.categories)
          .where(
            and(
              eq(schema.categories.id, options.categoryId),
              eq(schema.categories.albumId, media.albumId),
              eq(schema.categories.enabled, true),
            ),
          )
          .limit(1);
        if (category === undefined) {
          throw new AppError({ code: "BAD_REQUEST", message: "分类无效", statusCode: 400 });
        }
      }
      const now = new Date();
      await transaction
        .update(schema.media)
        .set({ categoryId: options.categoryId, updatedAt: now })
        .where(eq(schema.media.id, media.id));
      if (media.publicationStatus === "published") {
        await this.#event(transaction, media.albumId, media.id, "media.updated");
      }
      await this.#audit(transaction, {
        actorId: options.actor.id,
        action: "media.category.changed",
        targetId: media.id,
        changedFields: ["categoryId"],
        requestId: options.requestId,
      });
    });
  }

  async applyBatch(options: {
    readonly actor: InternalActor;
    readonly input: MediaBatchRequest;
    readonly idempotencyKey: string | undefined;
    readonly requestId: string;
  }): Promise<MediaBatchResult> {
    requirePermission(options.actor.role, "media:manage");
    const idempotencyKey = requireIdempotency(options.idempotencyKey);
    const requestHash = createHash("sha256").update(JSON.stringify(options.input)).digest("hex");
    return this.#database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`media-batch:${options.actor.id}:${idempotencyKey}`}, 0))`,
      );
      const [existing] = await transaction
        .select()
        .from(schema.mediaBatchRequests)
        .where(
          and(
            eq(schema.mediaBatchRequests.actorUserId, options.actor.id),
            eq(schema.mediaBatchRequests.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (existing !== undefined) {
        if (existing.requestHash !== requestHash) {
          throw new AppError({
            code: "IDEMPOTENCY_CONFLICT",
            message: "同一幂等键不能用于不同批量请求",
            statusCode: 409,
          });
        }
        const stored = existing.result as MediaBatchResult;
        const storedByMediaId = new Map(stored.items.map((item) => [item.mediaId, item]));
        return {
          items: options.input.mediaIds.map(
            (mediaId) =>
              storedByMediaId.get(mediaId) ??
              this.#batchFailure(mediaId, "MEDIA_NOT_FOUND", "媒体不存在"),
          ),
        };
      }
      const items: MediaBatchResult["items"] = [];
      for (const mediaId of options.input.mediaIds) {
        items.push(
          await this.#applyBatchItem({
            transaction,
            actor: options.actor,
            input: options.input,
            mediaId,
            requestId: options.requestId,
          }),
        );
      }
      const result: MediaBatchResult = { items };
      const persistedResult: MediaBatchResult = {
        items: result.items.filter((item) => item.code !== "MEDIA_NOT_FOUND"),
      };
      await transaction.insert(schema.mediaBatchRequests).values({
        actorUserId: options.actor.id,
        idempotencyKey,
        requestHash,
        result: persistedResult,
      });
      return result;
    });
  }

  async requestDeletion(options: {
    readonly actor: InternalActor & { readonly authenticatedAt: Date };
    readonly mediaId: string;
    readonly confirmation: string;
    readonly requestId: string;
    readonly now?: Date;
  }): Promise<DeletionTaskView> {
    requirePermission(options.actor.role, "media:delete");
    const now = options.now ?? new Date();
    assertRecentAuthentication(options.actor.authenticatedAt, now);
    const taskId = await this.#database.transaction(async (transaction) => {
      const media = await this.#lockedMedia(transaction, options.mediaId);
      const [album] = await transaction
        .select()
        .from(schema.albums)
        .where(eq(schema.albums.id, media.albumId))
        .limit(1);
      if (album === undefined) throw new Error("Media album disappeared");
      if (options.confirmation.trim() !== album.title) {
        throw new AppError({ code: "BAD_REQUEST", message: "相册标题确认不匹配", statusCode: 400 });
      }
      const [existing] = await transaction
        .select()
        .from(schema.deletionTasks)
        .where(eq(schema.deletionTasks.mediaId, media.id))
        .limit(1);
      if (existing !== undefined) return existing.id;
      if (media.publicationStatus === "deleted") throw this.#stateConflict("媒体已经删除");
      if (media.publicationStatus !== "hidden") {
        await this.#hideInTransaction(transaction, media, options.actor.id, options.requestId);
      }
      await transaction
        .update(schema.mediaFaceIndexTasks)
        .set({
          status: "deleting",
          deletionConfirmedAt: null,
          nextAttemptAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.mediaFaceIndexTasks.mediaId, media.id),
            ne(schema.mediaFaceIndexTasks.status, "excluded"),
          ),
        );
      const [task] = await transaction
        .insert(schema.deletionTasks)
        .values({
          mediaId: media.id,
          requestedBy: options.actor.id,
          status: "pending",
          nextAttemptAt: now,
          requestId: options.requestId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (task === undefined) throw new Error("Deletion task insert returned no row");
      const variants = await transaction
        .select()
        .from(schema.mediaVariants)
        .where(eq(schema.mediaVariants.mediaId, media.id));
      if (variants.length > 0) {
        await transaction.insert(schema.deletionTaskObjects).values(
          variants.map((variant) => ({
            taskId: task.id,
            variantKind: variant.kind,
            objectKey: variant.objectKey,
          })),
        );
      }
      await this.#audit(transaction, {
        actorId: options.actor.id,
        action: "media.deletion.requested",
        targetId: media.id,
        changedFields: ["publicationStatus", "deletionTask", "faceIndexTask"],
        requestId: options.requestId,
      });
      return task.id;
    });
    await this.processDeletionTask(taskId, now);
    return this.getDeletionTask(options.actor, taskId);
  }

  async getDeletionTask(actor: InternalActor, taskId: string): Promise<DeletionTaskView> {
    requirePermission(actor.role, "media:manage");
    const [task] = await this.#database
      .select()
      .from(schema.deletionTasks)
      .where(eq(schema.deletionTasks.id, taskId))
      .limit(1);
    if (task === undefined) {
      throw new AppError({ code: "NOT_FOUND", message: "删除任务不存在", statusCode: 404 });
    }
    return taskView(task);
  }

  async retryDeletion(options: {
    readonly actor: InternalActor;
    readonly taskId: string;
    readonly now?: Date;
  }): Promise<DeletionTaskView> {
    requirePermission(options.actor.role, "media:delete");
    const now = options.now ?? new Date();
    await this.#database
      .update(schema.deletionTasks)
      .set({ status: "pending", nextAttemptAt: now, updatedAt: now })
      .where(
        and(eq(schema.deletionTasks.id, options.taskId), eq(schema.deletionTasks.status, "failed")),
      );
    await this.processDeletionTask(options.taskId, now);
    return this.getDeletionTask(options.actor, options.taskId);
  }

  async processPendingAlbumDeletions(
    purgeFaceData?: (albumId: string) => Promise<void>,
    limit = 10,
    now = new Date(),
  ): Promise<number> {
    const albums = await this.#database
      .select({ id: schema.albums.id, deletingSince: schema.albums.updatedAt })
      .from(schema.albums)
      .where(eq(schema.albums.state, "deleting"))
      .orderBy(asc(schema.albums.updatedAt))
      .limit(limit);
    const failures: unknown[] = [];
    for (const album of albums) {
      try {
        await this.#ensureAlbumDeletionRecoveryGate(album.id, album.deletingSince, now);
        await this.#ensureAlbumFacePurged(
          album.id,
          purgeFaceData === undefined ? undefined : () => purgeFaceData(album.id),
        );
        const [pendingSweep] = await this.#database
          .select({ albumId: schema.albumObjectDeletionSweeps.albumId })
          .from(schema.albumObjectDeletionSweeps)
          .where(eq(schema.albumObjectDeletionSweeps.albumId, album.id))
          .limit(1);
        if (pendingSweep === undefined) {
          try {
            await this.#purgeAlbumObjects(album.id);
          } catch (error) {
            await this.#recordAlbumObjectDeletionFailure(album.id, error, now);
            throw error;
          }
          await this.#finalizeAlbumDeletionIfReady(album.id);
        }
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, "One or more album deletions could not advance");
    }
    return albums.length;
  }

  async processPendingAlbumObjectDeletionSweeps(limit = 10, now = new Date()): Promise<number> {
    const sweeps = await this.#database
      .select()
      .from(schema.albumObjectDeletionSweeps)
      .where(lte(schema.albumObjectDeletionSweeps.executeAfter, now))
      .orderBy(asc(schema.albumObjectDeletionSweeps.executeAfter))
      .limit(limit);
    for (const sweep of sweeps) {
      try {
        await this.#purgeAlbumObjects(sweep.albumId);
        await this.#database
          .delete(schema.albumObjectDeletionSweeps)
          .where(eq(schema.albumObjectDeletionSweeps.albumId, sweep.albumId));
      } catch (error) {
        await this.#recordAlbumObjectDeletionFailure(sweep.albumId, error, now);
      }
    }
    return sweeps.length;
  }

  async processPendingDeletionTasks(limit = 10, now = new Date()): Promise<number> {
    const tasks = await this.#database
      .select({ id: schema.deletionTasks.id })
      .from(schema.deletionTasks)
      .where(
        and(
          inArray(schema.deletionTasks.status, ["pending", "failed", "processing"]),
          lte(schema.deletionTasks.nextAttemptAt, now),
        ),
      )
      .orderBy(asc(schema.deletionTasks.nextAttemptAt), asc(schema.deletionTasks.id))
      .limit(limit);
    for (const task of tasks) await this.processDeletionTask(task.id, now);
    return tasks.length;
  }

  async processDeletionTask(taskId: string, now = new Date()): Promise<void> {
    const claimed = await this.#database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`delete-task:${taskId}`}, 0))`,
      );
      const [task] = await transaction
        .select()
        .from(schema.deletionTasks)
        .where(eq(schema.deletionTasks.id, taskId))
        .limit(1);
      if (
        task === undefined ||
        task.status === "completed" ||
        (task.status === "processing" && task.nextAttemptAt > now) ||
        ((task.status === "pending" || task.status === "failed") && task.nextAttemptAt > now)
      ) {
        return null;
      }
      const [updated] = await transaction
        .update(schema.deletionTasks)
        .set({
          status: "processing",
          attempts: task.attempts + 1,
          lastErrorCode: null,
          nextAttemptAt: new Date(now.getTime() + 5 * 60 * 1_000),
          updatedAt: now,
        })
        .where(eq(schema.deletionTasks.id, task.id))
        .returning();
      return updated ?? null;
    });
    if (claimed === null) return;
    const [faceTask] = await this.#database
      .select({
        status: schema.mediaFaceIndexTasks.status,
        deletionConfirmedAt: schema.mediaFaceIndexTasks.deletionConfirmedAt,
      })
      .from(schema.mediaFaceIndexTasks)
      .where(eq(schema.mediaFaceIndexTasks.mediaId, claimed.mediaId))
      .limit(1);
    if (
      faceTask !== undefined &&
      !(faceTask.status === "excluded" && faceTask.deletionConfirmedAt !== null)
    ) {
      await this.#database
        .update(schema.deletionTasks)
        .set({
          status: "pending",
          lastErrorCode: null,
          nextAttemptAt: new Date(now.getTime() + 30_000),
          updatedAt: now,
        })
        .where(eq(schema.deletionTasks.id, claimed.id));
      return;
    }
    const editObjects = await this.#database
      .select({
        revisionId: schema.mediaEditVariants.editRevisionId,
        objectKey: schema.mediaEditVariants.objectKey,
      })
      .from(schema.mediaEditVariants)
      .innerJoin(
        schema.mediaEditRevisions,
        eq(schema.mediaEditRevisions.id, schema.mediaEditVariants.editRevisionId),
      )
      .where(eq(schema.mediaEditRevisions.mediaId, claimed.mediaId));
    let editObjectFailure = false;
    for (const object of editObjects) {
      try {
        await this.#storage.delete(object.objectKey);
      } catch {
        editObjectFailure = true;
      }
    }
    if (editObjectFailure) {
      await this.#failDeletionTask(claimed, "EDIT_OBJECT_DELETE_FAILED", now);
      return;
    }

    const objects = await this.#database
      .select()
      .from(schema.deletionTaskObjects)
      .where(
        and(
          eq(schema.deletionTaskObjects.taskId, taskId),
          inArray(schema.deletionTaskObjects.status, ["pending", "failed"]),
        ),
      )
      .orderBy(asc(schema.deletionTaskObjects.variantKind));
    let objectFailure = false;
    for (const object of objects) {
      if (object.objectKey === null) continue;
      try {
        await this.#storage.delete(object.objectKey);
        await this.#database
          .update(schema.deletionTaskObjects)
          .set({
            status: "deleted",
            attempts: object.attempts + 1,
            lastErrorCode: null,
            deletedAt: new Date(),
          })
          .where(eq(schema.deletionTaskObjects.id, object.id));
      } catch {
        objectFailure = true;
        await this.#database
          .update(schema.deletionTaskObjects)
          .set({
            status: "failed",
            attempts: object.attempts + 1,
            lastErrorCode: "OBJECT_DELETE_FAILED",
          })
          .where(eq(schema.deletionTaskObjects.id, object.id));
      }
    }
    if (objectFailure) {
      await this.#failDeletionTask(claimed, "OBJECT_DELETE_FAILED", now);
      return;
    }
    const allObjects = await this.#database
      .select()
      .from(schema.deletionTaskObjects)
      .where(eq(schema.deletionTaskObjects.taskId, taskId));
    const paths = [
      ...allObjects.flatMap((object) => (object.objectKey === null ? [] : [object.objectKey])),
      ...editObjects.map((object) => object.objectKey),
    ];
    try {
      await this.#cdn.invalidate(paths);
    } catch {
      await this.#failDeletionTask(claimed, "CDN_INVALIDATION_FAILED", now);
      return;
    }
    await this.#database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`delete-task:${taskId}`}, 0))`,
      );
      const completedAt = new Date();
      const editRevisionIds = editObjects.map((object) => object.revisionId);
      await transaction
        .delete(schema.mediaEditStates)
        .where(eq(schema.mediaEditStates.mediaId, claimed.mediaId));
      if (editRevisionIds.length > 0) {
        await transaction
          .delete(schema.mediaEditVariants)
          .where(inArray(schema.mediaEditVariants.editRevisionId, editRevisionIds));
        await transaction
          .delete(schema.mediaEditRevisions)
          .where(inArray(schema.mediaEditRevisions.id, editRevisionIds));
      }
      await transaction
        .delete(schema.mediaVariants)
        .where(eq(schema.mediaVariants.mediaId, claimed.mediaId));
      await transaction
        .delete(schema.uploadIntents)
        .where(eq(schema.uploadIntents.mediaId, claimed.mediaId));
      await transaction
        .delete(schema.operationRequests)
        .where(
          sql`${schema.operationRequests.operation} like ${`download:%:${claimed.mediaId}:%`}`,
        );
      await transaction
        .delete(schema.mediaBibTags)
        .where(eq(schema.mediaBibTags.mediaId, claimed.mediaId));
      await transaction
        .delete(schema.mediaBibReviews)
        .where(eq(schema.mediaBibReviews.mediaId, claimed.mediaId));
      await transaction
        .delete(schema.mediaFaceIndexTasks)
        .where(eq(schema.mediaFaceIndexTasks.mediaId, claimed.mediaId));
      await transaction
        .update(schema.deletionTaskObjects)
        .set({ objectKey: null })
        .where(eq(schema.deletionTaskObjects.taskId, taskId));
      await transaction
        .update(schema.media)
        .set({ publicationStatus: "deleted", updatedAt: completedAt })
        .where(eq(schema.media.id, claimed.mediaId));
      await transaction
        .update(schema.deletionTasks)
        .set({
          status: "completed",
          lastErrorCode: null,
          completedAt,
          nextAttemptAt: completedAt,
          updatedAt: completedAt,
        })
        .where(eq(schema.deletionTasks.id, taskId));
      const [media] = await transaction
        .select({ albumId: schema.media.albumId })
        .from(schema.media)
        .where(eq(schema.media.id, claimed.mediaId))
        .limit(1);
      if (media !== undefined) {
        await this.#event(transaction, media.albumId, claimed.mediaId, "media.deleted");
      }
      await this.#audit(transaction, {
        actorId: claimed.requestedBy,
        action: "media.deletion.completed",
        targetId: claimed.mediaId,
        changedFields: [
          "objects",
          "editObjects",
          "cdn",
          "bibData",
          "faceIndexTask",
          "publicationStatus",
        ],
        requestId: claimed.requestId,
      });
    });
  }

  async issueOriginalView(options: {
    readonly slug: string;
    readonly visitorToken: string | undefined;
    readonly mediaId: string;
  }) {
    return this.#issueMediaAccess({
      ...options,
      kind: "original",
      intent: "view",
      visitorId: "",
      idempotencyKey: undefined,
    });
  }

  async issueDownload(options: {
    readonly slug: string;
    readonly visitorToken: string | undefined;
    readonly mediaId: string;
    readonly kind: DownloadKind;
    readonly visitorId: string;
    readonly idempotencyKey: string | undefined;
  }) {
    return this.#issueMediaAccess({ ...options, intent: "download" });
  }

  async #issueMediaAccess(options: {
    readonly slug: string;
    readonly visitorToken: string | undefined;
    readonly mediaId: string;
    readonly kind: DownloadKind;
    readonly visitorId: string;
    readonly idempotencyKey: string | undefined;
    readonly intent: "download" | "view";
  }) {
    const album = await this.#publicAlbum(options.slug);
    if (!(await this.#authorized(album, options.visitorToken))) throw this.#publicNotFound();
    const idempotencyKey =
      options.intent === "download" ? requireIdempotency(options.idempotencyKey) : "view";
    const actorScope = `visitor:${createHmac("sha256", this.#config.ANALYTICS_HMAC_SECRET)
      .update(options.visitorId, "utf8")
      .digest("hex")}`;
    const operation = `download:${options.slug}:${options.mediaId}:${options.kind}`;
    const requestHash = operationRequestHash({
      slug: options.slug,
      mediaId: options.mediaId,
      kind: options.kind,
    });
    const [media] = await this.#database
      .select()
      .from(schema.media)
      .where(
        and(
          eq(schema.media.id, options.mediaId),
          eq(schema.media.albumId, album.id),
          eq(schema.media.publicationStatus, "published"),
        ),
      )
      .limit(1);
    if (media === undefined || media.publishSequence === null) throw this.#publicNotFound();
    const downloadSelection = {
      preview: "photo_1920",
      original: "photo_original",
    } satisfies Record<DownloadKind, (typeof schema.variantKindEnum.enumValues)[number]>;
    const variantKind = downloadSelection[options.kind];
    const [editState] = await this.#database
      .select({ activeRevisionId: schema.mediaEditStates.activeRevisionId })
      .from(schema.mediaEditStates)
      .where(eq(schema.mediaEditStates.mediaId, media.id))
      .limit(1);

    let selected:
      | {
          readonly objectKey: string;
          readonly format: string;
          readonly bytes: number;
        }
      | undefined;

    if (editState?.activeRevisionId !== null && editState?.activeRevisionId !== undefined) {
      const editKind = options.kind === "preview" ? "photo_1920" : "photo_download";
      const [editVariant] = await this.#database
        .select()
        .from(schema.mediaEditVariants)
        .where(
          and(
            eq(schema.mediaEditVariants.editRevisionId, editState.activeRevisionId),
            eq(schema.mediaEditVariants.kind, editKind),
            eq(schema.mediaEditVariants.verified, true),
            isNotNull(schema.mediaEditVariants.bytes),
          ),
        )
        .limit(1);
      if (editVariant !== undefined && editVariant.bytes !== null) {
        selected = {
          objectKey: editVariant.objectKey,
          format: editVariant.format,
          bytes: editVariant.bytes,
        };
      }
    }
    if (selected === undefined) {
      const [baseVariant] = await this.#database
        .select()
        .from(schema.mediaVariants)
        .where(
          and(
            eq(schema.mediaVariants.mediaId, media.id),
            eq(schema.mediaVariants.kind, variantKind),
            eq(schema.mediaVariants.verified, true),
            isNotNull(schema.mediaVariants.bytes),
          ),
        )
        .limit(1);
      if (baseVariant !== undefined && baseVariant.bytes !== null) {
        selected = {
          objectKey: baseVariant.objectKey,
          format: baseVariant.format,
          bytes: baseVariant.bytes,
        };
      }
    }

    if (selected === undefined) {
      throw new AppError({
        code: "DOWNLOAD_NOT_READY",
        message: "当前版本的下载文件尚未准备完成",
        statusCode: 409,
        retryable: true,
      });
    }
    const expiresAt = new Date(Date.now() + 5 * 60 * 1_000);
    const filename = `${safeFilenamePart(album.title)}-${media.id.slice(0, 8)}-${options.kind}.${selected.format === "jpeg" ? "jpg" : selected.format}`;
    const record = {
      objectKey: selected.objectKey,
      filename,
      bytes: selected.bytes,
      expiresAt: expiresAt.toISOString(),
    };
    if (options.intent === "view") {
      return {
        url: this.#storage.signRead({ key: selected.objectKey, expiresAt }),
        filename,
        bytes: selected.bytes,
        expiresAt: expiresAt.toISOString(),
      };
    }
    const retried = await this.#database.transaction(async (transaction) => {
      await lockOperationRequest(transaction, { actorScope, operation, idempotencyKey });
      return findOperationRequest(transaction, {
        actorScope,
        operation,
        idempotencyKey,
        requestHash,
      });
    });
    if (retried !== null) {
      return this.#signedDownloadFromRecord(retried);
    }
    const won = await this.#database.transaction(async (transaction) => {
      await lockOperationRequest(transaction, { actorScope, operation, idempotencyKey });
      const concurrent = await findOperationRequest(transaction, {
        actorScope,
        operation,
        idempotencyKey,
        requestHash,
      });
      if (concurrent !== null) return concurrent;
      await saveOperationRequest(transaction, {
        actorScope,
        operation,
        idempotencyKey,
        requestHash,
        result: record,
      });
      return null;
    });
    if (won !== null) return this.#signedDownloadFromRecord(won);
    await this.recordAnalytics({
      albumId: album.id,
      visitorId: options.visitorId,
      eventType: "download",
      mediaId: media.id,
      variantKind,
    });
    return {
      url: this.#storage.signRead({ key: selected.objectKey, expiresAt }),
      filename,
      bytes: selected.bytes,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async recordOpen(options: {
    readonly slug: string;
    readonly visitorToken: string | undefined;
    readonly visitorId: string;
  }): Promise<void> {
    const album = await this.#publicAlbum(options.slug);
    if (!(await this.#authorized(album, options.visitorToken))) throw this.#publicNotFound();
    await this.recordAnalytics({
      albumId: album.id,
      visitorId: options.visitorId,
      eventType: "open",
    });
  }

  async recordSession(slug: string, visitorId: string): Promise<void> {
    const album = await this.#publicAlbum(slug);
    await this.recordAnalytics({ albumId: album.id, visitorId, eventType: "session" });
  }

  async recordAnalytics(options: {
    readonly albumId: string;
    readonly visitorId: string;
    readonly eventType: "open" | "session" | "download";
    readonly mediaId?: string;
    readonly variantKind?: (typeof schema.variantKindEnum.enumValues)[number];
    readonly now?: Date;
  }): Promise<void> {
    const now = options.now ?? new Date();
    const day = now.toISOString().slice(0, 10);
    const visitorDigest = createHmac("sha256", this.#config.ANALYTICS_HMAC_SECRET)
      .update(`${day}\n${options.visitorId}`, "utf8")
      .digest("hex");
    await this.#database.transaction(async (transaction) => {
      await transaction.insert(schema.analyticsEvents).values({
        albumId: options.albumId,
        day,
        eventType: options.eventType,
        visitorDigest,
        ...(options.mediaId === undefined ? {} : { mediaId: options.mediaId }),
        ...(options.variantKind === undefined ? {} : { variantKind: options.variantKind }),
        createdAt: now,
      });
      const opens = options.eventType === "open" ? 1 : 0;
      const sessions = options.eventType === "session" ? 1 : 0;
      const downloads = options.eventType === "download" ? 1 : 0;
      await transaction
        .insert(schema.analyticsDaily)
        .values({ albumId: options.albumId, day, opens, sessions, downloads, uniqueVisitors: 0 })
        .onConflictDoUpdate({
          target: [schema.analyticsDaily.albumId, schema.analyticsDaily.day],
          set: {
            opens: sql`${schema.analyticsDaily.opens} + ${opens}`,
            sessions: sql`${schema.analyticsDaily.sessions} + ${sessions}`,
            downloads: sql`${schema.analyticsDaily.downloads} + ${downloads}`,
            updatedAt: now,
          },
        });
      await transaction
        .update(schema.analyticsDaily)
        .set({
          uniqueVisitors: sql`(select count(distinct ${schema.analyticsEvents.visitorDigest})::int from ${schema.analyticsEvents} where ${schema.analyticsEvents.albumId} = ${options.albumId} and ${schema.analyticsEvents.day} = ${day})`,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.analyticsDaily.albumId, options.albumId),
            eq(schema.analyticsDaily.day, day),
          ),
        );
    });
  }

  async cleanupAnalytics(now = new Date()): Promise<number> {
    const deleted = await this.#database
      .delete(schema.analyticsEvents)
      .where(lt(schema.analyticsEvents.createdAt, new Date(now.getTime() - analyticsRetentionMs)))
      .returning({ id: schema.analyticsEvents.id });
    return deleted.length;
  }

  async cleanupOperationalRecords(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - operationRetentionMs);
    return this.#database.transaction(async (transaction) => {
      const operationRequests = await transaction
        .delete(schema.operationRequests)
        .where(lt(schema.operationRequests.createdAt, cutoff))
        .returning({ id: schema.operationRequests.id });
      const batchRequests = await transaction
        .delete(schema.mediaBatchRequests)
        .where(lt(schema.mediaBatchRequests.createdAt, cutoff))
        .returning({ id: schema.mediaBatchRequests.id });
      const sessions = await transaction
        .delete(schema.sessions)
        .where(lt(schema.sessions.absoluteExpiresAt, now))
        .returning({ id: schema.sessions.id });
      const visitorSessions = await transaction
        .delete(schema.visitorSessions)
        .where(lt(schema.visitorSessions.expiresAt, now))
        .returning({ id: schema.visitorSessions.id });
      const liveEvents = await transaction
        .delete(schema.liveEvents)
        .where(
          and(
            lt(schema.liveEvents.createdAt, cutoff),
            sql`exists (
              select 1 from ${schema.albums}
              where ${schema.albums.id} = ${schema.liveEvents.albumId}
                and ${schema.albums.state} in ('ended', 'archived')
            )`,
          ),
        )
        .returning({ id: schema.liveEvents.id });
      return (
        operationRequests.length +
        batchRequests.length +
        sessions.length +
        visitorSessions.length +
        liveEvents.length
      );
    });
  }

  async albumStatistics(actor: InternalActor, albumId: string) {
    requirePermission(actor.role, "album:read");
    const [album] = await this.#database
      .select({ id: schema.albums.id })
      .from(schema.albums)
      .where(eq(schema.albums.id, albumId))
      .limit(1);
    if (album === undefined)
      throw new AppError({ code: "ALBUM_NOT_FOUND", message: "相册不存在", statusCode: 404 });
    const [media] = await this.#database
      .select({
        mediaCount: sql<number>`count(*)::int`,
      })
      .from(schema.media)
      .where(
        and(eq(schema.media.albumId, albumId), sql`${schema.media.publicationStatus} <> 'deleted'`),
      );
    const [storage] = await this.#database
      .select({
        logicalBytes: sql<number>`coalesce(sum(${schema.mediaVariants.bytes}), 0)::bigint`,
      })
      .from(schema.mediaVariants)
      .innerJoin(schema.media, eq(schema.mediaVariants.mediaId, schema.media.id))
      .where(
        and(
          eq(schema.media.albumId, albumId),
          eq(schema.mediaVariants.verified, true),
          sql`${schema.media.publicationStatus} <> 'deleted'`,
        ),
      );
    const daily = await this.#database
      .select()
      .from(schema.analyticsDaily)
      .where(eq(schema.analyticsDaily.albumId, albumId))
      .orderBy(asc(schema.analyticsDaily.day));
    return {
      mediaCount: media?.mediaCount ?? 0,
      logicalBytes: Number(storage?.logicalBytes ?? 0),
      opens: daily.reduce((sum, row) => sum + row.opens, 0),
      sessions: daily.reduce((sum, row) => sum + row.sessions, 0),
      downloads: daily.reduce((sum, row) => sum + row.downloads, 0),
      uniqueVisitors: daily.reduce((sum, row) => sum + row.uniqueVisitors, 0),
      daily: daily.map((row) => ({
        day: row.day,
        opens: row.opens,
        sessions: row.sessions,
        downloads: row.downloads,
        uniqueVisitors: row.uniqueVisitors,
      })),
    };
  }

  async listAudit(options: {
    readonly actor: InternalActor;
    readonly cursor: string | undefined;
    readonly limit: number;
    readonly query?: string | undefined;
    readonly result?: "success" | "failed" | undefined;
  }) {
    requirePermission(options.actor.role, "audit:read");
    const afterId = options.cursor === undefined ? null : this.#decodeAuditCursor(options.cursor);
    const query = options.query?.trim() ?? "";
    const escapedQuery = query.replace(/[\\%_]/gu, "\\$&");
    const pattern = `%${escapedQuery}%`;
    const resultCondition =
      options.result === "success"
        ? eq(schema.auditLogs.result, "success")
        : options.result === "failed"
          ? ne(schema.auditLogs.result, "success")
          : undefined;
    const queryCondition =
      query.length === 0
        ? undefined
        : or(
            ilike(schema.auditLogs.action, pattern),
            ilike(schema.auditLogs.targetType, pattern),
            sql<boolean>`${schema.auditLogs.targetId}::text ilike ${pattern}`,
            sql<boolean>`${schema.auditLogs.changedFields}::text ilike ${pattern}`,
          );
    const rows = await this.#database
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          afterId === null ? undefined : lt(schema.auditLogs.id, afterId),
          resultCondition,
          queryCondition,
        ),
      )
      .orderBy(desc(schema.auditLogs.id))
      .limit(options.limit + 1);
    const page = rows.slice(0, options.limit);
    return {
      items: page.map((row) => ({
        id: row.id,
        actorUserId: row.actorUserId,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        result: row.result,
        changedFields: [...row.changedFields],
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor:
        rows.length > options.limit && page.at(-1) !== undefined
          ? this.#encodeAuditCursor((page.at(-1) as (typeof page)[number]).id)
          : null,
    };
  }

  async #continueAlbumDeletion(
    albumId: string,
    purgeFaceData?: () => Promise<void>,
  ): Promise<void> {
    const failures: unknown[] = [];
    try {
      await this.#purgeAlbumObjects(albumId);
    } catch (error) {
      await this.#recordAlbumObjectDeletionFailure(albumId, error, new Date());
      failures.push(error);
    }
    try {
      await this.#ensureAlbumFacePurged(albumId, purgeFaceData);
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, "Initial album purge could not complete");
    }
    await this.#finalizeAlbumDeletionIfReady(albumId);
  }

  #albumObjectDeletionError(error: unknown): {
    readonly source: AlbumDeletionErrorSource;
    readonly operation: string;
    readonly code: string;
    readonly message: string;
    readonly providerRequestId: string | null;
    readonly httpStatus: number | null;
    readonly details: Record<string, unknown>;
  } {
    const wrapped =
      error instanceof ObjectStorageProviderError || error instanceof AlbumCdnCleanupError
        ? error
        : null;
    const providerError = wrapped?.providerError ?? error;
    const fields = providerErrorFields(providerError);
    const source: AlbumDeletionErrorSource =
      error instanceof AlbumCdnCleanupError ? "cdn" : "object_storage";
    const operation =
      error instanceof ObjectStorageProviderError || error instanceof AlbumCdnCleanupError
        ? error.operation
        : "AlbumObjectCleanup";
    const code =
      stringField(fields.code, 200) ??
      (providerError instanceof AppError
        ? providerError.code
        : providerError instanceof Error && providerError.name !== "Error"
          ? providerError.name
          : "OBJECT_DELETE_FAILED");
    const message =
      providerError instanceof Error ? providerError.message : String(providerError);
    const providerRequestId =
      stringField(fields.requestId, 256) ?? stringField(fields.requestid, 256);
    const httpStatus = numberField(fields.statusCode) ?? numberField(fields.status);
    const details: Record<string, unknown> = {
      errorName:
        providerError instanceof Error
          ? providerError.name
          : stringField(fields.name, 200) ?? typeof providerError,
    };
    const hostId = stringField(fields.hostId, 512);
    if (hostId !== null) details.hostId = hostId;
    if (providerError instanceof Error && providerError.stack !== undefined) {
      details.stack = providerError.stack.slice(0, 12_000);
    }
    return {
      source,
      operation,
      code: code.slice(0, 200),
      message: message.slice(0, 8_000),
      providerRequestId,
      httpStatus,
      details,
    };
  }

  async #recordAlbumObjectDeletionFailure(
    albumId: string,
    error: unknown,
    now: Date,
  ): Promise<void> {
    const [existing] = await this.#database
      .select({
        attempts: schema.albumObjectDeletionSweeps.attempts,
        executeAfter: schema.albumObjectDeletionSweeps.executeAfter,
      })
      .from(schema.albumObjectDeletionSweeps)
      .where(eq(schema.albumObjectDeletionSweeps.albumId, albumId))
      .limit(1);

    const attempts = (existing?.attempts ?? 0) + 1;
    const retryDelay = Math.min(60 * 60 * 1_000, 30_000 * 2 ** Math.min(attempts, 7));
    const retryAt = new Date(now.getTime() + retryDelay);
    const executeAfter =
      existing !== undefined && existing.executeAfter > now ? existing.executeAfter : retryAt;
    const failure = this.#albumObjectDeletionError(error);
    const lastErrorCode = failure.code.slice(0, 100);

    await this.#database.transaction(async (transaction) => {
      await transaction
        .insert(schema.albumObjectDeletionSweeps)
        .values({
          albumId,
          objectPrefix: `media/albums/${albumId}/`,
          executeAfter,
          attempts,
          lastErrorCode,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: schema.albumObjectDeletionSweeps.albumId,
          set: {
            executeAfter,
            attempts,
            lastErrorCode,
            updatedAt: now,
          },
        });
      await transaction.insert(schema.albumDeletionErrors).values({
        albumId,
        source: failure.source,
        stage: "object_cleanup",
        operation: failure.operation,
        code: failure.code,
        message: failure.message,
        providerRequestId: failure.providerRequestId,
        httpStatus: failure.httpStatus,
        attempt: attempts,
        details: failure.details,
        occurredAt: now,
      });
    });
  }

  async #ensureAlbumDeletionRecoveryGate(
    albumId: string,
    deletingSince: Date,
    now: Date,
  ): Promise<void> {
    const [existing] = await this.#database
      .select({ albumId: schema.albumObjectDeletionSweeps.albumId })
      .from(schema.albumObjectDeletionSweeps)
      .where(eq(schema.albumObjectDeletionSweeps.albumId, albumId))
      .limit(1);
    if (existing !== undefined) return;

    const executeAfter = new Date(deletingSince.getTime() + presignedUploadDeletionGraceMs);
    if (executeAfter <= now) return;

    await this.#database
      .insert(schema.albumObjectDeletionSweeps)
      .values({
        albumId,
        objectPrefix: `media/albums/${albumId}/`,
        executeAfter,
        attempts: 0,
        lastErrorCode: null,
        updatedAt: new Date(),
      })
      .onConflictDoNothing();
  }

  async #ensureAlbumFacePurged(
    albumId: string,
    purgeFaceData?: () => Promise<void>,
  ): Promise<void> {
    if (purgeFaceData !== undefined) {
      await purgeFaceData();
      return;
    }

    const faceReferenceCutoff = new Date(Date.now() - presignedFaceReferenceDeletionGraceMs);
    const [[faceIndex], [undeletedFaceReference], [recentFaceReference]] = await Promise.all([
      this.#database
        .select({ datasetName: schema.albumFaceIndexes.datasetName })
        .from(schema.albumFaceIndexes)
        .where(eq(schema.albumFaceIndexes.albumId, albumId))
        .limit(1),
      this.#database
        .select({ id: schema.faceSearchIntents.id })
        .from(schema.faceSearchIntents)
        .where(
          and(
            eq(schema.faceSearchIntents.albumId, albumId),
            isNull(schema.faceSearchIntents.referenceDeletedAt),
          ),
        )
        .limit(1),
      this.#database
        .select({ id: schema.faceSearchIntents.id })
        .from(schema.faceSearchIntents)
        .where(
          and(
            eq(schema.faceSearchIntents.albumId, albumId),
            gt(schema.faceSearchIntents.createdAt, faceReferenceCutoff),
          ),
        )
        .limit(1),
    ]);
    if (
      faceIndex?.datasetName != null ||
      undeletedFaceReference !== undefined ||
      recentFaceReference !== undefined
    ) {
      throw new AppError({
        code: "FACE_PROVIDER_UNAVAILABLE",
        message: "当前无法确认活动的人脸云端数据已删除，请稍后重试",
        statusCode: 503,
        retryable: true,
      });
    }
  }

  async #purgeAlbumObjects(albumId: string): Promise<void> {
    const [variants, editVariants, microPreviews] = await Promise.all([
      this.#database
        .select({
          id: schema.mediaVariants.id,
          objectKey: schema.mediaVariants.objectKey,
          providerMultipartUploadId: schema.mediaVariants.providerMultipartUploadId,
        })
        .from(schema.mediaVariants)
        .innerJoin(schema.media, eq(schema.mediaVariants.mediaId, schema.media.id))
        .where(eq(schema.media.albumId, albumId)),
      this.#database
        .select({ objectKey: schema.mediaEditVariants.objectKey })
        .from(schema.mediaEditVariants)
        .innerJoin(
          schema.mediaEditRevisions,
          eq(schema.mediaEditVariants.editRevisionId, schema.mediaEditRevisions.id),
        )
        .innerJoin(schema.media, eq(schema.mediaEditRevisions.mediaId, schema.media.id))
        .where(eq(schema.media.albumId, albumId)),
      this.#database
        .select({ objectKey: schema.mediaMicroPreviews.objectKey })
        .from(schema.mediaMicroPreviews)
        .where(eq(schema.mediaMicroPreviews.albumId, albumId)),
    ]);

    const multipartVariantIds =
      variants.length === 0
        ? new Set<string>()
        : new Set(
            (
              await this.#database
                .select({ variantId: schema.uploadParts.variantId })
                .from(schema.uploadParts)
                .where(
                  inArray(
                    schema.uploadParts.variantId,
                    variants.map((variant) => variant.id),
                  ),
                )
            ).map((part) => part.variantId),
          );
    for (const variant of variants) {
      if (multipartVariantIds.has(variant.id)) {
        await this.#storage.abortMultipart(
          variant.providerMultipartUploadId ?? variant.id,
          variant.objectKey,
        );
      }
    }

    const objectKeys = [
      ...new Set([...variants, ...editVariants, ...microPreviews].map((row) => row.objectKey)),
    ];
    if (this.#storage.deleteMany === undefined) {
      for (let offset = 0; offset < objectKeys.length; offset += 16) {
        await Promise.all(
          objectKeys.slice(offset, offset + 16).map((objectKey) => this.#storage.delete(objectKey)),
        );
      }
    } else {
      await this.#storage.deleteMany(objectKeys);
    }

    const albumPrefix = `media/albums/${albumId}/`;
    await this.#storage.deletePrefix?.(albumPrefix);
    const prefixedKeys = objectKeys.filter((objectKey) => objectKey.startsWith(albumPrefix));
    const outlierKeys = objectKeys.filter((objectKey) => !objectKey.startsWith(albumPrefix));
    if (this.#cdn.invalidateDirectory !== undefined) {
      try {
        await this.#cdn.invalidateDirectory(`/${albumPrefix}`);
      } catch (error) {
        throw new AlbumCdnCleanupError("RefreshObjectCachesDirectory", error);
      }
    } else {
      outlierKeys.push(...prefixedKeys);
    }
    try {
      await this.#cdn.invalidate(outlierKeys.map((objectKey) => `/${objectKey}`));
    } catch (error) {
      throw new AlbumCdnCleanupError("RefreshObjectCachesFiles", error);
    }
  }

  async #finalizeAlbumDeletionIfReady(albumId: string): Promise<boolean> {
    const [objectSweep] = await this.#database
      .select({ albumId: schema.albumObjectDeletionSweeps.albumId })
      .from(schema.albumObjectDeletionSweeps)
      .where(eq(schema.albumObjectDeletionSweeps.albumId, albumId))
      .limit(1);
    if (objectSweep !== undefined) return false;

    const [faceSweep] = await this.#database
      .select({ objectKey: schema.faceReferenceDeletionSweeps.objectKey })
      .from(schema.faceReferenceDeletionSweeps)
      .innerJoin(
        schema.faceSearchIntents,
        eq(schema.faceReferenceDeletionSweeps.objectKey, schema.faceSearchIntents.objectKey),
      )
      .where(eq(schema.faceSearchIntents.albumId, albumId))
      .limit(1);
    if (faceSweep !== undefined) return false;

    await this.#database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`album-state:${albumId}`}, 0))`,
      );

      const lockedAlbum = await transaction.execute(sql`
        select id from albums where id = ${albumId} for update
      `);
      if (lockedAlbum.rowCount !== 1) return;
      await transaction.execute(sql`
        select id from media where album_id = ${albumId} for update
      `);

      await transaction.execute(sql`
        create temporary table album_delete_media_ids (
          id uuid primary key
        ) on commit drop
      `);
      await transaction.execute(sql`
        insert into album_delete_media_ids (id)
        select id from media where album_id = ${albumId}
      `);
      await transaction.execute(sql`
        create temporary table album_delete_bib_tag_ids (
          id uuid primary key
        ) on commit drop
      `);
      await transaction.execute(sql`
        insert into album_delete_bib_tag_ids (id)
        select id from media_bib_tags where album_id = ${albumId}
      `);
      await transaction.execute(sql`
        create temporary table album_delete_provider_task_ids (
          id varchar(256) primary key
        ) on commit drop
      `);
      await transaction.execute(sql`
        insert into album_delete_provider_task_ids (id)
        select provider_task_id
        from face_search_intents
        where album_id = ${albumId} and provider_task_id is not null
        union
        select provider_task_id
        from face_album_jobs
        where album_id = ${albumId} and provider_task_id is not null
        union
        select provider_task_id
        from media_face_index_tasks
        where album_id = ${albumId} and provider_task_id is not null
      `);

      await transaction
        .delete(schema.mediaMicroPreviews)
        .where(eq(schema.mediaMicroPreviews.albumId, albumId));
      await transaction.execute(sql`
        delete from media_edit_states
        where media_id in (select id from album_delete_media_ids)
      `);
      await transaction.execute(sql`
        delete from media_edit_variants
        where edit_revision_id in (
          select media_edit_revisions.id
          from media_edit_revisions
          where media_edit_revisions.media_id in (select id from album_delete_media_ids)
        )
      `);
      await transaction.execute(sql`
        delete from media_edit_revisions
        where media_id in (select id from album_delete_media_ids)
      `);
      await transaction.execute(sql`
        delete from media_variants
        where media_id in (select id from album_delete_media_ids)
      `);

      const deleted = await transaction
        .delete(schema.albums)
        .where(and(eq(schema.albums.id, albumId), eq(schema.albums.state, "deleting")))
        .returning({ id: schema.albums.id });
      if (deleted.length !== 1) {
        throw new AppError({
          code: "STATE_CONFLICT",
          message: "活动删除状态已发生变化，请重试",
          statusCode: 409,
        });
      }

      await transaction.execute(sql`
        delete from operation_requests as operation_request
        where operation_request.operation like ${`%${albumId}%`}
           or operation_request.result::text like ${`%${albumId}%`}
           or exists (
             select 1 from album_delete_media_ids
             where operation_request.operation like '%' || album_delete_media_ids.id::text || '%'
                or operation_request.result::text like '%' || album_delete_media_ids.id::text || '%'
           )
           or exists (
             select 1 from album_delete_bib_tag_ids
             where operation_request.operation like '%' || album_delete_bib_tag_ids.id::text || '%'
                or operation_request.result::text like '%' || album_delete_bib_tag_ids.id::text || '%'
           )
      `);
      await transaction.execute(sql`
        delete from media_batch_requests as batch_request
        where exists (
          select 1 from album_delete_media_ids
          where batch_request.result::text like '%' || album_delete_media_ids.id::text || '%'
        )
      `);
      await transaction.execute(sql`
        delete from face_integration_events as integration_event
        where integration_event.provider_task_id in (
          select id from album_delete_provider_task_ids
        )
      `);
      await transaction.execute(sql`
        delete from audit_logs as audit_log
        where audit_log.target_id = ${albumId}::uuid
           or audit_log.target_id in (select id from album_delete_media_ids)
           or audit_log.target_id in (select id from album_delete_bib_tag_ids)
      `);
    });
    return true;
  }

  async #applyBatchItem(options: {
    readonly transaction: Transaction;
    readonly actor: InternalActor;
    readonly input: MediaBatchRequest;
    readonly mediaId: string;
    readonly requestId: string;
  }): Promise<MediaBatchResult["items"][number]> {
    let media: typeof schema.media.$inferSelect;
    try {
      media = await this.#lockedMedia(options.transaction, options.mediaId);
    } catch (error) {
      if (error instanceof AppError && error.code === "MEDIA_NOT_FOUND") {
        return this.#batchFailure(options.mediaId, "MEDIA_NOT_FOUND", "媒体不存在");
      }
      throw error;
    }
    try {
      if (options.input.action === "publish") {
        if (media.publicationStatus !== "published") {
          if (media.publicationStatus !== "pending_review")
            throw this.#stateConflict("媒体尚未达到可发布状态");
          await this.#publishInTransaction(
            options.transaction,
            media,
            options.actor.id,
            options.requestId,
          );
        }
      } else if (options.input.action === "hide") {
        if (media.publicationStatus !== "hidden") {
          if (
            media.publicationStatus !== "published" &&
            media.publicationStatus !== "pending_review"
          ) {
            throw this.#stateConflict("该媒体当前不能隐藏");
          }
          await this.#hideInTransaction(
            options.transaction,
            media,
            options.actor.id,
            options.requestId,
          );
        }
      } else if (options.input.action === "restore") {
        if (media.publicationStatus !== "published") {
          if (media.publicationStatus !== "hidden") throw this.#stateConflict("该媒体当前不能恢复");
          await this.#restoreInTransaction(
            options.transaction,
            media,
            options.actor.id,
            options.requestId,
          );
        }
      } else {
        if (options.input.categoryId === undefined) {
          return this.#batchFailure(options.mediaId, "BAD_REQUEST", "分类无效");
        }
        if (options.input.categoryId !== null) {
          const categoryId = options.input.categoryId;
          const [category] = await options.transaction
            .select({ id: schema.categories.id })
            .from(schema.categories)
            .where(
              and(
                eq(schema.categories.id, categoryId),
                eq(schema.categories.albumId, media.albumId),
                eq(schema.categories.enabled, true),
              ),
            )
            .limit(1);
          if (category === undefined) {
            return this.#batchFailure(options.mediaId, "BAD_REQUEST", "分类无效");
          }
        }
        await options.transaction
          .update(schema.media)
          .set({ categoryId: options.input.categoryId ?? null, updatedAt: new Date() })
          .where(eq(schema.media.id, media.id));
        if (media.publicationStatus === "published") {
          await this.#event(options.transaction, media.albumId, media.id, "media.updated");
        }
        await this.#audit(options.transaction, {
          actorId: options.actor.id,
          action: "media.category.changed",
          targetId: media.id,
          changedFields: ["categoryId"],
          requestId: options.requestId,
        });
      }
      return { mediaId: options.mediaId, ok: true, code: null, message: null };
    } catch (error) {
      if (error instanceof AppError)
        return this.#batchFailure(options.mediaId, error.code, error.message);
      throw error;
    }
  }

  async #publishInTransaction(
    transaction: Transaction,
    media: typeof schema.media.$inferSelect,
    actorId: string,
    requestId: string,
  ): Promise<void> {
    if (media.ingestStatus !== "ready") {
      throw this.#stateConflict("照片尚未上传完成，不能显示");
    }
    await this.#assertNoPendingEdit(transaction, media.id);
    const now = new Date();
    const [album] = await transaction
      .update(schema.albums)
      .set({ publishSequence: sql`${schema.albums.publishSequence} + 1`, updatedAt: now })
      .where(eq(schema.albums.id, media.albumId))
      .returning({ publishSequence: schema.albums.publishSequence });
    if (album === undefined) throw new Error("Album disappeared during publication");
    await transaction
      .update(schema.media)
      .set({
        publicationStatus: "published",
        publishSequence: album.publishSequence,
        publishedAt: now,
        hiddenAt: null,
        updatedAt: now,
      })
      .where(eq(schema.media.id, media.id));
    await this.#event(transaction, media.albumId, media.id, "media.published");
    await this.#audit(transaction, {
      actorId,
      action: "media.published",
      targetId: media.id,
      changedFields: ["publicationStatus", "publishSequence"],
      requestId,
    });
  }

  async #hideInTransaction(
    transaction: Transaction,
    media: typeof schema.media.$inferSelect,
    actorId: string,
    requestId: string,
  ): Promise<void> {
    const now = new Date();
    await transaction
      .update(schema.media)
      .set({ publicationStatus: "hidden", hiddenAt: now, updatedAt: now })
      .where(eq(schema.media.id, media.id));
    await this.#event(transaction, media.albumId, media.id, "media.hidden");
    await this.#audit(transaction, {
      actorId,
      action: "media.hidden",
      targetId: media.id,
      changedFields: ["publicationStatus", "hiddenAt"],
      requestId,
    });
  }

  async #restoreInTransaction(
    transaction: Transaction,
    media: typeof schema.media.$inferSelect,
    actorId: string,
    requestId: string,
  ): Promise<void> {
    if (media.ingestStatus !== "ready") {
      throw this.#stateConflict("照片尚未上传完成，不能显示");
    }
    await this.#assertNoPendingEdit(transaction, media.id);
    if (media.publishSequence === null || media.publishedAt === null) {
      await this.#publishInTransaction(transaction, media, actorId, requestId);
      return;
    }
    const now = new Date();
    await transaction
      .update(schema.media)
      .set({ publicationStatus: "published", hiddenAt: null, updatedAt: now })
      .where(eq(schema.media.id, media.id));
    await this.#event(transaction, media.albumId, media.id, "media.restored");
    await this.#audit(transaction, {
      actorId,
      action: "media.restored",
      targetId: media.id,
      changedFields: ["publicationStatus", "hiddenAt"],
      requestId,
    });
  }

  async #assertNoPendingEdit(transaction: Transaction, mediaId: string): Promise<void> {
    const [editState] = await transaction
      .select({ pendingRevisionId: schema.mediaEditStates.pendingRevisionId })
      .from(schema.mediaEditStates)
      .where(eq(schema.mediaEditStates.mediaId, mediaId))
      .limit(1);
    if (editState?.pendingRevisionId !== null && editState?.pendingRevisionId !== undefined) {
      throw this.#stateConflict("修图版本仍在处理中，完成或取消后才能显示");
    }
  }

  async #lockedMedia(transaction: Transaction, mediaId: string) {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`media:${mediaId}`}, 0))`,
    );
    const [row] = await transaction
      .select({ media: schema.media, albumState: schema.albums.state })
      .from(schema.media)
      .innerJoin(schema.albums, eq(schema.media.albumId, schema.albums.id))
      .where(eq(schema.media.id, mediaId))
      .limit(1);
    if (row === undefined) {
      throw new AppError({ code: "MEDIA_NOT_FOUND", message: "媒体不存在", statusCode: 404 });
    }
    if (row.albumState === "deleting") {
      throw this.#stateConflict("活动正在删除，不能继续修改照片");
    }
    return row.media;
  }

  async #event(
    transaction: Transaction,
    albumId: string,
    mediaId: string,
    type: string,
  ): Promise<void> {
    await transaction.insert(schema.liveEvents).values({ albumId, mediaId, type, payload: {} });
    await transaction.execute(sql`select pg_notify(${liveEventChannel}, ${albumId})`);
  }

  async #audit(
    transaction: Transaction,
    options: {
      readonly actorId: string;
      readonly action: string;
      readonly targetId: string;
      readonly changedFields: readonly string[];
      readonly requestId: string;
      readonly result?: string;
    },
  ): Promise<void> {
    await transaction.insert(schema.auditLogs).values({
      actorUserId: options.actorId,
      action: options.action,
      targetType: "media",
      targetId: options.targetId,
      result: options.result ?? "success",
      changedFields: options.changedFields,
      requestId: options.requestId,
    });
  }

  async #failDeletionTask(
    task: typeof schema.deletionTasks.$inferSelect,
    code: string,
    now: Date,
  ): Promise<void> {
    const delay = Math.min(60 * 60 * 1_000, 60_000 * 2 ** Math.min(task.attempts, 6));
    await this.#database.transaction(async (transaction) => {
      await transaction
        .update(schema.deletionTasks)
        .set({
          status: "failed",
          lastErrorCode: code,
          nextAttemptAt: new Date(now.getTime() + delay),
          updatedAt: new Date(),
        })
        .where(eq(schema.deletionTasks.id, task.id));
      await this.#audit(transaction, {
        actorId: task.requestedBy,
        action: "media.deletion.failed",
        targetId: task.mediaId,
        changedFields: ["deletionTask"],
        requestId: task.requestId,
        result: "failed",
      });
    });
  }

  async #publicAlbum(slug: string) {
    const [album] = await this.#database
      .select()
      .from(schema.albums)
      .where(
        and(
          eq(schema.albums.slug, slug),
          inArray(schema.albums.state, ["live", "ended", "archived"]),
        ),
      )
      .limit(1);
    if (album === undefined) throw this.#publicNotFound();
    return album;
  }

  async #authorized(
    album: typeof schema.albums.$inferSelect,
    rawToken: string | undefined,
  ): Promise<boolean> {
    if (album.access === "public") return true;
    if (rawToken === undefined) return false;
    const tokenHash = createHmac("sha256", this.#config.VISITOR_SESSION_SECRET)
      .update(rawToken, "utf8")
      .digest("hex");
    const [session] = await this.#database
      .select({ id: schema.visitorSessions.id })
      .from(schema.visitorSessions)
      .where(
        and(
          eq(schema.visitorSessions.tokenHash, tokenHash),
          eq(schema.visitorSessions.albumId, album.id),
          eq(schema.visitorSessions.accessVersion, album.accessVersion),
          gt(schema.visitorSessions.expiresAt, new Date()),
          isNull(schema.visitorSessions.revokedAt),
        ),
      )
      .limit(1);
    return session !== undefined;
  }

  #batchFailure(mediaId: string, code: string, message: string) {
    return { mediaId, ok: false, code, message };
  }

  #stateConflict(message: string): AppError {
    return new AppError({ code: "STATE_CONFLICT", message, statusCode: 409 });
  }

  #publicNotFound(): AppError {
    return new AppError({
      code: "ALBUM_PASSWORD_INVALID",
      message: "相册不可用或口令错误",
      statusCode: 404,
    });
  }

  #encodeAuditCursor(id: number): string {
    const encoded = Buffer.from(JSON.stringify({ id }), "utf8").toString("base64url");
    const signature = createHmac("sha256", this.#config.CURSOR_SIGNING_SECRET)
      .update(encoded, "utf8")
      .digest("base64url");
    return `${encoded}.${signature}`;
  }

  #signedDownloadFromRecord(record: Record<string, unknown>) {
    if (
      typeof record.objectKey !== "string" ||
      typeof record.filename !== "string" ||
      typeof record.bytes !== "number" ||
      typeof record.expiresAt !== "string"
    ) {
      throw new Error("Stored download idempotency result is invalid");
    }
    const expiresAt = new Date(record.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) throw new Error("Stored download expiry is invalid");
    return {
      url: this.#storage.signRead({ key: record.objectKey, expiresAt }),
      filename: record.filename,
      bytes: record.bytes,
      expiresAt: expiresAt.toISOString(),
    };
  }

  #decodeAuditCursor(value: string): number {
    const [encoded, supplied] = value.split(".", 2);
    if (encoded === undefined || supplied === undefined) {
      throw new AppError({ code: "BAD_REQUEST", message: "审计游标无效", statusCode: 400 });
    }
    const expected = createHmac("sha256", this.#config.CURSOR_SIGNING_SECRET)
      .update(encoded, "utf8")
      .digest("base64url");
    if (!safeEqual(expected, supplied)) {
      throw new AppError({ code: "BAD_REQUEST", message: "审计游标无效", statusCode: 400 });
    }
    try {
      const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as {
        id: number;
      };
      if (!Number.isSafeInteger(parsed.id) || parsed.id < 1) throw new Error("invalid id");
      return parsed.id;
    } catch {
      throw new AppError({ code: "BAD_REQUEST", message: "审计游标无效", statusCode: 400 });
    }
  }
}
