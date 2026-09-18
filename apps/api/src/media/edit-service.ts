import {
  type ApplyMediaEditRequest,
  type CreateMediaEditRevisionRequest,
  hasPermission,
  type MediaEditContextView,
  type MediaEditRevisionView,
  type MediaEditVariantKind,
  type MediaEditVariantView,
  type PrepareMediaEditRevisionRequest,
  type RevertMediaEditRequest,
  type SignedUpload,
} from "@photostream/contracts";
import type { Database } from "@photostream/db";
import { schema } from "@photostream/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { AppError } from "../errors.js";
import { liveEventChannel } from "./live-event-broker.js";
import type { ObjectStorage } from "./object-storage.js";
import type { InternalActor } from "./service.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Transaction;

const requiredKinds: readonly MediaEditVariantKind[] = [
  "photo_480",
  "photo_960",
  "photo_1920",
  "photo_download",
];

function extensionFor(format: string): string {
  return format === "jpeg" ? "jpg" : format;
}

function filenameFor(kind: MediaEditVariantKind, format: string): string {
  if (kind === "photo_download") return `download.${extensionFor(format)}`;
  return `${kind.slice("photo_".length)}.${extensionFor(format)}`;
}

function expectedDimensions(
  media: { readonly width: number; readonly height: number },
  kind: MediaEditVariantKind,
) {
  if (kind === "photo_download") return { width: media.width, height: media.height };
  const maxEdge = kind === "photo_480" ? 480 : kind === "photo_960" ? 960 : 1_920;
  const scale = Math.min(1, maxEdge / Math.max(media.width, media.height));
  return {
    width: Math.max(1, Math.round(media.width * scale)),
    height: Math.max(1, Math.round(media.height * scale)),
  };
}

function variantView(row: typeof schema.mediaEditVariants.$inferSelect): MediaEditVariantView {
  return {
    kind: row.kind,
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    expectedBytes: row.expectedBytes,
    contentType: row.contentType,
    verified: row.verified,
  };
}

export class MediaEditService {
  readonly #database: Database;
  readonly #storage: ObjectStorage;

  constructor(options: { readonly database: Database; readonly storage: ObjectStorage }) {
    this.#database = options.database;
    this.#storage = options.storage;
  }

  async getContext(actor: InternalActor, mediaId: string): Promise<MediaEditContextView> {
    const media = await this.#media(this.#database, mediaId);
    this.#assertEditAccess(actor, media);
    return this.#context(this.#database, mediaId);
  }

  async createRevision(options: {
    readonly actor: InternalActor;
    readonly mediaId: string;
    readonly input: CreateMediaEditRevisionRequest;
    readonly requestId: string;
  }): Promise<MediaEditContextView> {
    await this.#database.transaction(async (transaction) => {
      await this.#lock(transaction, options.mediaId);
      const media = await this.#media(transaction, options.mediaId);
      this.#assertEditAccess(options.actor, media);
      const state = await this.#stateForUpdate(transaction, options.mediaId);
      if (state.pendingRevisionId !== null) {
        throw new AppError({
          code: "STATE_CONFLICT",
          message: "此照片已有正在处理的修图版本",
          statusCode: 409,
        });
      }
      if (
        state.generation !== options.input.basedOnGeneration ||
        state.activeRevisionId !== options.input.basedOnRevisionId
      ) {
        throw this.#versionConflict();
      }

      const baseOriginal = await this.#baseOriginal(transaction, options.mediaId);
      if (baseOriginal === null) {
        throw new AppError({
          code: "STATE_CONFLICT",
          message: "基础原图记录尚未建立",
          statusCode: 409,
        });
      }

      const now = new Date();
      const [revision] = await transaction
        .insert(schema.mediaEditRevisions)
        .values({
          mediaId: options.mediaId,
          createdBy: options.actor.id,
          status: "rendering",
          basedOnRevisionId: options.input.basedOnRevisionId,
          basedOnGeneration: options.input.basedOnGeneration,
          pipelineVersion: options.input.pipelineVersion,
          recipeVersion: options.input.recipeVersion,
          recipeJson: options.input.recipeJson,
          denoiseModel: options.input.denoiseModel,
          denoiseModelVersion: options.input.denoiseModelVersion,
          deblurModel: options.input.deblurModel,
          deblurModelVersion: options.input.deblurModelVersion,
          sourceVariantId: baseOriginal.id,
          updatedAt: now,
        })
        .returning({ id: schema.mediaEditRevisions.id });
      if (revision === undefined) throw new Error("Media edit revision insert returned no row");

      await transaction
        .update(schema.mediaEditStates)
        .set({
          pendingRevisionId: revision.id,
          generation: state.generation + 1,
          updatedBy: options.actor.id,
          updatedAt: now,
        })
        .where(eq(schema.mediaEditStates.mediaId, options.mediaId));

      await this.#audit(transaction, {
        actorId: options.actor.id,
        action: "media.edit.reserved",
        targetId: options.mediaId,
        changedFields: ["pendingRevisionId", "generation"],
        requestId: options.requestId,
      });
    });
    return this.#context(this.#database, options.mediaId);
  }

  async prepareRevision(options: {
    readonly actor: InternalActor;
    readonly mediaId: string;
    readonly revisionId: string;
    readonly input: PrepareMediaEditRevisionRequest;
    readonly requestId: string;
  }): Promise<MediaEditContextView> {
    await this.#database.transaction(async (transaction) => {
      await this.#lock(transaction, options.mediaId);
      const media = await this.#media(transaction, options.mediaId);
      this.#assertEditAccess(options.actor, media);
      const state = await this.#stateForUpdate(transaction, options.mediaId);
      if (state.pendingRevisionId !== options.revisionId) {
        throw this.#versionConflict();
      }

      const [revision] = await transaction
        .select()
        .from(schema.mediaEditRevisions)
        .where(
          and(
            eq(schema.mediaEditRevisions.id, options.revisionId),
            eq(schema.mediaEditRevisions.mediaId, options.mediaId),
          ),
        )
        .limit(1);
      if (revision === undefined) throw this.#notFound();

      const existing = await transaction
        .select()
        .from(schema.mediaEditVariants)
        .where(eq(schema.mediaEditVariants.editRevisionId, revision.id));
      if (revision.status === "uploading" && existing.length === requiredKinds.length) return;
      if (revision.status !== "rendering" || existing.length !== 0) {
        throw new AppError({
          code: "STATE_CONFLICT",
          message: "当前修图版本不能重新准备上传对象",
          statusCode: 409,
        });
      }

      for (const variant of options.input.variants) {
        const expected = expectedDimensions(media, variant.kind);
        if (variant.width !== expected.width || variant.height !== expected.height) {
          throw new AppError({
            code: "BAD_REQUEST",
            message: `${variant.kind} 尺寸不符合修图输出规格`,
            statusCode: 400,
          });
        }
      }

      await transaction.insert(schema.mediaEditVariants).values(
        options.input.variants.map((variant) => ({
          editRevisionId: revision.id,
          kind: variant.kind,
          objectKey: `media/albums/${media.albumId}/photos/${media.id}/edits/${revision.id}/${filenameFor(variant.kind, variant.format)}`,
          format: variant.format,
          contentType: variant.contentType,
          width: variant.width,
          height: variant.height,
          expectedBytes: variant.bytes,
        })),
      );
      const now = new Date();
      await transaction
        .update(schema.mediaEditRevisions)
        .set({ status: "uploading", updatedAt: now })
        .where(eq(schema.mediaEditRevisions.id, revision.id));
      await this.#audit(transaction, {
        actorId: options.actor.id,
        action: "media.edit.prepared",
        targetId: options.mediaId,
        changedFields: ["editRevision.status", "editVariants"],
        requestId: options.requestId,
      });
    });
    return this.#context(this.#database, options.mediaId);
  }

  async signVariant(options: {
    readonly actor: InternalActor;
    readonly mediaId: string;
    readonly revisionId: string;
    readonly kind: MediaEditVariantKind;
  }): Promise<SignedUpload> {
    const media = await this.#media(this.#database, options.mediaId);
    this.#assertEditAccess(options.actor, media);
    const [row] = await this.#database
      .select({ revision: schema.mediaEditRevisions, variant: schema.mediaEditVariants })
      .from(schema.mediaEditRevisions)
      .innerJoin(
        schema.mediaEditVariants,
        eq(schema.mediaEditVariants.editRevisionId, schema.mediaEditRevisions.id),
      )
      .where(
        and(
          eq(schema.mediaEditRevisions.id, options.revisionId),
          eq(schema.mediaEditRevisions.mediaId, options.mediaId),
          eq(schema.mediaEditVariants.kind, options.kind),
        ),
      )
      .limit(1);
    if (row === undefined) throw this.#notFound();
    if (!inArrayValue(row.revision.status, ["rendering", "uploading"])) {
      throw new AppError({
        code: "STATE_CONFLICT",
        message: "当前修图版本不能继续上传",
        statusCode: 409,
      });
    }
    if (row.variant.verified) {
      throw new AppError({
        code: "STATE_CONFLICT",
        message: "该修图对象已经完成",
        statusCode: 409,
      });
    }
    const expiresAt = new Date(Date.now() + 15 * 60 * 1_000);
    const signed = await this.#storage.signPut({
      key: row.variant.objectKey,
      contentType: row.variant.contentType,
      bytes: row.variant.expectedBytes,
      expiresAt,
    });
    return {
      url: signed.url,
      headers: signed.headers,
      expiresAt: signed.expiresAt.toISOString(),
    };
  }

  async completeVariant(options: {
    readonly actor: InternalActor;
    readonly mediaId: string;
    readonly revisionId: string;
    readonly kind: MediaEditVariantKind;
  }): Promise<{ readonly ok: true }> {
    const media = await this.#media(this.#database, options.mediaId);
    this.#assertEditAccess(options.actor, media);
    const [row] = await this.#database
      .select({ revision: schema.mediaEditRevisions, variant: schema.mediaEditVariants })
      .from(schema.mediaEditRevisions)
      .innerJoin(
        schema.mediaEditVariants,
        eq(schema.mediaEditVariants.editRevisionId, schema.mediaEditRevisions.id),
      )
      .where(
        and(
          eq(schema.mediaEditRevisions.id, options.revisionId),
          eq(schema.mediaEditRevisions.mediaId, options.mediaId),
          eq(schema.mediaEditVariants.kind, options.kind),
        ),
      )
      .limit(1);
    if (row === undefined) throw this.#notFound();
    if (row.variant.verified) return { ok: true };

    const metadata = await this.#storage.head(row.variant.objectKey);
    if (
      metadata === null ||
      metadata.bytes !== row.variant.expectedBytes ||
      metadata.contentType !== row.variant.contentType
    ) {
      throw new AppError({
        code: "OBJECT_VERIFICATION_FAILED",
        message: "修图对象校验失败",
        statusCode: 409,
      });
    }

    await this.#database
      .update(schema.mediaEditVariants)
      .set({
        verified: true,
        bytes: metadata.bytes,
        etag: metadata.etag,
        completedAt: new Date(),
      })
      .where(eq(schema.mediaEditVariants.id, row.variant.id));
    return { ok: true };
  }

  async completeRevision(options: {
    readonly actor: InternalActor;
    readonly mediaId: string;
    readonly revisionId: string;
    readonly requestId: string;
  }): Promise<MediaEditContextView> {
    await this.#database.transaction(async (transaction) => {
      await this.#lock(transaction, options.mediaId);
      const media = await this.#media(transaction, options.mediaId);
      this.#assertEditAccess(options.actor, media);
      const state = await this.#stateForUpdate(transaction, options.mediaId);
      if (state.pendingRevisionId !== options.revisionId) {
        throw new AppError({
          code: "STATE_CONFLICT",
          message: "该修图版本不再是当前待应用版本",
          statusCode: 409,
        });
      }
      const [revision] = await transaction
        .select()
        .from(schema.mediaEditRevisions)
        .where(
          and(
            eq(schema.mediaEditRevisions.id, options.revisionId),
            eq(schema.mediaEditRevisions.mediaId, options.mediaId),
          ),
        )
        .limit(1);
      if (revision === undefined) throw this.#notFound();
      const variants = await transaction
        .select()
        .from(schema.mediaEditVariants)
        .where(eq(schema.mediaEditVariants.editRevisionId, revision.id));
      if (
        variants.length !== requiredKinds.length ||
        requiredKinds.some(
          (kind) => !variants.some((variant) => variant.kind === kind && variant.verified),
        )
      ) {
        throw new AppError({
          code: "STATE_CONFLICT",
          message: "修图版本的四个输出尚未全部完成",
          statusCode: 409,
        });
      }
      const now = new Date();
      await transaction
        .update(schema.mediaEditRevisions)
        .set({ status: "ready", readyAt: now, updatedAt: now, failureCode: null })
        .where(eq(schema.mediaEditRevisions.id, revision.id));
      await this.#audit(transaction, {
        actorId: options.actor.id,
        action: "media.edit.ready",
        targetId: options.mediaId,
        changedFields: ["editRevision.status"],
        requestId: options.requestId,
      });
    });
    return this.#context(this.#database, options.mediaId);
  }

  async apply(options: {
    readonly actor: InternalActor;
    readonly mediaId: string;
    readonly revisionId: string;
    readonly input: ApplyMediaEditRequest;
    readonly requestId: string;
  }): Promise<MediaEditContextView> {
    await this.#database.transaction(async (transaction) => {
      await this.#lock(transaction, options.mediaId);
      const media = await this.#media(transaction, options.mediaId);
      this.#assertEditAccess(options.actor, media);
      const state = await this.#stateForUpdate(transaction, options.mediaId);
      this.#assertExpectedState(state, options.input);
      if (state.pendingRevisionId !== options.revisionId) {
        throw this.#versionConflict();
      }
      const [revision] = await transaction
        .select()
        .from(schema.mediaEditRevisions)
        .where(
          and(
            eq(schema.mediaEditRevisions.id, options.revisionId),
            eq(schema.mediaEditRevisions.mediaId, options.mediaId),
          ),
        )
        .limit(1);
      if (revision === undefined) throw this.#notFound();
      if (revision.status !== "ready") {
        throw new AppError({
          code: "STATE_CONFLICT",
          message: "修图版本尚未准备完成",
          statusCode: 409,
        });
      }

      const now = new Date();
      if (state.activeRevisionId !== null) {
        await transaction
          .update(schema.mediaEditRevisions)
          .set({ status: "ready", updatedAt: now })
          .where(eq(schema.mediaEditRevisions.id, state.activeRevisionId));
      }
      await transaction
        .update(schema.mediaEditRevisions)
        .set({ status: "active", appliedAt: now, updatedAt: now })
        .where(eq(schema.mediaEditRevisions.id, revision.id));
      await transaction
        .update(schema.mediaEditStates)
        .set({
          activeRevisionId: revision.id,
          pendingRevisionId: null,
          generation: state.generation + 1,
          updatedBy: options.actor.id,
          updatedAt: now,
        })
        .where(eq(schema.mediaEditStates.mediaId, options.mediaId));

      if (media.publicationStatus === "published") {
        await this.#event(transaction, media.albumId, media.id, "media.updated");
      }
      await this.#audit(transaction, {
        actorId: options.actor.id,
        action: "media.edit.applied",
        targetId: options.mediaId,
        changedFields: ["activeRevisionId", "pendingRevisionId", "generation"],
        requestId: options.requestId,
      });
    });
    return this.#context(this.#database, options.mediaId);
  }

  async cancelPending(options: {
    readonly actor: InternalActor;
    readonly mediaId: string;
    readonly revisionId: string;
    readonly requestId: string;
  }): Promise<MediaEditContextView> {
    await this.#database.transaction(async (transaction) => {
      await this.#lock(transaction, options.mediaId);
      const media = await this.#media(transaction, options.mediaId);
      this.#assertEditAccess(options.actor, media);
      const state = await this.#stateForUpdate(transaction, options.mediaId);
      if (state.pendingRevisionId !== options.revisionId) throw this.#versionConflict();
      const now = new Date();
      await transaction
        .update(schema.mediaEditRevisions)
        .set({ status: "discarded", updatedAt: now })
        .where(
          and(
            eq(schema.mediaEditRevisions.id, options.revisionId),
            eq(schema.mediaEditRevisions.mediaId, options.mediaId),
          ),
        );
      await transaction
        .update(schema.mediaEditStates)
        .set({
          pendingRevisionId: null,
          generation: state.generation + 1,
          updatedBy: options.actor.id,
          updatedAt: now,
        })
        .where(eq(schema.mediaEditStates.mediaId, options.mediaId));
      await this.#audit(transaction, {
        actorId: options.actor.id,
        action: "media.edit.cancelled",
        targetId: options.mediaId,
        changedFields: ["pendingRevisionId", "generation"],
        requestId: options.requestId,
      });
    });
    return this.#context(this.#database, options.mediaId);
  }

  async revert(options: {
    readonly actor: InternalActor;
    readonly mediaId: string;
    readonly input: RevertMediaEditRequest;
    readonly requestId: string;
  }): Promise<MediaEditContextView> {
    await this.#database.transaction(async (transaction) => {
      await this.#lock(transaction, options.mediaId);
      const media = await this.#media(transaction, options.mediaId);
      this.#assertEditAccess(options.actor, media);
      const state = await this.#stateForUpdate(transaction, options.mediaId);
      this.#assertExpectedState(state, options.input);
      if (state.pendingRevisionId !== null) {
        throw new AppError({
          code: "STATE_CONFLICT",
          message: "请先完成或取消正在处理的修图版本",
          statusCode: 409,
        });
      }

      if (options.input.targetRevisionId !== null) {
        const [target] = await transaction
          .select()
          .from(schema.mediaEditRevisions)
          .where(
            and(
              eq(schema.mediaEditRevisions.id, options.input.targetRevisionId),
              eq(schema.mediaEditRevisions.mediaId, options.mediaId),
            ),
          )
          .limit(1);
        if (target === undefined || !inArrayValue(target.status, ["ready", "active"])) {
          throw new AppError({
            code: "STATE_CONFLICT",
            message: "目标修图版本不可用",
            statusCode: 409,
          });
        }
      }

      const now = new Date();
      if (
        state.activeRevisionId !== null &&
        state.activeRevisionId !== options.input.targetRevisionId
      ) {
        await transaction
          .update(schema.mediaEditRevisions)
          .set({ status: "ready", updatedAt: now })
          .where(eq(schema.mediaEditRevisions.id, state.activeRevisionId));
      }
      if (options.input.targetRevisionId !== null) {
        await transaction
          .update(schema.mediaEditRevisions)
          .set({ status: "active", appliedAt: now, updatedAt: now })
          .where(eq(schema.mediaEditRevisions.id, options.input.targetRevisionId));
      }
      await transaction
        .update(schema.mediaEditStates)
        .set({
          activeRevisionId: options.input.targetRevisionId,
          generation: state.generation + 1,
          updatedBy: options.actor.id,
          updatedAt: now,
        })
        .where(eq(schema.mediaEditStates.mediaId, options.mediaId));
      if (media.publicationStatus === "published") {
        await this.#event(transaction, media.albumId, media.id, "media.updated");
      }
      await this.#audit(transaction, {
        actorId: options.actor.id,
        action: "media.edit.reverted",
        targetId: options.mediaId,
        changedFields: ["activeRevisionId", "generation"],
        requestId: options.requestId,
      });
    });
    return this.#context(this.#database, options.mediaId);
  }

  async source(actor: InternalActor, mediaId: string) {
    const media = await this.#media(this.#database, mediaId);
    this.#assertEditAccess(actor, media);
    const original = await this.#baseOriginal(this.#database, mediaId);
    if (original === null || !original.verified) {
      throw new AppError({
        code: "DOWNLOAD_NOT_READY",
        message: "真正原图尚未上传完成",
        statusCode: 409,
      });
    }
    const expiresAt = new Date(Date.now() + 5 * 60 * 1_000);
    return {
      url: this.#storage.signRead({ key: original.objectKey, expiresAt }),
      expiresAt: expiresAt.toISOString(),
    };
  }

  async hasPending(mediaId: string, executor: Executor = this.#database): Promise<boolean> {
    const [state] = await executor
      .select({ pendingRevisionId: schema.mediaEditStates.pendingRevisionId })
      .from(schema.mediaEditStates)
      .where(eq(schema.mediaEditStates.mediaId, mediaId))
      .limit(1);
    return state?.pendingRevisionId !== null && state?.pendingRevisionId !== undefined;
  }

  async #context(executor: Executor, mediaId: string): Promise<MediaEditContextView> {
    const media = await this.#media(executor, mediaId);
    const original = await this.#baseOriginal(executor, mediaId);
    const [state] = await executor
      .select()
      .from(schema.mediaEditStates)
      .where(eq(schema.mediaEditStates.mediaId, mediaId))
      .limit(1);
    const normalizedState = state ?? {
      mediaId,
      activeRevisionId: null,
      pendingRevisionId: null,
      generation: 0,
      updatedBy: null,
      updatedAt: media.createdAt,
    };
    const activeRevision =
      normalizedState.activeRevisionId === null
        ? null
        : await this.#revisionView(executor, mediaId, normalizedState.activeRevisionId);
    const pendingRevision =
      normalizedState.pendingRevisionId === null
        ? null
        : await this.#revisionView(executor, mediaId, normalizedState.pendingRevisionId);
    const historyRows = await executor
      .select({ id: schema.mediaEditRevisions.id })
      .from(schema.mediaEditRevisions)
      .where(
        and(
          eq(schema.mediaEditRevisions.mediaId, mediaId),
          inArray(schema.mediaEditRevisions.status, ["ready", "active"]),
        ),
      )
      .orderBy(desc(schema.mediaEditRevisions.createdAt));
    const history = (
      await Promise.all(
        historyRows.map((revision) => this.#revisionView(executor, mediaId, revision.id)),
      )
    ).filter((revision): revision is MediaEditRevisionView => revision !== null);
    return {
      mediaId,
      ingestStatus: media.ingestStatus,
      publicationStatus: media.publicationStatus,
      baseOriginalVerified: original?.verified ?? false,
      state: {
        activeRevisionId: normalizedState.activeRevisionId,
        pendingRevisionId: normalizedState.pendingRevisionId,
        generation: normalizedState.generation,
        pendingStatus: pendingRevision?.status ?? null,
      },
      activeRevision,
      pendingRevision,
      history,
    };
  }

  async #revisionView(
    executor: Executor,
    mediaId: string,
    revisionId: string,
  ): Promise<MediaEditRevisionView | null> {
    const [revision] = await executor
      .select()
      .from(schema.mediaEditRevisions)
      .where(
        and(
          eq(schema.mediaEditRevisions.id, revisionId),
          eq(schema.mediaEditRevisions.mediaId, mediaId),
        ),
      )
      .limit(1);
    if (revision === undefined) return null;
    const variants = await executor
      .select()
      .from(schema.mediaEditVariants)
      .where(eq(schema.mediaEditVariants.editRevisionId, revision.id));
    return {
      id: revision.id,
      mediaId: revision.mediaId,
      status: revision.status,
      basedOnRevisionId: revision.basedOnRevisionId,
      basedOnGeneration: revision.basedOnGeneration,
      pipelineVersion: revision.pipelineVersion,
      recipeVersion: revision.recipeVersion,
      recipeJson: revision.recipeJson,
      denoiseModel: revision.denoiseModel,
      denoiseModelVersion: revision.denoiseModelVersion,
      deblurModel: revision.deblurModel,
      deblurModelVersion: revision.deblurModelVersion,
      createdAt: revision.createdAt.toISOString(),
      readyAt: revision.readyAt?.toISOString() ?? null,
      appliedAt: revision.appliedAt?.toISOString() ?? null,
      failureCode: revision.failureCode,
      variants: variants.map(variantView),
    };
  }

  async #media(executor: Executor, mediaId: string) {
    const [media] = await executor
      .select()
      .from(schema.media)
      .where(eq(schema.media.id, mediaId))
      .limit(1);
    if (media === undefined || media.publicationStatus === "deleted") throw this.#notFound();
    return media;
  }

  async #baseOriginal(executor: Executor, mediaId: string) {
    const [original] = await executor
      .select()
      .from(schema.mediaVariants)
      .where(
        and(
          eq(schema.mediaVariants.mediaId, mediaId),
          eq(schema.mediaVariants.kind, "photo_original"),
        ),
      )
      .limit(1);
    return original ?? null;
  }

  async #stateForUpdate(transaction: Transaction, mediaId: string) {
    let [state] = await transaction
      .select()
      .from(schema.mediaEditStates)
      .where(eq(schema.mediaEditStates.mediaId, mediaId))
      .limit(1);
    if (state !== undefined) return state;
    await transaction.insert(schema.mediaEditStates).values({ mediaId }).onConflictDoNothing();
    [state] = await transaction
      .select()
      .from(schema.mediaEditStates)
      .where(eq(schema.mediaEditStates.mediaId, mediaId))
      .limit(1);
    if (state === undefined) throw new Error("Media edit state insert returned no row");
    return state;
  }

  #assertExpectedState(
    state: typeof schema.mediaEditStates.$inferSelect,
    input: ApplyMediaEditRequest,
  ): void {
    if (
      state.generation !== input.expectedGeneration ||
      state.activeRevisionId !== input.expectedActiveRevisionId
    ) {
      throw this.#versionConflict();
    }
  }

  async #lock(transaction: Transaction, mediaId: string): Promise<void> {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`media:${mediaId}`}, 0))`,
    );
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
    },
  ): Promise<void> {
    await transaction.insert(schema.auditLogs).values({
      actorUserId: options.actorId,
      action: options.action,
      targetType: "media",
      targetId: options.targetId,
      result: "success",
      changedFields: options.changedFields,
      requestId: options.requestId,
    });
  }

  #assertEditAccess(actor: InternalActor, media: typeof schema.media.$inferSelect): void {
    if (hasPermission(actor.role, "media:review")) return;
    if (actor.role === "uploader" && media.uploaderId === actor.id) return;
    throw new AppError({
      code: "FORBIDDEN",
      message: "无权修改他人上传的照片",
      statusCode: 403,
    });
  }

  #versionConflict(): AppError {
    return new AppError({
      code: "EDIT_VERSION_CONFLICT",
      message: "此照片已在其他设备更新，请刷新后重试",
      statusCode: 409,
    });
  }

  #notFound(): AppError {
    return new AppError({ code: "MEDIA_NOT_FOUND", message: "媒体不存在", statusCode: 404 });
  }
}

function inArrayValue<T extends string>(value: T, values: readonly T[]): boolean {
  return values.includes(value);
}
