import { fileURLToPath } from "node:url";
import type { BibConfigUpdate, BibConfigView } from "@photostream/contracts";
import { createDatabase, createPool, migrateDatabase, schema } from "@photostream/db";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { PostgresAuthStore } from "../auth/postgres-store.js";
import type { PasswordHasher } from "../auth/types.js";
import { loadConfig } from "../config.js";
import type { ObjectMetadata, ObjectStorage, SignedPut } from "../media/object-storage.js";
import { PhotoService } from "../media/service.js";
import { visitorSessionCookieName } from "../media/visitor-http.js";
import { BibService } from "./service.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl !== undefined && !databaseUrl.endsWith("/photostream_test")) {
  throw new Error("TEST_DATABASE_URL must target the dedicated photostream_test database");
}
const maybeDescribe = databaseUrl === undefined ? describe.skip : describe;

const config = loadConfig({
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: "3001",
  APP_ORIGIN: "http://localhost:3000",
  MEDIA_BASE_URL: "http://127.0.0.1:3002",
  DATABASE_URL: databaseUrl ?? "postgresql://invalid/photostream_test",
  SESSION_SECRET_CURRENT: "s".repeat(32),
  CSRF_SECRET: "c".repeat(32),
  CURSOR_SIGNING_SECRET: "u".repeat(32),
  VISITOR_SESSION_SECRET: "v".repeat(32),
  ALBUM_PASSWORD_GENERATION_SECRET: "a".repeat(32),
  USER_PASSWORD_GENERATION_SECRET: "w".repeat(32),
  ANALYTICS_HMAC_SECRET: "n".repeat(32),
  BIB_DATA_KEY: Buffer.alloc(32, 9).toString("base64url"),
  BIB_SEARCH_KEY: "bib-search-key-for-integration-tests-only",
  BIB_KEY_VERSION: "test-v1",
  LOCAL_OBJECT_SECRET: "o".repeat(32),
  LOCAL_OBJECT_BASE_URL: "http://127.0.0.1:3002",
});

const fakeHasher: PasswordHasher = {
  async hash(value) {
    return `hash:${value}`;
  },
  async verify(hash, value) {
    return hash === `hash:${value}`;
  },
};

class FakeObjectStorage implements ObjectStorage {
  signPut(options: { readonly expiresAt: Date }): SignedPut {
    return { url: "http://127.0.0.1:3002/upload", headers: {}, expiresAt: options.expiresAt };
  }
  signRead({ key }: { readonly key: string }): string {
    return `http://127.0.0.1:3002/objects/${key}?expires=1&signature=test`;
  }
  signMultipartPart(options: { readonly expiresAt: Date }): SignedPut {
    return { url: "http://127.0.0.1:3002/upload", headers: {}, expiresAt: options.expiresAt };
  }
  async completeMultipart(): Promise<void> {}
  async delete(): Promise<void> {}
  async head(): Promise<ObjectMetadata | null> {
    return null;
  }
}

const gradeOne = "019d0000-0000-7000-8000-000000000101";
const gradeTwo = "019d0000-0000-7000-8000-000000000102";
const classOne = "019d0000-0000-7000-8000-000000000103";
const classTwo = "019d0000-0000-7000-8000-000000000104";

function validConfig(overrides: Partial<BibConfigUpdate> = {}): BibConfigUpdate {
  return {
    recognitionEnabled: true,
    searchEnabled: true,
    modelVersion: "PP-OCRv6-tiny-test",
    patterns: [
      {
        totalLength: 6,
        sortOrder: 0,
        enabled: true,
        constraints: [
          {
            startPosition: 1,
            width: 3,
            sortOrder: 0,
            ranges: [
              { start: "101", end: "112" },
              { start: "201", end: "212" },
            ],
          },
        ],
      },
    ],
    attributeOptions: [
      { id: gradeOne, dimension: "grade", displayName: "初一", sortOrder: 0, enabled: true },
      { id: gradeTwo, dimension: "grade", displayName: "初二", sortOrder: 1, enabled: true },
      { id: classOne, dimension: "class", displayName: "一班", sortOrder: 0, enabled: true },
      { id: classTwo, dimension: "class", displayName: "二班", sortOrder: 1, enabled: true },
    ],
    mappings: [
      {
        dimension: "grade",
        startPosition: 1,
        width: 1,
        ranges: [{ start: "1", end: "1" }],
        outputOptionId: gradeOne,
        sortOrder: 0,
      },
      {
        dimension: "grade",
        startPosition: 1,
        width: 1,
        ranges: [{ start: "2", end: "2" }],
        outputOptionId: gradeTwo,
        sortOrder: 1,
      },
      {
        dimension: "class",
        startPosition: 2,
        width: 2,
        ranges: [{ start: "01", end: "01" }],
        outputOptionId: classOne,
        sortOrder: 0,
      },
      {
        dimension: "class",
        startPosition: 2,
        width: 2,
        ranges: [{ start: "02", end: "02" }],
        outputOptionId: classTwo,
        sortOrder: 1,
      },
    ],
    ...overrides,
  };
}

function updateFromView(view: BibConfigView): BibConfigUpdate {
  return {
    recognitionEnabled: view.recognitionEnabled,
    searchEnabled: view.searchEnabled,
    modelVersion: view.modelVersion,
    patterns: view.patterns,
    attributeOptions: view.attributeOptions,
    mappings: view.mappings,
  };
}

maybeDescribe("bib configuration, privacy and search", () => {
  const pool = createPool(databaseUrl ?? "");
  const database = createDatabase(pool);
  const photoService = new PhotoService({
    database,
    storage: new FakeObjectStorage(),
    passwordHasher: fakeHasher,
    config,
  });
  const service = new BibService({ database, config, photoService });
  let adminId = "";
  let reviewerId = "";
  let uploaderId = "";
  let albumId = "";
  let mediaId = "";
  let visitorToken = "";

  beforeAll(async () => {
    await migrateDatabase(
      pool,
      fileURLToPath(new URL("../../../../packages/db/drizzle", import.meta.url)),
    );
  });

  beforeEach(async () => {
    await database.delete(schema.operationRequests);
    await database.delete(schema.liveEvents);
    await database.delete(schema.analyticsEvents);
    await database.delete(schema.analyticsDaily);
    await database.delete(schema.deletionTaskObjects);
    await database.delete(schema.deletionTasks);
    await database.delete(schema.mediaBatchRequests);
    await database.delete(schema.bibRecalculationTasks);
    await database.delete(schema.mediaBibTags);
    await database.delete(schema.mediaBibReviews);
    await database.delete(schema.bibAttributeMappingRanges);
    await database.delete(schema.bibAttributeMappings);
    await database.delete(schema.bibAttributeOptions);
    await database.delete(schema.bibAllowedRanges);
    await database.delete(schema.bibConstraints);
    await database.delete(schema.bibPatterns);
    await database.delete(schema.mediaVariants);
    await database.delete(schema.uploadParts);
    await database.delete(schema.uploadIntents);
    await database.delete(schema.media);
    await database.delete(schema.visitorSessions);
    await database.delete(schema.categories);
    await database.delete(schema.albums);
    await database.delete(schema.auditLogs);
    await database.delete(schema.sessions);
    await database.delete(schema.users);
    const users = await database
      .insert(schema.users)
      .values([
        {
          username: "admin",
          normalizedUsername: "admin",
          displayName: "管理员",
          role: "admin",
          passwordHash: "hash:admin-password",
          mustChangePassword: false,
        },
        {
          username: "reviewer",
          normalizedUsername: "reviewer",
          displayName: "审核员",
          role: "reviewer",
          passwordHash: "hash:reviewer-password",
          mustChangePassword: false,
        },
        {
          username: "uploader",
          normalizedUsername: "uploader",
          displayName: "上传者",
          role: "uploader",
          passwordHash: "hash:uploader-password",
          mustChangePassword: false,
        },
      ])
      .returning({ id: schema.users.id, role: schema.users.role });
    adminId = users.find((user) => user.role === "admin")?.id ?? "";
    reviewerId = users.find((user) => user.role === "reviewer")?.id ?? "";
    uploaderId = users.find((user) => user.role === "uploader")?.id ?? "";
    const [album] = await database
      .insert(schema.albums)
      .values({
        slug: "bib-integration-one",
        title: "号码测试相册",
        description: "",
        state: "live",
        access: "password",
        publishMode: "review",
        passwordHash: "hash:album-password",
        idempotencyKey: "bib-album-idempotency",
        createdBy: adminId,
      })
      .returning({ id: schema.albums.id });
    albumId = album?.id ?? "";
    const [media] = await database
      .insert(schema.media)
      .values({
        albumId,
        kind: "photo",
        uploaderId,
        ingestStatus: "ready",
        publicationStatus: "published",
        width: 640,
        height: 480,
        mediaType: "image/jpeg",
        totalBytes: 100,
        publishSequence: 1,
        publishedAt: new Date(),
      })
      .returning({ id: schema.media.id });
    mediaId = media?.id ?? "";
    await database.insert(schema.mediaVariants).values({
      mediaId,
      kind: "photo_480",
      objectKey: "media/bib/480.webp",
      format: "webp",
      contentType: "image/webp",
      width: 480,
      height: 360,
      expectedBytes: 100,
      bytes: 100,
      verified: true,
    });
    visitorToken = (await photoService.unlockAlbum("bib-integration-one", "album-password"))
      .rawToken;
  });

  afterAll(async () => pool.end());

  it("saves only usable enabled configs and derives deterministic attributes", async () => {
    const draft = await service.updateConfig({
      actor: { id: adminId, role: "admin" },
      albumId,
      input: {
        ...validConfig({ recognitionEnabled: false, searchEnabled: false }),
        patterns: [
          {
            totalLength: 2,
            sortOrder: 0,
            enabled: true,
            constraints: [
              {
                startPosition: 1,
                width: 1,
                ranges: [{ start: "1", end: "1" }],
                sortOrder: 0,
              },
              {
                startPosition: 1,
                width: 1,
                ranges: [{ start: "2", end: "2" }],
                sortOrder: 1,
              },
            ],
          },
        ],
        mappings: [],
      },
      requestId: "bib-draft",
    });
    expect(draft.ruleUsable).toBe(false);
    await expect(
      service.updateConfig({
        actor: { id: adminId, role: "admin" },
        albumId,
        input: { ...draft, recognitionEnabled: true, searchEnabled: false },
        requestId: "bib-invalid-enable",
      }),
    ).rejects.toMatchObject({ code: "BIB_CONFIG_INVALID" });

    const disabledAutomation = new BibService({
      database,
      config: { ...config, BIB_OCR_AUTOMATION_STATUS: "disabled" },
      photoService,
    });
    await expect(
      disabledAutomation.updateConfig({
        actor: { id: adminId, role: "admin" },
        albumId,
        input: validConfig({ recognitionEnabled: true, searchEnabled: false }),
        requestId: "bib-disabled-automation",
      }),
    ).rejects.toMatchObject({ code: "BIB_CONFIG_INVALID" });

    const saved = await service.updateConfig({
      actor: { id: adminId, role: "admin" },
      albumId,
      input: validConfig(),
      requestId: "bib-valid",
    });
    expect(saved).toMatchObject({
      recognitionEnabled: true,
      searchEnabled: true,
      ruleUsable: true,
      mappingUsable: true,
    });
    expect(
      await service.testNumber({ id: reviewerId, role: "reviewer" }, albumId, "101999"),
    ).toMatchObject({ valid: true, gradeOptionId: gradeOne, classOptionId: classOne });
    const renamed = await service.updateConfig({
      actor: { id: adminId, role: "admin" },
      albumId,
      input: {
        ...updateFromView(saved),
        attributeOptions: saved.attributeOptions.map((option) =>
          option.id === gradeOne
            ? { ...option, displayName: "七年级", sortOrder: option.sortOrder + 10 }
            : option,
        ),
        patterns: saved.patterns.map((pattern) => ({
          ...pattern,
          sortOrder: pattern.sortOrder + 10,
          constraints: pattern.constraints
            .map((constraint) => ({ ...constraint, sortOrder: constraint.sortOrder + 10 }))
            .toReversed(),
        })),
        mappings: saved.mappings
          .map((mapping) => ({ ...mapping, sortOrder: mapping.sortOrder + 10 }))
          .toReversed(),
      },
      requestId: "bib-display-name-only",
    });
    expect(renamed).toMatchObject({
      ruleVersion: saved.ruleVersion,
      mappingVersion: saved.mappingVersion,
    });
    await expect(
      service.updateConfig({
        actor: { id: adminId, role: "admin" },
        albumId,
        input: {
          ...updateFromView(renamed),
          recognitionEnabled: false,
          searchEnabled: false,
          mappings: [],
          attributeOptions: renamed.attributeOptions.map((option) =>
            option.id === gradeOne ? { ...option, dimension: "class" } : option,
          ),
        },
        requestId: "bib-option-dimension-change",
      }),
    ).rejects.toMatchObject({ code: "BIB_CONFIG_INVALID" });
  });

  it("keeps suggestions private, confirms exact search, and protects manual no-number", async () => {
    await service.updateConfig({
      actor: { id: adminId, role: "admin" },
      albumId,
      input: validConfig(),
      requestId: "bib-valid",
    });
    await service.processPendingRecalculations(10);
    await expect(
      service.submitCandidates({
        actor: { id: uploaderId, role: "uploader" },
        mediaId,
        activityStatus: "completed",
        modelVersion: "stale-model-version",
        ruleVersion: 1,
        candidates: [],
        idempotencyKey: "stale-model-candidate-key",
        requestId: "stale-model-candidate",
      }),
    ).rejects.toMatchObject({ code: "BIB_MODEL_VERSION_MISMATCH" });
    await expect(
      service.submitCandidates({
        actor: { id: uploaderId, role: "uploader" },
        mediaId,
        activityStatus: "completed",
        modelVersion: "PP-OCRv6-tiny-test",
        ruleVersion: 0,
        candidates: [],
        idempotencyKey: "stale-rule-candidate-key",
        requestId: "stale-rule-candidate",
      }),
    ).rejects.toMatchObject({ code: "BIB_RULE_VERSION_MISMATCH" });
    const processing = await service.submitCandidates({
      actor: { id: uploaderId, role: "uploader" },
      mediaId,
      activityStatus: "processing",
      modelVersion: "PP-OCRv6-tiny-test",
      ruleVersion: 1,
      candidates: [],
      idempotencyKey: "processing-candidate-key",
      requestId: "processing-candidate",
    });
    expect(processing).toMatchObject({ review: { decision: "pending", ocrStatus: "processing" } });
    await database
      .update(schema.mediaBibReviews)
      .set({ updatedAt: new Date("2026-08-29T10:00:00.000Z") })
      .where(eq(schema.mediaBibReviews.mediaId, mediaId));
    expect(await service.expireStaleOcrActivities(new Date("2026-08-29T11:00:00.000Z"))).toBe(1);
    expect(
      await service.getMediaState({ id: uploaderId, role: "uploader" }, mediaId),
    ).toMatchObject({ review: { decision: "pending", ocrStatus: "failed" } });
    const suggested = await service.submitCandidates({
      actor: { id: uploaderId, role: "uploader" },
      mediaId,
      activityStatus: "completed",
      modelVersion: "PP-OCRv6-tiny-test",
      ruleVersion: 1,
      candidates: [
        {
          text: "１０１９９９",
          confidence: 0.92,
          quadrilateral: [
            { x: 0.1, y: 0.1 },
            { x: 0.3, y: 0.1 },
            { x: 0.3, y: 0.2 },
            { x: 0.1, y: 0.2 },
          ],
          modelVersion: "PP-OCRv6-tiny-test",
        },
      ],
      idempotencyKey: "candidate-idempotency-key",
      requestId: "candidate-request",
    });
    expect(suggested).toMatchObject({
      tags: [expect.objectContaining({ number: "101999", status: "suggested" })],
      review: { decision: "pending" },
    });
    expect(
      (
        await service.searchPublic({
          slug: "bib-integration-one",
          visitorToken,
          number: "101999",
          cursor: undefined,
        })
      ).items,
    ).toEqual([]);
    const storedBefore = JSON.stringify(await database.select().from(schema.mediaBibTags));
    expect(storedBefore).not.toContain("101999");
    expect(JSON.stringify(await database.select().from(schema.auditLogs))).not.toContain("101999");
    expect(JSON.stringify(await database.select().from(schema.operationRequests))).not.toContain(
      "101999",
    );

    const confirmed = await service.confirmTag({
      actor: { id: reviewerId, role: "reviewer" },
      mediaId,
      tagId: suggested.tags[0]?.id ?? "",
      correctedNumber: undefined,
      idempotencyKey: "confirm-idempotency-key",
      requestId: "confirm-request",
    });
    expect(confirmed).toMatchObject({
      tags: [
        expect.objectContaining({
          status: "confirmed",
          gradeOptionId: gradeOne,
          classOptionId: classOne,
        }),
      ],
      review: { decision: "numbers_confirmed" },
    });
    expect(
      (
        await service.searchPublic({
          slug: "bib-integration-one",
          visitorToken,
          number: "101999",
          cursor: undefined,
        })
      ).items.map((item) => item.id),
    ).toEqual([mediaId]);
    expect(JSON.stringify(await database.select().from(schema.liveEvents))).not.toContain("101999");
    const correctionCandidate = await service.submitCandidates({
      actor: { id: uploaderId, role: "uploader" },
      mediaId,
      activityStatus: "completed",
      modelVersion: "PP-OCRv6-tiny-test",
      ruleVersion: 1,
      candidates: [
        {
          text: "102999",
          confidence: 0.75,
          quadrilateral: null,
          modelVersion: "PP-OCRv6-tiny-test",
        },
      ],
      idempotencyKey: "correction-candidate-key",
      requestId: "correction-candidate",
    });
    const correctedFromTagId =
      correctionCandidate.tags.find((tag) => tag.number === "102999")?.id ?? "";
    const correctedState = await service.confirmTag({
      actor: { id: reviewerId, role: "reviewer" },
      mediaId,
      tagId: correctedFromTagId,
      correctedNumber: "103999",
      idempotencyKey: "correct-candidate-key",
      requestId: "correct-candidate-request",
    });
    const correctedToTagId = correctedState.tags.find((tag) => tag.number === "103999")?.id ?? "";
    const correctionAudit = await database
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.requestId, "correct-candidate-request"))
      .orderBy(asc(schema.auditLogs.id));
    expect(
      correctionAudit
        .filter((entry) => entry.targetType === "bib_tag")
        .map((entry) => [entry.action, entry.targetId]),
    ).toEqual([
      ["media.bib.tag.corrected_from", correctedFromTagId],
      ["media.bib.tag.corrected_to", correctedToTagId],
    ]);
    expect(JSON.stringify(correctionAudit)).not.toContain("102999");
    expect(JSON.stringify(correctionAudit)).not.toContain("103999");
    expect(
      (
        await service.filterPublicAttributes({
          slug: "bib-integration-one",
          visitorToken,
          gradeOptionId: gradeOne,
          classOptionId: classOne,
          categoryId: undefined,
          cursor: undefined,
        })
      ).items.map((item) => item.id),
    ).toEqual([mediaId]);
    const multiNumber = await service.addManualTag({
      actor: { id: reviewerId, role: "reviewer" },
      mediaId,
      number: "202999",
      idempotencyKey: "second-manual-tag-key",
      requestId: "second-manual-tag",
    });
    expect(
      (
        await service.filterPublicAttributes({
          slug: "bib-integration-one",
          visitorToken,
          gradeOptionId: gradeOne,
          classOptionId: classTwo,
          categoryId: undefined,
          cursor: undefined,
        })
      ).items,
    ).toEqual([]);
    await expect(
      service.confirmNoNumber({
        actor: { id: uploaderId, role: "uploader" },
        mediaId,
        idempotencyKey: "no-number-conflict-key",
        requestId: "no-number-conflict",
      }),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });

    for (const tag of multiNumber.tags.filter((item) => item.status === "confirmed")) {
      await service.deleteTag({
        actor: { id: uploaderId, role: "uploader" },
        mediaId,
        tagId: tag.id,
        idempotencyKey: `delete-tag-key-${tag.id}`,
        requestId: `delete-tag-${tag.id}`,
      });
    }
    const noNumber = await service.confirmNoNumber({
      actor: { id: uploaderId, role: "uploader" },
      mediaId,
      idempotencyKey: "no-number-confirm-key",
      requestId: "no-number",
    });
    expect(noNumber.review.decision).toBe("no_number_confirmed");
    const late = await service.submitCandidates({
      actor: { id: uploaderId, role: "uploader" },
      mediaId,
      activityStatus: "completed",
      modelVersion: "PP-OCRv6-tiny-test",
      ruleVersion: 1,
      candidates: [
        {
          text: "101999",
          confidence: 0.99,
          quadrilateral: null,
          modelVersion: "PP-OCRv6-tiny-test",
        },
      ],
      idempotencyKey: "late-candidate-key",
      requestId: "late-candidate",
    });
    expect(late.review.decision).toBe("no_number_confirmed");
    expect(late.tags.some((tag) => tag.number === "101999")).toBe(false);
    expect(late.tags.every((tag) => tag.status === "rejected")).toBe(true);
    const reset = await service.resetReview({
      actor: { id: uploaderId, role: "uploader" },
      mediaId,
      idempotencyKey: "reset-no-number-key",
      requestId: "reset-no-number",
    });
    expect(reset.review.decision).toBe("pending");
    await service.confirmNoNumber({
      actor: { id: uploaderId, role: "uploader" },
      mediaId,
      idempotencyKey: "confirm-no-number-again-key",
      requestId: "confirm-no-number-again",
    });
    const manuallyConfirmed = await service.addManualTag({
      actor: { id: uploaderId, role: "uploader" },
      mediaId,
      number: "101999",
      idempotencyKey: "manual-after-no-number-key",
      requestId: "manual-after-no-number",
    });
    expect(manuallyConfirmed.review.decision).toBe("numbers_confirmed");
    const restored = await service.deleteTag({
      actor: { id: uploaderId, role: "uploader" },
      mediaId,
      tagId: manuallyConfirmed.tags.find((tag) => tag.status === "confirmed")?.id ?? "",
      idempotencyKey: "delete-last-confirmed-key",
      requestId: "delete-last-confirmed",
    });
    expect(restored.review.decision).toBe("pending");
    const retriedDelete = await service.deleteTag({
      actor: { id: uploaderId, role: "uploader" },
      mediaId,
      tagId: manuallyConfirmed.tags.find((tag) => tag.status === "confirmed")?.id ?? "",
      idempotencyKey: "delete-last-confirmed-key",
      requestId: "delete-last-confirmed-retry",
    });
    expect(retriedDelete.review.decision).toBe("pending");
  });

  it("keeps manual confirmation and exact search available while automatic OCR is disabled", async () => {
    const manualOnly = await service.updateConfig({
      actor: { id: adminId, role: "admin" },
      albumId,
      input: validConfig({ recognitionEnabled: false, searchEnabled: true }),
      requestId: "bib-manual-only-config",
    });
    expect(manualOnly).toMatchObject({ recognitionEnabled: false, searchEnabled: true });
    const state = await service.addManualTag({
      actor: { id: uploaderId, role: "uploader" },
      mediaId,
      number: "101999",
      idempotencyKey: "manual-only-confirm-key",
      requestId: "manual-only-confirm",
    });
    expect(state).toMatchObject({
      review: { decision: "numbers_confirmed", ocrStatus: "not_started" },
    });
    expect(
      (
        await service.searchPublic({
          slug: "bib-integration-one",
          visitorToken,
          number: "101999",
          cursor: undefined,
        })
      ).items.map((item) => item.id),
    ).toEqual([mediaId]);
    await expect(
      service.submitCandidates({
        actor: { id: uploaderId, role: "uploader" },
        mediaId,
        activityStatus: "completed",
        modelVersion: manualOnly.modelVersion,
        ruleVersion: manualOnly.ruleVersion,
        candidates: [],
        idempotencyKey: "manual-only-ocr-key",
        requestId: "manual-only-ocr",
      }),
    ).rejects.toMatchObject({ code: "BIB_CONFIG_INVALID" });
  });

  it("returns stable per-item batch outcomes and cleans only stale unresolved candidates", async () => {
    await service.updateConfig({
      actor: { id: adminId, role: "admin" },
      albumId,
      input: validConfig(),
      requestId: "bib-valid",
    });
    await service.processPendingRecalculations(10);
    const [foreignMedia] = await database
      .insert(schema.media)
      .values({
        albumId,
        kind: "photo",
        uploaderId: reviewerId,
        ingestStatus: "ready",
        publicationStatus: "published",
        width: 640,
        height: 480,
        mediaType: "image/jpeg",
        totalBytes: 100,
        publishSequence: 2,
        publishedAt: new Date(),
      })
      .returning({ id: schema.media.id });
    const foreignMediaId = foreignMedia?.id ?? "";
    await expect(
      service.addManualTag({
        actor: { id: uploaderId, role: "uploader" },
        mediaId: foreignMediaId,
        number: "101999",
        idempotencyKey: "foreign-uploader-tag-key",
        requestId: "foreign-uploader-tag",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      service.addManualTagBatch({
        actor: { id: uploaderId, role: "uploader" },
        mediaIds: [mediaId],
        number: "101999",
        idempotencyKey: "forbidden-uploader-batch-key",
        requestId: "forbidden-uploader-batch",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const missingMediaId = "019d0000-0000-7000-8000-000000009999";
    const batch = await service.addManualTagBatch({
      actor: { id: reviewerId, role: "reviewer" },
      mediaIds: [mediaId, missingMediaId],
      number: "101999",
      idempotencyKey: "partial-batch-operation-key",
      requestId: "partial-batch-operation",
    });
    expect(batch.items).toEqual([
      { mediaId, ok: true, code: null, message: null },
      expect.objectContaining({ mediaId: missingMediaId, ok: false, code: "BIB_TAG_NOT_FOUND" }),
    ]);

    await service.submitCandidates({
      actor: { id: uploaderId, role: "uploader" },
      mediaId,
      activityStatus: "completed",
      modelVersion: "PP-OCRv6-tiny-test",
      ruleVersion: 1,
      candidates: [
        {
          text: "202999",
          confidence: 0.8,
          quadrilateral: null,
          modelVersion: "PP-OCRv6-tiny-test",
        },
      ],
      idempotencyKey: "cleanup-candidate-key",
      requestId: "cleanup-candidate",
    });
    const cleanupNow = new Date("2026-08-29T12:00:00.000Z");
    await database
      .update(schema.albums)
      .set({ state: "ended", updatedAt: new Date("2026-07-01T00:00:00.000Z") })
      .where(eq(schema.albums.id, albumId));
    expect(await service.cleanupStaleCandidates(cleanupNow)).toBe(1);
    const state = await service.getMediaState({ id: reviewerId, role: "reviewer" }, mediaId);
    expect(state.tags).toEqual([
      expect.objectContaining({ number: "101999", status: "confirmed" }),
    ]);
  });

  it("moves invalid confirmed tags out of public search after a persistent rule task", async () => {
    await service.updateConfig({
      actor: { id: adminId, role: "admin" },
      albumId,
      input: validConfig(),
      requestId: "bib-valid",
    });
    await service.addManualTag({
      actor: { id: reviewerId, role: "reviewer" },
      mediaId,
      number: "101999",
      idempotencyKey: "manual-tag-idempotency",
      requestId: "manual-tag",
    });
    await service.processPendingRecalculations(10);
    const changed = validConfig({
      patterns: [
        {
          totalLength: 6,
          sortOrder: 0,
          enabled: true,
          constraints: [
            {
              startPosition: 1,
              width: 3,
              ranges: [{ start: "201", end: "212" }],
              sortOrder: 0,
            },
          ],
        },
      ],
    });
    await service.updateConfig({
      actor: { id: adminId, role: "admin" },
      albumId,
      input: changed,
      requestId: "bib-rule-changed",
    });
    await expect(
      service.searchPublic({
        slug: "bib-integration-one",
        visitorToken,
        number: "101999",
        cursor: undefined,
      }),
    ).rejects.toMatchObject({ code: "BIB_SEARCH_DISABLED" });
    await service.processPendingRecalculations(10);
    const state = await service.getMediaState({ id: reviewerId, role: "reviewer" }, mediaId);
    expect(state).toMatchObject({
      tags: [expect.objectContaining({ status: "needs_review" })],
      review: { decision: "needs_review" },
    });
    expect(JSON.stringify(await database.select().from(schema.mediaBibTags))).not.toContain(
      "101999",
    );
  });

  it("exposes strict runtime schemas without GET search or image candidate bodies", async () => {
    const app = await buildApp({
      config,
      authStore: new PostgresAuthStore(database),
      passwordHasher: fakeHasher,
      bibService: service,
      logger: false,
    });
    const headers = { host: "localhost:3000", origin: "http://localhost:3000" };
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers,
      payload: { username: "admin", password: "admin-password" },
    });
    expect(login.statusCode).toBe(200);
    const csrfToken = login.json<{ csrfToken: string }>().csrfToken;
    const setCookie = login.headers["set-cookie"];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(";", 1)[0];
    if (cookie === undefined) throw new Error("Missing login cookie");
    const authenticatedHeaders = { ...headers, cookie, "x-csrf-token": csrfToken };

    const read = await app.inject({
      method: "GET",
      url: `/api/v1/albums/${albumId}/bib-config`,
      headers: authenticatedHeaders,
    });
    expect(read.statusCode).toBe(200);
    expect(read.headers["cache-control"]).toBe("no-store");
    const invalidCandidate = await app.inject({
      method: "POST",
      url: `/api/v1/media/${mediaId}/bib-candidates`,
      headers: { ...authenticatedHeaders, "idempotency-key": "runtime-candidate-key" },
      payload: {
        activityStatus: "completed",
        modelVersion: "test",
        ruleVersion: 1,
        candidates: [
          {
            text: "101999",
            confidence: 0.9,
            quadrilateral: null,
            modelVersion: "test",
            image: "data:image/jpeg;base64,forbidden",
          },
        ],
      },
    });
    expect(invalidCandidate.statusCode).toBe(400);
    expect(invalidCandidate.body).not.toContain("data:image");
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/v1/public/albums/bib-integration-one/bib-search?number=101999",
          headers,
        })
      ).statusCode,
    ).toBe(404);
    const openApi = await app.inject({ method: "GET", url: "/api/v1/openapi.json", headers });
    expect(Object.keys(openApi.json<{ paths: Record<string, unknown> }>().paths)).toEqual(
      expect.arrayContaining([
        "/api/v1/albums/{id}/bib-config",
        "/api/v1/media/{id}/bib-candidates",
        "/api/v1/media/{id}/bib-review/no-number",
        "/api/v1/public/albums/{slug}/bib-search",
        "/api/v1/public/albums/{slug}/bib-attributes-filter",
      ]),
    );
    await app.close();
  });

  it("enforces independent visitor-session and daily IP-HMAC search limits", async () => {
    await service.updateConfig({
      actor: { id: adminId, role: "admin" },
      albumId,
      input: validConfig(),
      requestId: "bib-rate-limit-config",
    });
    const headers = { host: "localhost:3000", origin: "http://localhost:3000" };
    const cookieName = visitorSessionCookieName(config, "bib-integration-one");
    const requestSearch = async (
      app: Awaited<ReturnType<typeof buildApp>>,
      token: string,
      remoteAddress: string,
    ) =>
      app.inject({
        method: "POST",
        url: "/api/v1/public/albums/bib-integration-one/bib-search",
        headers: { ...headers, cookie: `${cookieName}=${token}` },
        payload: { number: "101999" },
        remoteAddress,
      });

    const sessionLimitedApp = await buildApp({
      config,
      authStore: new PostgresAuthStore(database),
      passwordHasher: fakeHasher,
      bibService: service,
      logger: false,
    });
    const oneSession = (await photoService.unlockAlbum("bib-integration-one", "album-password"))
      .rawToken;
    for (let index = 0; index < 31; index += 1) {
      const response = await requestSearch(sessionLimitedApp, oneSession, `192.0.2.${index + 1}`);
      expect(response.statusCode).toBe(index < 30 ? 200 : 429);
    }
    await sessionLimitedApp.close();

    const ipLimitedApp = await buildApp({
      config,
      authStore: new PostgresAuthStore(database),
      passwordHasher: fakeHasher,
      bibService: service,
      logger: false,
    });
    for (let index = 0; index < 31; index += 1) {
      const token = (await photoService.unlockAlbum("bib-integration-one", "album-password"))
        .rawToken;
      const response = await requestSearch(ipLimitedApp, token, "198.51.100.10");
      expect(response.statusCode).toBe(index < 30 ? 200 : 429);
    }
    await ipLimitedApp.close();
  });
});
