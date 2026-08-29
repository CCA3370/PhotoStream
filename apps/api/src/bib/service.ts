import { randomUUID } from "node:crypto";

import {
  type BibAttributeMappingInput,
  type BibAttributeOptionInput,
  type BibBatchResult,
  type BibCandidateInput,
  type BibConfigUpdate,
  type BibConfigView,
  type BibMediaState,
  type BibPatternInput,
  deriveBibAttributes,
  evaluateBibNumber,
  hasPermission,
  type InternalMediaList,
  normalizeBibCandidates,
  normalizeBibNumber,
  normalizeBibRanges,
  type UserRole,
  validateBibMappings,
  validateBibRuleSet,
} from "@photostream/contracts";
import type { Database } from "@photostream/db";
import { schema } from "@photostream/db";
import { and, asc, desc, eq, gt, inArray, lt, lte, notInArray, sql } from "drizzle-orm";

import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import {
  findOperationRequest,
  lockOperationRequest,
  saveOperationRequest,
} from "../idempotency.js";
import { liveEventChannel } from "../media/live-event-broker.js";
import type { InternalActor, PhotoService } from "../media/service.js";
import { BibCrypto } from "./crypto.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type DbExecutor = Database | Transaction;

interface BibDocument {
  readonly patterns: readonly BibPatternInput[];
  readonly attributeOptions: readonly BibAttributeOptionInput[];
  readonly mappings: readonly BibAttributeMappingInput[];
}

function requirePermission(role: UserRole, permission: Parameters<typeof hasPermission>[1]): void {
  if (!hasPermission(role, permission)) {
    throw new AppError({ code: "FORBIDDEN", message: "当前角色无权执行此操作", statusCode: 403 });
  }
}

function requireIdempotencyKey(value: string | undefined): string {
  if (value === undefined || value.length < 16 || value.length > 128) {
    throw new AppError({ code: "BAD_REQUEST", message: "缺少有效幂等键", statusCode: 400 });
  }
  return value;
}

function canonicalPatterns(patterns: readonly BibPatternInput[]): string {
  const byJson = <T>(left: T, right: T): number =>
    JSON.stringify(left).localeCompare(JSON.stringify(right));
  return JSON.stringify(
    patterns
      .filter((pattern) => pattern.enabled)
      .map((pattern) => ({
        totalLength: pattern.totalLength,
        constraints: pattern.constraints
          .map((constraint) => ({
            startPosition: constraint.startPosition,
            width: constraint.width,
            ranges: normalizeBibRanges(constraint.ranges, constraint.width).map((range) => ({
              start: range.start,
              end: range.end,
            })),
          }))
          .toSorted(byJson),
      }))
      .toSorted(byJson),
  );
}

function canonicalMappings(mappings: readonly BibAttributeMappingInput[]): string {
  return JSON.stringify(
    mappings
      .map((mapping) => ({
        dimension: mapping.dimension,
        startPosition: mapping.startPosition,
        width: mapping.width,
        outputOptionId: mapping.outputOptionId,
        ranges: normalizeBibRanges(mapping.ranges, mapping.width).map((range) => ({
          start: range.start,
          end: range.end,
        })),
      }))
      .toSorted((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  );
}

async function assertConfigIdsAvailable(
  requestedIds: readonly (string | undefined)[],
  currentIds: ReadonlySet<string>,
  findExisting: (ids: readonly string[]) => Promise<readonly { readonly id: string }[]>,
): Promise<void> {
  const supplied = requestedIds.filter((id): id is string => id !== undefined);
  if (new Set(supplied).size !== supplied.length) {
    throw new AppError({
      code: "BIB_CONFIG_INVALID",
      message: "号码配置实体 ID 不能重复",
      statusCode: 409,
    });
  }
  const newIds = supplied.filter((id) => !currentIds.has(id));
  if (newIds.length > 0 && (await findExisting(newIds)).length > 0) {
    throw new AppError({
      code: "BIB_CONFIG_INVALID",
      message: "号码配置实体 ID 已被其他配置使用",
      statusCode: 409,
    });
  }
}

export class BibService {
  readonly #database: Database;
  readonly #config: AppConfig;
  readonly #crypto: BibCrypto | null;
  readonly #photoService: PhotoService | null;

  constructor(options: {
    readonly database: Database;
    readonly config: AppConfig;
    readonly photoService?: PhotoService;
  }) {
    this.#database = options.database;
    this.#config = options.config;
    this.#crypto = BibCrypto.fromConfig(options.config);
    this.#photoService = options.photoService ?? null;
  }

  async getConfig(actor: InternalActor, albumId: string): Promise<BibConfigView> {
    requirePermission(actor.role, "album:read");
    const album = await this.#album(this.#database, albumId);
    const document = await this.#loadDocument(this.#database, albumId);
    const rule = validateBibRuleSet(document.patterns);
    const mapping = validateBibMappings(
      document.patterns,
      document.attributeOptions,
      document.mappings,
    );
    const [activeTask] = await this.#database
      .select({ status: schema.bibRecalculationTasks.status })
      .from(schema.bibRecalculationTasks)
      .where(
        and(
          eq(schema.bibRecalculationTasks.albumId, albumId),
          inArray(schema.bibRecalculationTasks.status, ["pending", "processing", "failed"]),
        ),
      )
      .orderBy(asc(schema.bibRecalculationTasks.createdAt))
      .limit(1);
    return {
      albumId,
      automationStatus: this.#config.BIB_OCR_AUTOMATION_STATUS,
      recognitionEnabled: album.bibRecognitionEnabled,
      searchEnabled: album.bibSearchEnabled,
      modelVersion: album.bibModelVersion,
      patterns: [...document.patterns],
      attributeOptions: [...document.attributeOptions],
      mappings: [...document.mappings],
      ruleVersion: album.bibRuleVersion,
      mappingVersion: album.bibMappingVersion,
      ruleUsable: rule.usable,
      mappingUsable: mapping.usable,
      recalculationStatus:
        activeTask === undefined || activeTask.status === "completed" ? "idle" : activeTask.status,
      issues: [...rule.issues, ...mapping.issues],
      updatedAt: album.updatedAt.toISOString(),
    };
  }

  async updateConfig(options: {
    readonly actor: InternalActor;
    readonly albumId: string;
    readonly input: BibConfigUpdate;
    readonly requestId: string;
  }): Promise<BibConfigView> {
    requirePermission(options.actor.role, "album:configure");
    const normalized: BibConfigUpdate = {
      ...options.input,
      patterns: options.input.patterns.map((pattern) => ({
        ...pattern,
        constraints: pattern.constraints.map((constraint) => ({
          ...constraint,
          ranges: normalizeBibRanges(constraint.ranges, constraint.width),
        })),
      })),
      mappings: options.input.mappings.map((mapping) => ({
        ...mapping,
        ranges: normalizeBibRanges(mapping.ranges, mapping.width),
      })),
    };
    const rule = validateBibRuleSet(normalized.patterns);
    const mapping = validateBibMappings(
      normalized.patterns,
      normalized.attributeOptions,
      normalized.mappings,
    );
    if ((normalized.recognitionEnabled || normalized.searchEnabled) && !rule.usable) {
      throw new AppError({
        code: "BIB_CONFIG_INVALID",
        message: "号码规则不可用，不能开启识别或搜索",
        statusCode: 409,
      });
    }
    if (normalized.recognitionEnabled && this.#config.BIB_OCR_AUTOMATION_STATUS === "disabled") {
      throw new AppError({
        code: "BIB_CONFIG_INVALID",
        message: "自动号码识别在当前发布环境中已禁用",
        statusCode: 409,
      });
    }
    if ((normalized.recognitionEnabled || normalized.searchEnabled) && !mapping.usable) {
      throw new AppError({
        code: "BIB_CONFIG_INVALID",
        message: "年级或班级映射存在冲突，不能开启号码功能",
        statusCode: 409,
      });
    }
    if ((normalized.recognitionEnabled || normalized.searchEnabled) && this.#crypto === null) {
      throw new AppError({
        code: "BIB_KEYS_UNAVAILABLE",
        message: "号码数据密钥或搜索密钥尚未配置",
        statusCode: 409,
      });
    }

    await this.#database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`bib-config:${options.albumId}`}, 0))`,
      );
      const album = await this.#album(transaction, options.albumId);
      if (normalized.searchEnabled && album.access !== "password") {
        throw new AppError({
          code: "BIB_CONFIG_INVALID",
          message: "只有口令相册可以开启号码搜索",
          statusCode: 409,
        });
      }
      const current = await this.#loadDocument(transaction, options.albumId);
      await assertConfigIdsAvailable(
        normalized.patterns.map((pattern) => pattern.id),
        new Set(
          current.patterns.flatMap((pattern) => (pattern.id === undefined ? [] : [pattern.id])),
        ),
        (ids) =>
          transaction
            .select({ id: schema.bibPatterns.id })
            .from(schema.bibPatterns)
            .where(inArray(schema.bibPatterns.id, [...ids])),
      );
      await assertConfigIdsAvailable(
        normalized.patterns.flatMap((pattern) =>
          pattern.constraints.map((constraint) => constraint.id),
        ),
        new Set(
          current.patterns.flatMap((pattern) =>
            pattern.constraints.flatMap((constraint) =>
              constraint.id === undefined ? [] : [constraint.id],
            ),
          ),
        ),
        (ids) =>
          transaction
            .select({ id: schema.bibConstraints.id })
            .from(schema.bibConstraints)
            .where(inArray(schema.bibConstraints.id, [...ids])),
      );
      await assertConfigIdsAvailable(
        normalized.patterns.flatMap((pattern) =>
          pattern.constraints.flatMap((constraint) => constraint.ranges.map((range) => range.id)),
        ),
        new Set(
          current.patterns.flatMap((pattern) =>
            pattern.constraints.flatMap((constraint) =>
              constraint.ranges.flatMap((range) => (range.id === undefined ? [] : [range.id])),
            ),
          ),
        ),
        (ids) =>
          transaction
            .select({ id: schema.bibAllowedRanges.id })
            .from(schema.bibAllowedRanges)
            .where(inArray(schema.bibAllowedRanges.id, [...ids])),
      );
      await assertConfigIdsAvailable(
        normalized.attributeOptions.map((option) => option.id),
        new Set(current.attributeOptions.map((option) => option.id)),
        (ids) =>
          transaction
            .select({ id: schema.bibAttributeOptions.id })
            .from(schema.bibAttributeOptions)
            .where(inArray(schema.bibAttributeOptions.id, [...ids])),
      );
      await assertConfigIdsAvailable(
        normalized.mappings.map((mapping) => mapping.id),
        new Set(
          current.mappings.flatMap((mapping) => (mapping.id === undefined ? [] : [mapping.id])),
        ),
        (ids) =>
          transaction
            .select({ id: schema.bibAttributeMappings.id })
            .from(schema.bibAttributeMappings)
            .where(inArray(schema.bibAttributeMappings.id, [...ids])),
      );
      await assertConfigIdsAvailable(
        normalized.mappings.flatMap((mapping) => mapping.ranges.map((range) => range.id)),
        new Set(
          current.mappings.flatMap((mapping) =>
            mapping.ranges.flatMap((range) => (range.id === undefined ? [] : [range.id])),
          ),
        ),
        (ids) =>
          transaction
            .select({ id: schema.bibAttributeMappingRanges.id })
            .from(schema.bibAttributeMappingRanges)
            .where(inArray(schema.bibAttributeMappingRanges.id, [...ids])),
      );
      const ruleChanged =
        canonicalPatterns(current.patterns) !== canonicalPatterns(normalized.patterns);
      const mappingChanged =
        canonicalMappings(current.mappings) !== canonicalMappings(normalized.mappings);
      const ruleVersion = album.bibRuleVersion + (ruleChanged ? 1 : 0);
      const mappingVersion = album.bibMappingVersion + (mappingChanged ? 1 : 0);

      await transaction
        .delete(schema.bibAttributeMappings)
        .where(eq(schema.bibAttributeMappings.albumId, options.albumId));
      await transaction
        .delete(schema.bibPatterns)
        .where(eq(schema.bibPatterns.albumId, options.albumId));

      const optionIds = normalized.attributeOptions.map((option) => option.id);
      if (optionIds.length === 0) {
        await transaction
          .update(schema.bibAttributeOptions)
          .set({ enabled: false, updatedAt: new Date() })
          .where(eq(schema.bibAttributeOptions.albumId, options.albumId));
      } else {
        await transaction
          .update(schema.bibAttributeOptions)
          .set({ enabled: false, updatedAt: new Date() })
          .where(
            and(
              eq(schema.bibAttributeOptions.albumId, options.albumId),
              notInArray(schema.bibAttributeOptions.id, optionIds),
            ),
          );
      }
      for (const option of normalized.attributeOptions) {
        const [existing] = await transaction
          .select({
            albumId: schema.bibAttributeOptions.albumId,
            dimension: schema.bibAttributeOptions.dimension,
          })
          .from(schema.bibAttributeOptions)
          .where(eq(schema.bibAttributeOptions.id, option.id))
          .limit(1);
        if (existing !== undefined && existing.albumId !== options.albumId) {
          throw new AppError({
            code: "BIB_CONFIG_INVALID",
            message: "属性选项不属于当前相册",
            statusCode: 409,
          });
        }
        if (existing !== undefined && existing.dimension !== option.dimension) {
          throw new AppError({
            code: "BIB_CONFIG_INVALID",
            message: "属性选项的内部 ID 与维度不可变",
            statusCode: 409,
          });
        }
        await transaction
          .insert(schema.bibAttributeOptions)
          .values({ ...option, albumId: options.albumId })
          .onConflictDoUpdate({
            target: schema.bibAttributeOptions.id,
            set: {
              dimension: option.dimension,
              displayName: option.displayName,
              sortOrder: option.sortOrder,
              enabled: option.enabled,
              updatedAt: new Date(),
            },
          });
      }

      for (const pattern of normalized.patterns) {
        const patternId = pattern.id ?? randomUUID();
        await transaction.insert(schema.bibPatterns).values({
          id: patternId,
          albumId: options.albumId,
          totalLength: pattern.totalLength,
          sortOrder: pattern.sortOrder,
          enabled: pattern.enabled,
        });
        for (const constraint of pattern.constraints) {
          const [created] = await transaction
            .insert(schema.bibConstraints)
            .values({
              id: constraint.id ?? randomUUID(),
              patternId,
              startPosition: constraint.startPosition,
              width: constraint.width,
              sortOrder: constraint.sortOrder,
            })
            .returning({ id: schema.bibConstraints.id });
          if (created === undefined) throw new Error("Bib constraint insert returned no row");
          await transaction.insert(schema.bibAllowedRanges).values(
            constraint.ranges.map((range, index) => ({
              id: range.id ?? randomUUID(),
              constraintId: created.id,
              startValue: range.start,
              endValue: range.end,
              sortOrder: index,
            })),
          );
        }
      }

      for (const mappingInput of normalized.mappings) {
        const mappingId = mappingInput.id ?? randomUUID();
        await transaction.insert(schema.bibAttributeMappings).values({
          id: mappingId,
          albumId: options.albumId,
          dimension: mappingInput.dimension,
          startPosition: mappingInput.startPosition,
          width: mappingInput.width,
          outputOptionId: mappingInput.outputOptionId,
          sortOrder: mappingInput.sortOrder,
        });
        await transaction.insert(schema.bibAttributeMappingRanges).values(
          mappingInput.ranges.map((range, index) => ({
            id: range.id ?? randomUUID(),
            mappingId,
            startValue: range.start,
            endValue: range.end,
            sortOrder: index,
          })),
        );
      }

      await transaction
        .update(schema.albums)
        .set({
          bibRecognitionEnabled: normalized.recognitionEnabled,
          bibSearchEnabled: normalized.searchEnabled,
          bibModelVersion: normalized.modelVersion,
          bibRuleVersion: ruleVersion,
          bibMappingVersion: mappingVersion,
          bibRuleUsable: rule.usable,
          bibMappingUsable: mapping.usable,
          updatedAt: new Date(),
        })
        .where(eq(schema.albums.id, options.albumId));

      if (ruleChanged) {
        await transaction.insert(schema.bibRecalculationTasks).values({
          albumId: options.albumId,
          kind: "rule",
          targetVersion: ruleVersion,
        });
      }
      if (mappingChanged) {
        await transaction.insert(schema.bibRecalculationTasks).values({
          albumId: options.albumId,
          kind: "mapping",
          targetVersion: mappingVersion,
        });
      }
      await transaction
        .update(schema.bibRecalculationTasks)
        .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(schema.bibRecalculationTasks.albumId, options.albumId),
            inArray(schema.bibRecalculationTasks.status, ["pending", "processing", "failed"]),
            sql`((${schema.bibRecalculationTasks.kind} = 'rule' and ${schema.bibRecalculationTasks.targetVersion} < ${ruleVersion}) or (${schema.bibRecalculationTasks.kind} = 'mapping' and ${schema.bibRecalculationTasks.targetVersion} < ${mappingVersion}))`,
          ),
        );
      await transaction.insert(schema.auditLogs).values({
        actorUserId: options.actor.id,
        action: "album.bib.config.updated",
        targetType: "album",
        targetId: options.albumId,
        result: "success",
        changedFields: [
          "bibRecognitionEnabled",
          "bibSearchEnabled",
          "bibModelVersion",
          ...(ruleChanged ? ["bibRuleVersion"] : []),
          ...(mappingChanged ? ["bibMappingVersion"] : []),
        ],
        requestId: options.requestId,
      });
    });
    return this.getConfig(options.actor, options.albumId);
  }

  async testNumber(actor: InternalActor, albumId: string, number: string) {
    requirePermission(actor.role, "album:read");
    await this.#album(this.#database, albumId);
    const document = await this.#loadDocument(this.#database, albumId);
    const evaluation = evaluateBibNumber(number, document.patterns);
    const attributes = evaluation.valid
      ? deriveBibAttributes(number, document.mappings)
      : { gradeOptionId: null, classOptionId: null, matchedMappingIds: [] };
    return {
      normalizedNumber: number,
      ...evaluation,
      ...attributes,
      matchedMappingIds: [...attributes.matchedMappingIds],
    };
  }

  async getMediaState(actor: InternalActor, mediaId: string): Promise<BibMediaState> {
    await this.#mediaForActor(this.#database, actor, mediaId);
    return this.#mediaState(this.#database, mediaId);
  }

  async attachMediaStates(
    actor: InternalActor,
    media: InternalMediaList,
  ): Promise<InternalMediaList> {
    for (const item of media.items) await this.#mediaForActor(this.#database, actor, item.id);
    const states = await this.#mediaStates(
      this.#database,
      media.items.map((item) => item.id),
    );
    return {
      ...media,
      items: media.items.map((item) => ({
        ...item,
        bib: states.get(item.id) ?? this.#emptyMediaState(item.id),
      })),
    };
  }

  async submitCandidates(options: {
    readonly actor: InternalActor;
    readonly mediaId: string;
    readonly candidates: readonly BibCandidateInput[];
    readonly activityStatus: "processing" | "completed" | "failed" | "unsupported";
    readonly modelVersion: string;
    readonly ruleVersion: number;
    readonly idempotencyKey: string | undefined;
    readonly requestId: string;
  }): Promise<BibMediaState> {
    const idempotencyKey = requireIdempotencyKey(options.idempotencyKey);
    const requestHash = this.cryptoOrThrow().requestHash({
      mediaId: options.mediaId,
      activityStatus: options.activityStatus,
      modelVersion: options.modelVersion,
      ruleVersion: options.ruleVersion,
      candidates: options.candidates,
    });
    await this.#database.transaction(async (transaction) => {
      const actorScope = `user:${options.actor.id}`;
      const operation = `bib.candidates.submit:${options.mediaId}`;
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
      const media = await this.#lockedMediaForActor(transaction, options.actor, options.mediaId);
      const album = await this.#album(transaction, media.albumId);
      if (!album.bibRecognitionEnabled || !album.bibRuleUsable) {
        throw new AppError({
          code: "BIB_CONFIG_INVALID",
          message: "该相册未开启可用的号码识别",
          statusCode: 409,
        });
      }
      if (options.modelVersion !== album.bibModelVersion) throw this.#modelVersionMismatch();
      if (options.ruleVersion !== album.bibRuleVersion) throw this.#ruleVersionMismatch();
      if (options.activityStatus !== "completed" && options.candidates.length > 0) {
        throw new AppError({
          code: "BAD_REQUEST",
          message: "只有已完成的 OCR 活动可以携带候选",
          statusCode: 400,
        });
      }
      const bibCrypto = this.cryptoOrThrow();
      const document = await this.#loadDocument(transaction, media.albumId);
      const candidates =
        options.activityStatus === "completed"
          ? normalizeBibCandidates(options.candidates, document.patterns)
          : [];
      await this.#ensureReview(transaction, media.id);
      await transaction
        .update(schema.mediaBibReviews)
        .set({
          ocrStatus: options.activityStatus,
          ocrModelVersion: options.modelVersion,
          ocrErrorCode:
            options.activityStatus === "processing" || options.activityStatus === "completed"
              ? null
              : options.activityStatus === "failed"
                ? "OCR_FAILED"
                : "OCR_UNSUPPORTED",
          reason:
            options.activityStatus === "processing"
              ? "ocr_processing"
              : options.activityStatus === "completed"
                ? candidates.length === 0
                  ? "ocr_no_candidates"
                  : "ocr_candidates_submitted"
                : options.activityStatus === "failed"
                  ? "ocr_failed"
                  : "ocr_unsupported",
          updatedAt: new Date(),
        })
        .where(eq(schema.mediaBibReviews.mediaId, media.id));
      const [review] = await transaction
        .select({ decision: schema.mediaBibReviews.decision })
        .from(schema.mediaBibReviews)
        .where(eq(schema.mediaBibReviews.mediaId, media.id))
        .limit(1);
      const tagIds: string[] = [];
      if (review?.decision !== "no_number_confirmed") {
        for (const candidate of candidates) {
          const blindIndex = bibCrypto.blindIndex(media.albumId, candidate.number);
          const [existing] = await transaction
            .select({ id: schema.mediaBibTags.id })
            .from(schema.mediaBibTags)
            .where(
              and(
                eq(schema.mediaBibTags.mediaId, media.id),
                eq(schema.mediaBibTags.blindIndex, blindIndex),
                inArray(schema.mediaBibTags.status, ["suggested", "confirmed", "needs_review"]),
              ),
            )
            .limit(1);
          if (existing !== undefined) {
            tagIds.push(existing.id);
            continue;
          }
          const tagId = randomUUID();
          const encrypted = bibCrypto.encrypt({
            albumId: media.albumId,
            mediaId: media.id,
            tagId,
            number: candidate.number,
          });
          await transaction.insert(schema.mediaBibTags).values({
            id: tagId,
            albumId: media.albumId,
            mediaId: media.id,
            numberCiphertext: encrypted.ciphertext,
            numberIv: encrypted.iv,
            numberAuthTag: encrypted.authTag,
            blindIndex: encrypted.blindIndex,
            keyVersion: encrypted.keyVersion,
            status: "suggested",
            source: "ocr",
            confidenceBasisPoints: Math.round(candidate.confidence * 10_000),
            quadrilateral: candidate.quadrilateral,
            ruleVersion: album.bibRuleVersion,
            modelVersion: candidate.modelVersion,
            mappingVersion: album.bibMappingVersion,
            createdBy: options.actor.id,
          });
          tagIds.push(tagId);
        }
      }
      await this.#audit(transaction, {
        actorId: options.actor.id,
        action:
          options.activityStatus === "completed"
            ? "media.bib.candidates.submitted"
            : "media.bib.ocr.status.updated",
        mediaId: media.id,
        changedFields:
          options.activityStatus === "completed"
            ? ["ocrStatus", "candidateCount"]
            : ["ocrStatus", "ocrErrorCode"],
        requestId: options.requestId,
      });
      await saveOperationRequest(transaction, {
        actorScope,
        operation,
        idempotencyKey,
        requestHash,
        result: { tagIds, acceptedCount: tagIds.length },
      });
    });
    return this.getMediaState(options.actor, options.mediaId);
  }

  async expireStaleOcrActivities(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - 30 * 60 * 1_000);
    return this.#database.transaction(async (transaction) => {
      const expired = await transaction
        .update(schema.mediaBibReviews)
        .set({
          ocrStatus: "failed",
          ocrErrorCode: "OCR_INTERRUPTED",
          reason: "ocr_interrupted",
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.mediaBibReviews.ocrStatus, "processing"),
            lt(schema.mediaBibReviews.updatedAt, cutoff),
          ),
        )
        .returning({ mediaId: schema.mediaBibReviews.mediaId });
      if (expired.length > 0) {
        await transaction.insert(schema.auditLogs).values(
          expired.map(({ mediaId }) => ({
            actorUserId: null,
            action: "media.bib.ocr.interrupted",
            targetType: "media",
            targetId: mediaId,
            result: "failed",
            changedFields: ["ocrStatus", "ocrErrorCode"],
            requestId: `bib-ocr-expired:${mediaId}:${now.getTime()}`,
          })),
        );
      }
      return expired.length;
    });
  }

  async addManualTag(options: {
    readonly actor: InternalActor;
    readonly mediaId: string;
    readonly number: string;
    readonly idempotencyKey: string | undefined;
    readonly requestId: string;
  }): Promise<BibMediaState> {
    const number = normalizeBibNumber(options.number);
    if (number === null) throw this.#invalidNumber();
    const idempotencyKey = requireIdempotencyKey(options.idempotencyKey);
    const requestHash = this.cryptoOrThrow().requestHash({ mediaId: options.mediaId, number });
    await this.#database.transaction(async (transaction) => {
      const actorScope = `user:${options.actor.id}`;
      const operation = `bib.tag.add:${options.mediaId}`;
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
      const media = await this.#lockedMediaForActor(transaction, options.actor, options.mediaId);
      const tagId = await this.#confirmNumberInTransaction(transaction, {
        actor: options.actor,
        media,
        number,
        source: "manual",
      });
      await this.#event(transaction, media.albumId, media.id);
      await this.#audit(transaction, {
        actorId: options.actor.id,
        action: "media.bib.tag.added",
        mediaId: media.id,
        changedFields: ["bibTag", "bibReviewDecision"],
        requestId: options.requestId,
      });
      await saveOperationRequest(transaction, {
        actorScope,
        operation,
        idempotencyKey,
        requestHash,
        result: { tagId },
      });
    });
    return this.getMediaState(options.actor, options.mediaId);
  }

  async confirmTag(options: {
    readonly actor: InternalActor;
    readonly mediaId: string;
    readonly tagId: string;
    readonly correctedNumber: string | undefined;
    readonly idempotencyKey: string | undefined;
    readonly requestId: string;
  }): Promise<BibMediaState> {
    const idempotencyKey = requireIdempotencyKey(options.idempotencyKey);
    const corrected =
      options.correctedNumber === undefined
        ? undefined
        : normalizeBibNumber(options.correctedNumber);
    if (options.correctedNumber !== undefined && corrected === null) throw this.#invalidNumber();
    const requestHash = this.cryptoOrThrow().requestHash({
      mediaId: options.mediaId,
      tagId: options.tagId,
      corrected,
    });
    await this.#database.transaction(async (transaction) => {
      const actorScope = `user:${options.actor.id}`;
      const operation = `bib.tag.confirm:${options.tagId}`;
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
      const media = await this.#lockedMediaForActor(transaction, options.actor, options.mediaId);
      const [tag] = await transaction
        .select()
        .from(schema.mediaBibTags)
        .where(
          and(eq(schema.mediaBibTags.id, options.tagId), eq(schema.mediaBibTags.mediaId, media.id)),
        )
        .limit(1);
      if (tag === undefined) throw this.#tagNotFound();
      if (tag.status === "rejected") {
        throw new AppError({
          code: "STATE_CONFLICT",
          message: "已拒绝候选不能直接确认",
          statusCode: 409,
        });
      }
      const original = this.cryptoOrThrow().decrypt({
        albumId: tag.albumId,
        mediaId: tag.mediaId,
        tagId: tag.id,
        ciphertext: tag.numberCiphertext,
        iv: tag.numberIv,
        authTag: tag.numberAuthTag,
        keyVersion: tag.keyVersion,
      });
      const number = corrected ?? original;
      let resultingTagId = tag.id;
      if (number !== original) {
        await transaction
          .update(schema.mediaBibTags)
          .set({ status: "rejected", updatedAt: new Date() })
          .where(eq(schema.mediaBibTags.id, tag.id));
        resultingTagId = await this.#confirmNumberInTransaction(transaction, {
          actor: options.actor,
          media,
          number,
          source: "manual",
        });
      } else {
        await this.#confirmExistingTag(transaction, options.actor, media, tag, number);
      }
      await this.#event(transaction, media.albumId, media.id);
      await this.#audit(transaction, {
        actorId: options.actor.id,
        action: number === original ? "media.bib.tag.confirmed" : "media.bib.tag.corrected",
        mediaId: media.id,
        changedFields: ["bibTagStatus", "bibReviewDecision"],
        requestId: options.requestId,
      });
      if (number !== original) {
        await transaction.insert(schema.auditLogs).values([
          {
            actorUserId: options.actor.id,
            action: "media.bib.tag.corrected_from",
            targetType: "bib_tag",
            targetId: tag.id,
            result: "success",
            changedFields: ["status"],
            requestId: options.requestId,
          },
          {
            actorUserId: options.actor.id,
            action: "media.bib.tag.corrected_to",
            targetType: "bib_tag",
            targetId: resultingTagId,
            result: "success",
            changedFields: ["status", "source", "derivedAttributes"],
            requestId: options.requestId,
          },
        ]);
      }
      await saveOperationRequest(transaction, {
        actorScope,
        operation,
        idempotencyKey,
        requestHash,
        result: {
          tagId: resultingTagId,
          ...(number === original ? {} : { correctedFromTagId: tag.id }),
        },
      });
    });
    return this.getMediaState(options.actor, options.mediaId);
  }

  async rejectTag(options: {
    readonly actor: InternalActor;
    readonly mediaId: string;
    readonly tagId: string;
    readonly idempotencyKey: string | undefined;
    readonly requestId: string;
  }): Promise<BibMediaState> {
    const idempotencyKey = requireIdempotencyKey(options.idempotencyKey);
    const requestHash = this.cryptoOrThrow().requestHash({
      mediaId: options.mediaId,
      tagId: options.tagId,
    });
    await this.#database.transaction(async (transaction) => {
      const actorScope = `user:${options.actor.id}`;
      const operation = `bib.tag.reject:${options.tagId}`;
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
      const media = await this.#lockedMediaForActor(transaction, options.actor, options.mediaId);
      const [tag] = await transaction
        .select()
        .from(schema.mediaBibTags)
        .where(
          and(eq(schema.mediaBibTags.id, options.tagId), eq(schema.mediaBibTags.mediaId, media.id)),
        )
        .limit(1);
      if (tag === undefined) throw this.#tagNotFound();
      if (tag.status === "confirmed") {
        throw new AppError({
          code: "STATE_CONFLICT",
          message: "已确认号码请使用删除操作",
          statusCode: 409,
        });
      }
      if (tag.status !== "rejected") {
        await transaction
          .update(schema.mediaBibTags)
          .set({ status: "rejected", updatedAt: new Date() })
          .where(eq(schema.mediaBibTags.id, tag.id));
        await this.#event(transaction, media.albumId, media.id);
        await this.#audit(transaction, {
          actorId: options.actor.id,
          action: "media.bib.tag.rejected",
          mediaId: media.id,
          changedFields: ["bibTagStatus"],
          requestId: options.requestId,
        });
      }
      await saveOperationRequest(transaction, {
        actorScope,
        operation,
        idempotencyKey,
        requestHash,
        result: { mediaId: media.id, tagId: tag.id },
      });
    });
    return this.getMediaState(options.actor, options.mediaId);
  }

  async deleteTag(options: {
    readonly actor: InternalActor;
    readonly mediaId: string;
    readonly tagId: string;
    readonly idempotencyKey: string | undefined;
    readonly requestId: string;
  }): Promise<BibMediaState> {
    const idempotencyKey = requireIdempotencyKey(options.idempotencyKey);
    const requestHash = this.cryptoOrThrow().requestHash({
      mediaId: options.mediaId,
      tagId: options.tagId,
    });
    await this.#database.transaction(async (transaction) => {
      const actorScope = `user:${options.actor.id}`;
      const operation = `bib.tag.delete:${options.tagId}`;
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
      const media = await this.#lockedMediaForActor(transaction, options.actor, options.mediaId);
      const [tag] = await transaction
        .delete(schema.mediaBibTags)
        .where(
          and(eq(schema.mediaBibTags.id, options.tagId), eq(schema.mediaBibTags.mediaId, media.id)),
        )
        .returning({ status: schema.mediaBibTags.status });
      if (tag === undefined) throw this.#tagNotFound();
      if (tag.status === "confirmed") {
        await this.#refreshReviewDecision(
          transaction,
          media.id,
          options.actor.id,
          "last_tag_deleted",
        );
      }
      await this.#event(transaction, media.albumId, media.id);
      await this.#audit(transaction, {
        actorId: options.actor.id,
        action: "media.bib.tag.deleted",
        mediaId: media.id,
        changedFields: ["bibTag", "bibReviewDecision"],
        requestId: options.requestId,
      });
      await saveOperationRequest(transaction, {
        actorScope,
        operation,
        idempotencyKey,
        requestHash,
        result: { mediaId: media.id, tagId: options.tagId },
      });
    });
    return this.getMediaState(options.actor, options.mediaId);
  }

  async confirmNoNumber(options: {
    readonly actor: InternalActor;
    readonly mediaId: string;
    readonly idempotencyKey: string | undefined;
    readonly requestId: string;
  }): Promise<BibMediaState> {
    const idempotencyKey = requireIdempotencyKey(options.idempotencyKey);
    const requestHash = this.cryptoOrThrow().requestHash({ mediaId: options.mediaId });
    await this.#database.transaction(async (transaction) => {
      const actorScope = `user:${options.actor.id}`;
      const operation = `bib.review.no-number:${options.mediaId}`;
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
      const media = await this.#lockedMediaForActor(transaction, options.actor, options.mediaId);
      await this.#confirmNoNumberInTransaction(transaction, options.actor, media);
      await this.#event(transaction, media.albumId, media.id);
      await this.#audit(transaction, {
        actorId: options.actor.id,
        action: "media.bib.no_number.confirmed",
        mediaId: media.id,
        changedFields: ["bibTagStatus", "bibReviewDecision"],
        requestId: options.requestId,
      });
      await saveOperationRequest(transaction, {
        actorScope,
        operation,
        idempotencyKey,
        requestHash,
        result: { mediaId: media.id },
      });
    });
    return this.getMediaState(options.actor, options.mediaId);
  }

  async resetReview(options: {
    readonly actor: InternalActor;
    readonly mediaId: string;
    readonly idempotencyKey: string | undefined;
    readonly requestId: string;
  }): Promise<BibMediaState> {
    const idempotencyKey = requireIdempotencyKey(options.idempotencyKey);
    const requestHash = this.cryptoOrThrow().requestHash({ mediaId: options.mediaId });
    await this.#database.transaction(async (transaction) => {
      const actorScope = `user:${options.actor.id}`;
      const operation = `bib.review.reset:${options.mediaId}`;
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
      const media = await this.#lockedMediaForActor(transaction, options.actor, options.mediaId);
      await this.#ensureReview(transaction, media.id);
      const [confirmed] = await transaction
        .select({ id: schema.mediaBibTags.id })
        .from(schema.mediaBibTags)
        .where(
          and(
            eq(schema.mediaBibTags.mediaId, media.id),
            eq(schema.mediaBibTags.status, "confirmed"),
          ),
        )
        .limit(1);
      await transaction
        .update(schema.mediaBibReviews)
        .set({
          decision: confirmed === undefined ? "pending" : "numbers_confirmed",
          decidedBy: options.actor.id,
          decidedAt: new Date(),
          reason: "manual_reset",
          updatedAt: new Date(),
        })
        .where(eq(schema.mediaBibReviews.mediaId, media.id));
      await this.#event(transaction, media.albumId, media.id);
      await this.#audit(transaction, {
        actorId: options.actor.id,
        action: "media.bib.review.reset",
        mediaId: media.id,
        changedFields: ["bibReviewDecision"],
        requestId: options.requestId,
      });
      await saveOperationRequest(transaction, {
        actorScope,
        operation,
        idempotencyKey,
        requestHash,
        result: { mediaId: media.id },
      });
    });
    return this.getMediaState(options.actor, options.mediaId);
  }

  async addManualTagBatch(options: {
    readonly actor: InternalActor;
    readonly mediaIds: readonly string[];
    readonly number: string;
    readonly idempotencyKey: string | undefined;
    readonly requestId: string;
  }): Promise<BibBatchResult> {
    requirePermission(options.actor.role, "bib:any");
    const number = normalizeBibNumber(options.number);
    if (number === null) throw this.#invalidNumber();
    const idempotencyKey = requireIdempotencyKey(options.idempotencyKey);
    const requestHash = this.cryptoOrThrow().requestHash({ mediaIds: options.mediaIds, number });
    return this.#database.transaction(async (transaction) => {
      const actorScope = `user:${options.actor.id}`;
      const operation = "bib.batch.add";
      await lockOperationRequest(transaction, { actorScope, operation, idempotencyKey });
      const retried = await findOperationRequest(transaction, {
        actorScope,
        operation,
        idempotencyKey,
        requestHash,
      });
      if (retried !== null) return retried as BibBatchResult;
      await this.#lockMediaIds(transaction, options.mediaIds);
      const byId = new Map<string, BibBatchResult["items"][number]>();
      for (const mediaId of options.mediaIds) {
        try {
          const media = await this.#mediaForActor(transaction, options.actor, mediaId);
          await this.#confirmNumberInTransaction(transaction, {
            actor: options.actor,
            media,
            number,
            source: "manual",
          });
          await this.#event(transaction, media.albumId, media.id);
          await this.#audit(transaction, {
            actorId: options.actor.id,
            action: "media.bib.tag.added",
            mediaId,
            changedFields: ["bibTag", "bibReviewDecision"],
            requestId: options.requestId,
          });
          byId.set(mediaId, { mediaId, ok: true, code: null, message: null });
        } catch (error) {
          if (!(error instanceof AppError)) throw error;
          byId.set(mediaId, {
            mediaId,
            ok: false,
            code: error.code,
            message: error.message,
          });
        }
      }
      const result: BibBatchResult = {
        items: options.mediaIds.map(
          (mediaId) =>
            byId.get(mediaId) ?? {
              mediaId,
              ok: false,
              code: "INTERNAL_ERROR",
              message: "批量操作未完成",
            },
        ),
      };
      await saveOperationRequest(transaction, {
        actorScope,
        operation,
        idempotencyKey,
        requestHash,
        result,
      });
      return result;
    });
  }

  async confirmNoNumberBatch(options: {
    readonly actor: InternalActor;
    readonly mediaIds: readonly string[];
    readonly idempotencyKey: string | undefined;
    readonly requestId: string;
  }): Promise<BibBatchResult> {
    requirePermission(options.actor.role, "bib:any");
    const idempotencyKey = requireIdempotencyKey(options.idempotencyKey);
    const requestHash = this.cryptoOrThrow().requestHash({ mediaIds: options.mediaIds });
    return this.#database.transaction(async (transaction) => {
      const actorScope = `user:${options.actor.id}`;
      const operation = "bib.batch.no-number";
      await lockOperationRequest(transaction, { actorScope, operation, idempotencyKey });
      const retried = await findOperationRequest(transaction, {
        actorScope,
        operation,
        idempotencyKey,
        requestHash,
      });
      if (retried !== null) return retried as BibBatchResult;
      await this.#lockMediaIds(transaction, options.mediaIds);
      const byId = new Map<string, BibBatchResult["items"][number]>();
      for (const mediaId of options.mediaIds) {
        try {
          const media = await this.#mediaForActor(transaction, options.actor, mediaId);
          await this.#confirmNoNumberInTransaction(transaction, options.actor, media);
          await this.#event(transaction, media.albumId, media.id);
          await this.#audit(transaction, {
            actorId: options.actor.id,
            action: "media.bib.no_number.confirmed",
            mediaId,
            changedFields: ["bibTagStatus", "bibReviewDecision"],
            requestId: options.requestId,
          });
          byId.set(mediaId, { mediaId, ok: true, code: null, message: null });
        } catch (error) {
          if (!(error instanceof AppError)) throw error;
          byId.set(mediaId, {
            mediaId,
            ok: false,
            code: error.code,
            message: error.message,
          });
        }
      }
      const result: BibBatchResult = {
        items: options.mediaIds.map(
          (mediaId) =>
            byId.get(mediaId) ?? {
              mediaId,
              ok: false,
              code: "INTERNAL_ERROR",
              message: "批量操作未完成",
            },
        ),
      };
      await saveOperationRequest(transaction, {
        actorScope,
        operation,
        idempotencyKey,
        requestHash,
        result,
      });
      return result;
    });
  }

  async processPendingRecalculations(limit = 5, now = new Date()): Promise<number> {
    const tasks = await this.#database
      .select({ id: schema.bibRecalculationTasks.id })
      .from(schema.bibRecalculationTasks)
      .where(
        and(
          inArray(schema.bibRecalculationTasks.status, ["pending", "processing", "failed"]),
          lte(schema.bibRecalculationTasks.nextAttemptAt, now),
        ),
      )
      .orderBy(
        asc(schema.bibRecalculationTasks.nextAttemptAt),
        asc(schema.bibRecalculationTasks.id),
      )
      .limit(limit);
    for (const task of tasks) await this.processRecalculationTask(task.id, now);
    return tasks.length;
  }

  async processRecalculationTask(taskId: string, now = new Date()): Promise<void> {
    const claimed = await this.#database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`bib-recalculation:${taskId}`}, 0))`,
      );
      const [task] = await transaction
        .select()
        .from(schema.bibRecalculationTasks)
        .where(eq(schema.bibRecalculationTasks.id, taskId))
        .limit(1);
      if (
        task === undefined ||
        task.status === "completed" ||
        (task.status === "processing" && task.nextAttemptAt > now) ||
        ((task.status === "pending" || task.status === "failed") && task.nextAttemptAt > now)
      ) {
        return null;
      }
      const album = await this.#album(transaction, task.albumId);
      const currentVersion = task.kind === "rule" ? album.bibRuleVersion : album.bibMappingVersion;
      if (task.targetVersion !== currentVersion) {
        await transaction
          .update(schema.bibRecalculationTasks)
          .set({ status: "completed", completedAt: now, updatedAt: now })
          .where(eq(schema.bibRecalculationTasks.id, task.id));
        return null;
      }
      const [updated] = await transaction
        .update(schema.bibRecalculationTasks)
        .set({
          status: "processing",
          attempts: task.attempts + 1,
          lastErrorCode: null,
          nextAttemptAt: new Date(now.getTime() + 5 * 60 * 1_000),
          updatedAt: now,
        })
        .where(eq(schema.bibRecalculationTasks.id, task.id))
        .returning();
      return updated ?? null;
    });
    if (claimed === null) return;
    try {
      const album = await this.#album(this.#database, claimed.albumId);
      const document = await this.#loadDocument(this.#database, claimed.albumId);
      const tagConditions = [
        eq(schema.mediaBibTags.albumId, claimed.albumId),
        ...(claimed.kind === "rule"
          ? [inArray(schema.mediaBibTags.status, ["suggested", "confirmed"])]
          : [eq(schema.mediaBibTags.status, "confirmed")]),
        ...(claimed.cursorTagId === null ? [] : [gt(schema.mediaBibTags.id, claimed.cursorTagId)]),
      ];
      const tags = await this.#database
        .select()
        .from(schema.mediaBibTags)
        .where(and(...tagConditions))
        .orderBy(asc(schema.mediaBibTags.id))
        .limit(200);
      const changedMedia = new Set<string>();
      await this.#database.transaction(async (transaction) => {
        for (const tag of tags) {
          const number = this.cryptoOrThrow().decrypt({
            albumId: tag.albumId,
            mediaId: tag.mediaId,
            tagId: tag.id,
            ciphertext: tag.numberCiphertext,
            iv: tag.numberIv,
            authTag: tag.numberAuthTag,
            keyVersion: tag.keyVersion,
          });
          if (claimed.kind === "rule") {
            const valid = evaluateBibNumber(number, document.patterns).valid;
            await transaction
              .update(schema.mediaBibTags)
              .set({
                status: valid ? tag.status : "needs_review",
                ruleVersion: valid ? album.bibRuleVersion : tag.ruleVersion,
                ...(valid ? {} : { gradeOptionId: null, classOptionId: null, mappingVersion: 0 }),
                updatedAt: new Date(),
              })
              .where(eq(schema.mediaBibTags.id, tag.id));
            if (!valid && tag.status === "confirmed") {
              await this.#ensureReview(transaction, tag.mediaId);
              await transaction
                .update(schema.mediaBibReviews)
                .set({
                  decision: "needs_review",
                  decidedBy: null,
                  decidedAt: new Date(),
                  reason: "rule_changed",
                  updatedAt: new Date(),
                })
                .where(eq(schema.mediaBibReviews.mediaId, tag.mediaId));
            }
          } else {
            const attributes = deriveBibAttributes(number, document.mappings);
            await transaction
              .update(schema.mediaBibTags)
              .set({
                gradeOptionId: attributes.gradeOptionId,
                classOptionId: attributes.classOptionId,
                mappingVersion: album.bibMappingVersion,
                updatedAt: new Date(),
              })
              .where(eq(schema.mediaBibTags.id, tag.id));
          }
          changedMedia.add(tag.mediaId);
        }
        for (const mediaId of changedMedia)
          await this.#event(transaction, claimed.albumId, mediaId);
        const last = tags.at(-1);
        const completed = tags.length < 200;
        await transaction
          .update(schema.bibRecalculationTasks)
          .set({
            status: completed ? "completed" : "pending",
            cursorTagId: last?.id ?? claimed.cursorTagId,
            nextAttemptAt: now,
            completedAt: completed ? new Date() : null,
            updatedAt: new Date(),
          })
          .where(eq(schema.bibRecalculationTasks.id, claimed.id));
      });
    } catch {
      const delay = Math.min(60 * 60 * 1_000, 60_000 * 2 ** Math.min(claimed.attempts, 6));
      await this.#database.transaction(async (transaction) => {
        await transaction
          .update(schema.bibRecalculationTasks)
          .set({
            status: "failed",
            lastErrorCode: "BIB_RECALCULATION_FAILED",
            nextAttemptAt: new Date(now.getTime() + delay),
            updatedAt: new Date(),
          })
          .where(eq(schema.bibRecalculationTasks.id, claimed.id));
        await transaction.insert(schema.auditLogs).values({
          actorUserId: null,
          action: "album.bib.recalculation.failed",
          targetType: "album",
          targetId: claimed.albumId,
          result: "failed",
          changedFields: ["status", "lastErrorCode"],
          requestId: `bib-recalculation:${claimed.id}:${claimed.attempts}`,
        });
      });
    }
  }

  async cleanupStaleCandidates(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000);
    const albums = await this.#database
      .select({ id: schema.albums.id })
      .from(schema.albums)
      .where(
        and(
          inArray(schema.albums.state, ["ended", "archived"]),
          lt(schema.albums.updatedAt, cutoff),
        ),
      );
    if (albums.length === 0) return 0;
    const deleted = await this.#database
      .delete(schema.mediaBibTags)
      .where(
        and(
          inArray(
            schema.mediaBibTags.albumId,
            albums.map((album) => album.id),
          ),
          inArray(schema.mediaBibTags.status, ["suggested", "rejected", "needs_review"]),
        ),
      )
      .returning({ id: schema.mediaBibTags.id });
    return deleted.length;
  }

  async searchPublic(options: {
    readonly slug: string;
    readonly visitorToken: string | undefined;
    readonly number: string;
    readonly cursor: string | undefined;
  }) {
    const number = normalizeBibNumber(options.number);
    if (number === null) throw this.#publicSearchUnavailable();
    const photoService = this.#photoServiceOrThrow();
    const album = await photoService.getAuthorizedPublicAlbum(options.slug, options.visitorToken, {
      requirePassword: true,
    });
    if (!album.bibSearchEnabled || !album.bibRuleUsable) throw this.#publicSearchUnavailable();
    const document = await this.#loadDocument(this.#database, album.id);
    if (!evaluateBibNumber(number, document.patterns).valid) throw this.#publicSearchUnavailable();
    const blindIndex = this.cryptoOrThrow().blindIndex(album.id, number);
    const matches = await this.#database
      .selectDistinct({ mediaId: schema.mediaBibTags.mediaId })
      .from(schema.mediaBibTags)
      .innerJoin(schema.media, eq(schema.mediaBibTags.mediaId, schema.media.id))
      .where(
        and(
          eq(schema.mediaBibTags.albumId, album.id),
          eq(schema.mediaBibTags.blindIndex, blindIndex),
          eq(schema.mediaBibTags.status, "confirmed"),
          eq(schema.mediaBibTags.ruleVersion, album.bibRuleVersion),
          eq(schema.media.publicationStatus, "published"),
        ),
      );
    return photoService.listPublicMedia({
      slug: options.slug,
      visitorToken: options.visitorToken,
      cursor: options.cursor,
      categoryId: undefined,
      limit: 60,
      mediaIds: matches.map((match) => match.mediaId),
    });
  }

  async filterPublicAttributes(options: {
    readonly slug: string;
    readonly visitorToken: string | undefined;
    readonly gradeOptionId: string;
    readonly classOptionId: string | undefined;
    readonly categoryId: string | undefined;
    readonly cursor: string | undefined;
  }) {
    const photoService = this.#photoServiceOrThrow();
    const album = await photoService.getAuthorizedPublicAlbum(options.slug, options.visitorToken, {
      requirePassword: true,
    });
    if (!album.bibSearchEnabled || !album.bibRuleUsable || !album.bibMappingUsable) {
      throw this.#publicSearchUnavailable();
    }
    const optionIds = [options.gradeOptionId, options.classOptionId].filter(
      (value): value is string => value !== undefined,
    );
    const selectedOptions = await this.#database
      .select()
      .from(schema.bibAttributeOptions)
      .where(
        and(
          eq(schema.bibAttributeOptions.albumId, album.id),
          eq(schema.bibAttributeOptions.enabled, true),
          inArray(schema.bibAttributeOptions.id, optionIds),
        ),
      );
    const grade = selectedOptions.find(
      (option) => option.id === options.gradeOptionId && option.dimension === "grade",
    );
    const classOption =
      options.classOptionId === undefined
        ? undefined
        : selectedOptions.find(
            (option) => option.id === options.classOptionId && option.dimension === "class",
          );
    if (grade === undefined || (options.classOptionId !== undefined && classOption === undefined)) {
      throw this.#publicSearchUnavailable();
    }
    const [activeTask] = await this.#database
      .select({ id: schema.bibRecalculationTasks.id })
      .from(schema.bibRecalculationTasks)
      .where(
        and(
          eq(schema.bibRecalculationTasks.albumId, album.id),
          eq(schema.bibRecalculationTasks.kind, "mapping"),
          inArray(schema.bibRecalculationTasks.status, ["pending", "processing", "failed"]),
        ),
      )
      .limit(1);
    if (activeTask !== undefined) throw this.#publicSearchUnavailable();
    const matches = await this.#database
      .selectDistinct({ mediaId: schema.mediaBibTags.mediaId })
      .from(schema.mediaBibTags)
      .innerJoin(schema.media, eq(schema.mediaBibTags.mediaId, schema.media.id))
      .where(
        and(
          eq(schema.mediaBibTags.albumId, album.id),
          eq(schema.mediaBibTags.status, "confirmed"),
          eq(schema.mediaBibTags.mappingVersion, album.bibMappingVersion),
          eq(schema.mediaBibTags.gradeOptionId, options.gradeOptionId),
          ...(options.classOptionId === undefined
            ? []
            : [eq(schema.mediaBibTags.classOptionId, options.classOptionId)]),
          eq(schema.media.publicationStatus, "published"),
        ),
      );
    return photoService.listPublicMedia({
      slug: options.slug,
      visitorToken: options.visitorToken,
      cursor: options.cursor,
      categoryId: options.categoryId,
      limit: 60,
      mediaIds: matches.map((match) => match.mediaId),
    });
  }

  cryptoOrThrow(): BibCrypto {
    if (this.#crypto === null) {
      throw new AppError({
        code: "BIB_KEYS_UNAVAILABLE",
        message: "号码数据密钥或搜索密钥尚未配置",
        statusCode: 409,
      });
    }
    return this.#crypto;
  }

  async loadDocument(albumId: string): Promise<BibDocument> {
    return this.#loadDocument(this.#database, albumId);
  }

  async #mediaForActor(executor: DbExecutor, actor: InternalActor, mediaId: string) {
    const [media] = await executor
      .select()
      .from(schema.media)
      .where(eq(schema.media.id, mediaId))
      .limit(1);
    if (media === undefined) throw this.#tagNotFound();
    const permission = actor.role === "uploader" ? "bib:own" : "bib:any";
    requirePermission(actor.role, permission);
    if (actor.role === "uploader" && media.uploaderId !== actor.id) {
      throw new AppError({ code: "FORBIDDEN", message: "只能处理自己上传的照片", statusCode: 403 });
    }
    if (media.kind !== "photo") {
      throw new AppError({
        code: "BIB_CONFIG_INVALID",
        message: "号码功能只支持照片",
        statusCode: 409,
      });
    }
    return media;
  }

  async #lockedMediaForActor(transaction: Transaction, actor: InternalActor, mediaId: string) {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`bib-media:${mediaId}`}, 0))`,
    );
    return this.#mediaForActor(transaction, actor, mediaId);
  }

  async #lockMediaIds(transaction: Transaction, mediaIds: readonly string[]): Promise<void> {
    for (const mediaId of [...mediaIds].toSorted()) {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`bib-media:${mediaId}`}, 0))`,
      );
    }
  }

  async #ensureReview(transaction: Transaction, mediaId: string): Promise<void> {
    await transaction
      .insert(schema.mediaBibReviews)
      .values({ mediaId, decision: "pending", reason: "created" })
      .onConflictDoNothing({ target: schema.mediaBibReviews.mediaId });
  }

  async #confirmNumberInTransaction(
    transaction: Transaction,
    options: {
      readonly actor: InternalActor;
      readonly media: typeof schema.media.$inferSelect;
      readonly number: string;
      readonly source: "manual" | "ocr";
    },
  ): Promise<string> {
    const album = await this.#album(transaction, options.media.albumId);
    const document = await this.#loadDocument(transaction, options.media.albumId);
    if (!album.bibRuleUsable || !evaluateBibNumber(options.number, document.patterns).valid) {
      throw this.#invalidNumber();
    }
    const bibCrypto = this.cryptoOrThrow();
    const blindIndex = bibCrypto.blindIndex(options.media.albumId, options.number);
    const [existing] = await transaction
      .select()
      .from(schema.mediaBibTags)
      .where(
        and(
          eq(schema.mediaBibTags.mediaId, options.media.id),
          eq(schema.mediaBibTags.blindIndex, blindIndex),
          inArray(schema.mediaBibTags.status, ["suggested", "confirmed", "needs_review"]),
        ),
      )
      .limit(1);
    const attributes = deriveBibAttributes(options.number, document.mappings);
    const now = new Date();
    let tagId: string;
    if (existing !== undefined) {
      tagId = existing.id;
      await transaction
        .update(schema.mediaBibTags)
        .set({
          status: "confirmed",
          source: options.source,
          ruleVersion: album.bibRuleVersion,
          gradeOptionId: attributes.gradeOptionId,
          classOptionId: attributes.classOptionId,
          mappingVersion: album.bibMappingVersion,
          confirmedBy: options.actor.id,
          confirmedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.mediaBibTags.id, existing.id));
    } else {
      tagId = randomUUID();
      const encrypted = bibCrypto.encrypt({
        albumId: options.media.albumId,
        mediaId: options.media.id,
        tagId,
        number: options.number,
      });
      await transaction.insert(schema.mediaBibTags).values({
        id: tagId,
        albumId: options.media.albumId,
        mediaId: options.media.id,
        numberCiphertext: encrypted.ciphertext,
        numberIv: encrypted.iv,
        numberAuthTag: encrypted.authTag,
        blindIndex: encrypted.blindIndex,
        keyVersion: encrypted.keyVersion,
        status: "confirmed",
        source: options.source,
        ruleVersion: album.bibRuleVersion,
        modelVersion: null,
        gradeOptionId: attributes.gradeOptionId,
        classOptionId: attributes.classOptionId,
        mappingVersion: album.bibMappingVersion,
        createdBy: options.actor.id,
        confirmedBy: options.actor.id,
        confirmedAt: now,
      });
    }
    await this.#ensureReview(transaction, options.media.id);
    await transaction
      .update(schema.mediaBibReviews)
      .set({
        decision: "numbers_confirmed",
        decidedBy: options.actor.id,
        decidedAt: now,
        reason: "number_confirmed",
        updatedAt: now,
      })
      .where(eq(schema.mediaBibReviews.mediaId, options.media.id));
    return tagId;
  }

  async #confirmExistingTag(
    transaction: Transaction,
    actor: InternalActor,
    media: typeof schema.media.$inferSelect,
    tag: typeof schema.mediaBibTags.$inferSelect,
    number: string,
  ): Promise<void> {
    const album = await this.#album(transaction, media.albumId);
    const document = await this.#loadDocument(transaction, media.albumId);
    if (!album.bibRuleUsable || !evaluateBibNumber(number, document.patterns).valid) {
      throw this.#invalidNumber();
    }
    const attributes = deriveBibAttributes(number, document.mappings);
    const now = new Date();
    await transaction
      .update(schema.mediaBibTags)
      .set({
        status: "confirmed",
        ruleVersion: album.bibRuleVersion,
        gradeOptionId: attributes.gradeOptionId,
        classOptionId: attributes.classOptionId,
        mappingVersion: album.bibMappingVersion,
        confirmedBy: actor.id,
        confirmedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.mediaBibTags.id, tag.id));
    await this.#ensureReview(transaction, media.id);
    await transaction
      .update(schema.mediaBibReviews)
      .set({
        decision: "numbers_confirmed",
        decidedBy: actor.id,
        decidedAt: now,
        reason: "number_confirmed",
        updatedAt: now,
      })
      .where(eq(schema.mediaBibReviews.mediaId, media.id));
  }

  async #confirmNoNumberInTransaction(
    transaction: Transaction,
    actor: InternalActor,
    media: typeof schema.media.$inferSelect,
  ): Promise<void> {
    const album = await this.#album(transaction, media.albumId);
    if (!album.bibRuleUsable) {
      throw new AppError({
        code: "BIB_CONFIG_INVALID",
        message: "该相册未开启可用的号码识别",
        statusCode: 409,
      });
    }
    const [confirmed] = await transaction
      .select({ id: schema.mediaBibTags.id })
      .from(schema.mediaBibTags)
      .where(
        and(eq(schema.mediaBibTags.mediaId, media.id), eq(schema.mediaBibTags.status, "confirmed")),
      )
      .limit(1);
    if (confirmed !== undefined) {
      throw new AppError({
        code: "STATE_CONFLICT",
        message: "已有确认号码，必须先删除号码才能确认无号码",
        statusCode: 409,
      });
    }
    await transaction
      .update(schema.mediaBibTags)
      .set({ status: "rejected", updatedAt: new Date() })
      .where(
        and(
          eq(schema.mediaBibTags.mediaId, media.id),
          inArray(schema.mediaBibTags.status, ["suggested", "needs_review"]),
        ),
      );
    await this.#ensureReview(transaction, media.id);
    const now = new Date();
    await transaction
      .update(schema.mediaBibReviews)
      .set({
        decision: "no_number_confirmed",
        decidedBy: actor.id,
        decidedAt: now,
        reason: "manual_no_number",
        updatedAt: now,
      })
      .where(eq(schema.mediaBibReviews.mediaId, media.id));
  }

  async #refreshReviewDecision(
    transaction: Transaction,
    mediaId: string,
    actorId: string,
    reason: string,
  ): Promise<void> {
    await this.#ensureReview(transaction, mediaId);
    const [confirmed] = await transaction
      .select({ id: schema.mediaBibTags.id })
      .from(schema.mediaBibTags)
      .where(
        and(eq(schema.mediaBibTags.mediaId, mediaId), eq(schema.mediaBibTags.status, "confirmed")),
      )
      .limit(1);
    const now = new Date();
    await transaction
      .update(schema.mediaBibReviews)
      .set({
        decision: confirmed === undefined ? "pending" : "numbers_confirmed",
        decidedBy: actorId,
        decidedAt: now,
        reason,
        updatedAt: now,
      })
      .where(eq(schema.mediaBibReviews.mediaId, mediaId));
  }

  async #mediaState(executor: DbExecutor, mediaId: string): Promise<BibMediaState> {
    return (
      (await this.#mediaStates(executor, [mediaId])).get(mediaId) ?? this.#emptyMediaState(mediaId)
    );
  }

  async #mediaStates(
    executor: DbExecutor,
    mediaIds: readonly string[],
  ): Promise<Map<string, BibMediaState>> {
    if (mediaIds.length === 0) return new Map();
    const tags = await executor
      .select()
      .from(schema.mediaBibTags)
      .where(inArray(schema.mediaBibTags.mediaId, [...mediaIds]))
      .orderBy(desc(schema.mediaBibTags.createdAt), desc(schema.mediaBibTags.id));
    const reviews = await executor
      .select()
      .from(schema.mediaBibReviews)
      .where(inArray(schema.mediaBibReviews.mediaId, [...mediaIds]));
    const bibCrypto = tags.length === 0 ? null : this.cryptoOrThrow();
    const stateByMedia = new Map<string, BibMediaState>();
    for (const mediaId of mediaIds) {
      const review = reviews.find((candidate) => candidate.mediaId === mediaId);
      stateByMedia.set(mediaId, {
        tags: tags
          .filter((tag) => tag.mediaId === mediaId)
          .map((tag) => ({
            id: tag.id,
            mediaId: tag.mediaId,
            number: (bibCrypto as BibCrypto).decrypt({
              albumId: tag.albumId,
              mediaId: tag.mediaId,
              tagId: tag.id,
              ciphertext: tag.numberCiphertext,
              iv: tag.numberIv,
              authTag: tag.numberAuthTag,
              keyVersion: tag.keyVersion,
            }),
            status: tag.status,
            source: tag.source,
            confidence:
              tag.confidenceBasisPoints === null ? null : tag.confidenceBasisPoints / 10_000,
            quadrilateral: tag.quadrilateral ?? null,
            ruleVersion: tag.ruleVersion,
            modelVersion: tag.modelVersion,
            gradeOptionId: tag.gradeOptionId,
            classOptionId: tag.classOptionId,
            mappingVersion: tag.mappingVersion,
            createdAt: tag.createdAt.toISOString(),
            confirmedAt: tag.confirmedAt?.toISOString() ?? null,
          })),
        review: {
          mediaId,
          decision: review?.decision ?? "pending",
          ocrStatus: review?.ocrStatus ?? "not_started",
          ocrModelVersion: review?.ocrModelVersion ?? null,
          decidedAt: review?.decidedAt?.toISOString() ?? null,
        },
      });
    }
    return stateByMedia;
  }

  #emptyMediaState(mediaId: string): BibMediaState {
    return {
      tags: [],
      review: {
        mediaId,
        decision: "pending",
        ocrStatus: "not_started",
        ocrModelVersion: null,
        decidedAt: null,
      },
    };
  }

  async #event(transaction: Transaction, albumId: string, mediaId: string): Promise<void> {
    await transaction.insert(schema.liveEvents).values({
      albumId,
      mediaId,
      type: "media.bib.updated",
      payload: {},
    });
    await transaction.execute(sql`select pg_notify(${liveEventChannel}, ${albumId})`);
  }

  async #audit(
    transaction: Transaction,
    options: {
      readonly actorId: string;
      readonly action: string;
      readonly mediaId: string;
      readonly changedFields: readonly string[];
      readonly requestId: string;
    },
  ): Promise<void> {
    await transaction.insert(schema.auditLogs).values({
      actorUserId: options.actorId,
      action: options.action,
      targetType: "media",
      targetId: options.mediaId,
      result: "success",
      changedFields: [...options.changedFields],
      requestId: options.requestId,
    });
  }

  #invalidNumber(): AppError {
    return new AppError({
      code: "BIB_NUMBER_INVALID",
      message: "号码不符合当前规则",
      statusCode: 400,
    });
  }

  #tagNotFound(): AppError {
    return new AppError({
      code: "BIB_TAG_NOT_FOUND",
      message: "号码标签不存在",
      statusCode: 404,
    });
  }

  #modelVersionMismatch(): AppError {
    return new AppError({
      code: "BIB_MODEL_VERSION_MISMATCH",
      message: "OCR 模型版本已变化，请刷新相册规则后重试",
      statusCode: 409,
    });
  }

  #ruleVersionMismatch(): AppError {
    return new AppError({
      code: "BIB_RULE_VERSION_MISMATCH",
      message: "号码规则已更新，请刷新页面后继续复核",
      statusCode: 409,
    });
  }

  #photoServiceOrThrow(): PhotoService {
    if (this.#photoService === null) throw new Error("Bib public search requires PhotoService");
    return this.#photoService;
  }

  #publicSearchUnavailable(): AppError {
    return new AppError({
      code: "BIB_SEARCH_DISABLED",
      message: "号码搜索不可用或没有匹配结果",
      statusCode: 404,
    });
  }

  async #album(executor: DbExecutor, albumId: string) {
    const [album] = await executor
      .select()
      .from(schema.albums)
      .where(eq(schema.albums.id, albumId))
      .limit(1);
    if (album === undefined) {
      throw new AppError({ code: "ALBUM_NOT_FOUND", message: "相册不存在", statusCode: 404 });
    }
    return album;
  }

  async #loadDocument(executor: DbExecutor, albumId: string): Promise<BibDocument> {
    const patterns = await executor
      .select()
      .from(schema.bibPatterns)
      .where(eq(schema.bibPatterns.albumId, albumId))
      .orderBy(asc(schema.bibPatterns.sortOrder), asc(schema.bibPatterns.id));
    const patternIds = patterns.map((pattern) => pattern.id);
    const constraints =
      patternIds.length === 0
        ? []
        : await executor
            .select()
            .from(schema.bibConstraints)
            .where(inArray(schema.bibConstraints.patternId, patternIds))
            .orderBy(asc(schema.bibConstraints.sortOrder), asc(schema.bibConstraints.id));
    const constraintIds = constraints.map((constraint) => constraint.id);
    const ranges =
      constraintIds.length === 0
        ? []
        : await executor
            .select()
            .from(schema.bibAllowedRanges)
            .where(inArray(schema.bibAllowedRanges.constraintId, constraintIds))
            .orderBy(asc(schema.bibAllowedRanges.sortOrder), asc(schema.bibAllowedRanges.id));
    const attributeOptions = await executor
      .select()
      .from(schema.bibAttributeOptions)
      .where(eq(schema.bibAttributeOptions.albumId, albumId))
      .orderBy(
        asc(schema.bibAttributeOptions.dimension),
        asc(schema.bibAttributeOptions.sortOrder),
        asc(schema.bibAttributeOptions.id),
      );
    const mappings = await executor
      .select()
      .from(schema.bibAttributeMappings)
      .where(eq(schema.bibAttributeMappings.albumId, albumId))
      .orderBy(asc(schema.bibAttributeMappings.sortOrder), asc(schema.bibAttributeMappings.id));
    const mappingIds = mappings.map((mapping) => mapping.id);
    const mappingRanges =
      mappingIds.length === 0
        ? []
        : await executor
            .select()
            .from(schema.bibAttributeMappingRanges)
            .where(inArray(schema.bibAttributeMappingRanges.mappingId, mappingIds))
            .orderBy(
              asc(schema.bibAttributeMappingRanges.sortOrder),
              asc(schema.bibAttributeMappingRanges.id),
            );
    return {
      patterns: patterns.map((pattern) => ({
        id: pattern.id,
        totalLength: pattern.totalLength,
        sortOrder: pattern.sortOrder,
        enabled: pattern.enabled,
        constraints: constraints
          .filter((constraint) => constraint.patternId === pattern.id)
          .map((constraint) => ({
            id: constraint.id,
            startPosition: constraint.startPosition,
            width: constraint.width,
            sortOrder: constraint.sortOrder,
            ranges: ranges
              .filter((range) => range.constraintId === constraint.id)
              .map((range) => ({
                id: range.id,
                start: range.startValue,
                end: range.endValue,
              })),
          })),
      })),
      attributeOptions: attributeOptions.map((option) => ({
        id: option.id,
        dimension: option.dimension,
        displayName: option.displayName,
        sortOrder: option.sortOrder,
        enabled: option.enabled,
      })),
      mappings: mappings.map((mapping) => ({
        id: mapping.id,
        dimension: mapping.dimension,
        startPosition: mapping.startPosition,
        width: mapping.width,
        outputOptionId: mapping.outputOptionId,
        sortOrder: mapping.sortOrder,
        ranges: mappingRanges
          .filter((range) => range.mappingId === mapping.id)
          .map((range) => ({
            id: range.id,
            start: range.startValue,
            end: range.endValue,
          })),
      })),
    };
  }
}
