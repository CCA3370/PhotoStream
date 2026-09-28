import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, createPool, migrateDatabase } from "./index.js";
import * as schema from "./schema.js";

const { sessions, users } = schema;

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl !== undefined && new URL(databaseUrl).pathname !== "/photostream_test") {
  throw new Error("TEST_DATABASE_URL must target the dedicated photostream_test database");
}
const maybeDescribe = databaseUrl === undefined ? describe.skip : describe;

maybeDescribe("PostgreSQL identity schema", () => {
  const pool = createPool(databaseUrl ?? "");
  const database = createDatabase(pool);

  beforeAll(async () => {
    const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
    await migrateDatabase(pool, migrationsFolder);
  });

  beforeEach(async () => {
    await database.delete(schema.faceIntegrationEvents);
    await database.delete(schema.faceSearchCandidates);
    await database.delete(schema.faceSearchIntents);
    await database.delete(schema.faceConsentReceipts);
    await database.delete(schema.mediaFaceIndexTasks);
    await database.delete(schema.faceAlbumJobs);
    await database.delete(schema.albumFaceIndexes);
    await database.delete(schema.liveEvents);
    await database.delete(schema.analyticsEvents);
    await database.delete(schema.analyticsDaily);
    await database.delete(schema.deletionTaskObjects);
    await database.delete(schema.deletionTasks);
    await database.delete(schema.mediaBatchRequests);
    await database.delete(schema.operationRequests);
    await database.delete(schema.uploadParts);
    await database.delete(schema.mediaVariants);
    await database.delete(schema.uploadIntents);
    await database.delete(schema.media);
    await database.delete(schema.visitorSessions);
    await database.delete(schema.categories);
    await database.delete(schema.albums);
    await database.delete(schema.auditLogs);
    await database.delete(sessions);
    await database.delete(users);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("uses PostgreSQL uuidv7 defaults and enforces normalized username uniqueness", async () => {
    const created = await insertAdmin();

    expect(created?.id[14]).toBe("7");
    await expect(
      database.insert(users).values({
        username: "ADMIN",
        normalizedUsername: "admin",
        displayName: "重复账号",
        role: "uploader",
        passwordHash: "not-a-real-hash",
      }),
    ).rejects.toThrow();
  });

  it("cascades sessions while never storing the raw session token", async () => {
    const user = await insertAdmin();
    const now = new Date();
    const tokenHash = "a".repeat(64);
    await database.insert(sessions).values({
      tokenHash,
      userId: user.id,
      idleExpiresAt: new Date(now.getTime() + 60_000),
      absoluteExpiresAt: new Date(now.getTime() + 120_000),
    });
    const [stored] = await database
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, tokenHash));
    expect(stored?.tokenHash).toBe(tokenHash);
    expect(JSON.stringify(stored)).not.toContain("raw-session-token");

    await database.delete(users).where(eq(users.id, user.id));
    const remaining = await database.select().from(sessions);
    expect(remaining).toHaveLength(0);
  });

  it("keeps the persisted media boundary photo-only", async () => {
    const mediaColumns = await pool.query<{ column_name: string }>(
      `select column_name
       from information_schema.columns
       where table_schema = 'public' and table_name = 'media'
       order by ordinal_position`,
    );
    expect(mediaColumns.rows.map((row) => row.column_name)).toEqual([
      "id",
      "album_id",
      "category_id",
      "uploader_id",
      "ingest_status",
      "publication_status",
      "width",
      "height",
      "media_type",
      "total_bytes",
      "captured_at",
      "received_at",
      "publish_sequence",
      "published_at",
      "hidden_at",
      "failure_code",
      "retryable",
      "created_at",
      "updated_at",
      "review_assignee_id",
      "reviewed_at",
      "source_sha256",
    ]);

    const variantKinds = await pool.query<{ enumlabel: string }>(
      `select enumlabel
       from pg_enum
       join pg_type on pg_type.oid = pg_enum.enumtypid
       where pg_type.typname = 'variant_kind'
       order by pg_enum.enumsortorder`,
    );
    expect(variantKinds.rows.map((row) => row.enumlabel)).toEqual([
      "photo_480",
      "photo_960",
      "photo_1920",
      "photo_original",
    ]);
  });

  it("persists the operator role in PostgreSQL", async () => {
    const roles = await pool.query<{ enumlabel: string }>(
      `select enumlabel
       from pg_enum
       join pg_type on pg_type.oid = pg_enum.enumtypid
       where pg_type.typname = 'user_role'
       order by pg_enum.enumsortorder`,
    );
    expect(roles.rows.map((row) => row.enumlabel)).toEqual([
      "admin",
      "operator",
      "reviewer",
      "uploader",
    ]);
  });

  it("persists upload cleanup recovery and key-rotation indexes", async () => {
    const cleanupColumns = await pool.query<{ column_name: string }>(
      `select column_name
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'upload_intents'
         and column_name like 'cleanup_%'
       order by column_name`,
    );
    expect(cleanupColumns.rows.map((row) => row.column_name)).toEqual([
      "cleanup_attempts",
      "cleanup_completed_at",
      "cleanup_last_error_code",
      "cleanup_next_attempt_at",
      "cleanup_status",
      "cleanup_successful_sweeps",
    ]);
    const cleanupStatuses = await pool.query<{ enumlabel: string }>(
      `select enumlabel
       from pg_enum
       join pg_type on pg_type.oid = pg_enum.enumtypid
       where pg_type.typname = 'upload_cleanup_status'
       order by pg_enum.enumsortorder`,
    );
    expect(cleanupStatuses.rows.map((row) => row.enumlabel)).toEqual([
      "not_needed",
      "pending",
      "processing",
      "failed",
      "completed",
    ]);
    const indexes = await pool.query<{ indexname: string }>(
      `select indexname
       from pg_indexes
       where schemaname = 'public'
         and indexname in ('upload_intents_cleanup_idx', 'media_bib_tags_key_version_idx')
       order by indexname`,
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      "media_bib_tags_key_version_idx",
      "upload_intents_cleanup_idx",
    ]);
  });

  it("persists only minimal face-search control-plane state", async () => {
    const faceTables = await pool.query<{ table_name: string }>(
      `select table_name
       from information_schema.tables
       where table_schema = 'public' and table_name like '%face%'
       order by table_name`,
    );
    expect(faceTables.rows.map((row) => row.table_name)).toEqual([
      "album_face_indexes",
      "face_album_jobs",
      "face_consent_receipts",
      "face_integration_events",
      "face_operation_diagnostics",
      "face_reference_deletion_sweeps",
      "face_search_candidates",
      "face_search_intents",
      "media_face_index_tasks",
    ]);

    const forbiddenColumns = await pool.query<{ column_name: string }>(
      `select column_name
       from information_schema.columns
       where table_schema = 'public'
         and table_name in (
           'album_face_indexes',
           'face_album_jobs',
           'face_consent_receipts',
           'face_integration_events',
           'face_operation_diagnostics',
           'face_reference_deletion_sweeps',
           'face_search_candidates',
           'face_search_intents',
           'media_face_index_tasks'
         )
         and (
           column_name like '%vector%'
           or column_name like '%similarity%'
           or (column_name like '%cluster%' and column_name <> 'last_clustered_at')
           or column_name like '%face_box%'
           or column_name like '%payload%'
           or column_name like '%uri%'
           or column_name in ('name', 'ip_address', 'user_agent', 'image_body')
         )`,
    );
    expect(forbiddenColumns.rows).toEqual([]);
  });

  it("enforces cross-album media and bib invariants in PostgreSQL", async () => {
    const admin = await insertAdmin();
    const [albumA, albumB] = await database
      .insert(schema.albums)
      .values([
        {
          slug: "db-invariant-a",
          title: "DB invariant A",
          access: "password",
          passwordHash: "hash:a",
          idempotencyKey: "db-invariant-a",
          createdBy: admin.id,
        },
        {
          slug: "db-invariant-b",
          title: "DB invariant B",
          access: "password",
          passwordHash: "hash:b",
          idempotencyKey: "db-invariant-b",
          createdBy: admin.id,
        },
      ])
      .returning();
    if (albumA === undefined || albumB === undefined) {
      throw new Error("Expected inserted invariant albums");
    }

    const [categoryA, categoryB] = await database
      .insert(schema.categories)
      .values([
        {
          albumId: albumA.id,
          name: "A",
          idempotencyKey: "db-invariant-category-a",
          createdBy: admin.id,
        },
        {
          albumId: albumB.id,
          name: "B",
          idempotencyKey: "db-invariant-category-b",
          createdBy: admin.id,
        },
      ])
      .returning();
    if (categoryA === undefined || categoryB === undefined) {
      throw new Error("Expected inserted invariant categories");
    }

    await expect(
      database.insert(schema.media).values({
        albumId: albumA.id,
        categoryId: categoryB.id,
        uploaderId: admin.id,
        width: 100,
        height: 100,
        mediaType: "image/jpeg",
        totalBytes: 100,
      }),
    ).rejects.toThrow(/media category must belong to the same album/u);

    const [mediaA] = await database
      .insert(schema.media)
      .values({
        albumId: albumA.id,
        categoryId: categoryA.id,
        uploaderId: admin.id,
        width: 100,
        height: 100,
        mediaType: "image/jpeg",
        totalBytes: 100,
      })
      .returning();
    if (mediaA === undefined) throw new Error("Expected inserted invariant media");

    const gradeA = "019d2000-0000-7000-8000-000000000001";
    const gradeB = "019d2000-0000-7000-8000-000000000002";
    const gradeA2 = "019d2000-0000-7000-8000-000000000003";
    const classA = "019d2000-0000-7000-8000-000000000004";
    const classA2 = "019d2000-0000-7000-8000-000000000005";
    await database.insert(schema.bibAttributeOptions).values([
      {
        id: gradeA,
        albumId: albumA.id,
        dimension: "grade",
        displayName: "A 年级 1",
        sortOrder: 0,
        ordinal: 0,
        enabled: true,
      },
      {
        id: gradeA2,
        albumId: albumA.id,
        dimension: "grade",
        displayName: "A 年级 2",
        sortOrder: 1,
        ordinal: 1,
        enabled: true,
      },
      {
        id: gradeB,
        albumId: albumB.id,
        dimension: "grade",
        displayName: "B 年级",
        sortOrder: 0,
        ordinal: 0,
        enabled: true,
      },
      {
        id: classA,
        albumId: albumA.id,
        dimension: "class",
        displayName: "A 1班",
        sortOrder: 0,
        ordinal: 0,
        enabled: true,
        parentGradeOptionId: gradeA,
      },
      {
        id: classA2,
        albumId: albumA.id,
        dimension: "class",
        displayName: "A 2班",
        sortOrder: 1,
        ordinal: 0,
        enabled: true,
        parentGradeOptionId: gradeA2,
      },
    ]);

    await expect(
      database.insert(schema.bibAttributeOptions).values({
        id: "019d2000-0000-7000-8000-000000000006",
        albumId: albumA.id,
        dimension: "class",
        displayName: "跨活动班级",
        sortOrder: 2,
        ordinal: 1,
        enabled: true,
        parentGradeOptionId: gradeB,
      }),
    ).rejects.toThrow(/class option parent must be a grade option in the same album/u);

    const tagBase = {
      mediaId: mediaA.id,
      numberCiphertext: "ciphertext",
      numberIv: "0".repeat(24),
      numberAuthTag: "1".repeat(24),
      keyVersion: "test-v1",
      status: "confirmed" as const,
      source: "manual" as const,
      ruleVersion: 1,
      mappingVersion: 1,
      createdBy: admin.id,
    };

    await expect(
      database.insert(schema.mediaBibTags).values({
        ...tagBase,
        albumId: albumB.id,
        blindIndex: "a".repeat(64),
        gradeOptionId: gradeB,
        classOptionId: null,
      }),
    ).rejects.toThrow(/bib tag media must belong to the same album/u);

    await expect(
      database.insert(schema.mediaBibTags).values({
        ...tagBase,
        albumId: albumA.id,
        blindIndex: "b".repeat(64),
        gradeOptionId: gradeB,
        classOptionId: null,
      }),
    ).rejects.toThrow(/bib tag grade option must belong to the same album and grade dimension/u);

    await expect(
      database.insert(schema.mediaBibTags).values({
        ...tagBase,
        albumId: albumA.id,
        blindIndex: "c".repeat(64),
        gradeOptionId: gradeA,
        classOptionId: classA2,
      }),
    ).rejects.toThrow(/bib tag class option must belong to the selected grade option/u);

    await expect(
      database.insert(schema.bibAttributeMappingsLegacy).values({
        albumId: albumA.id,
        dimension: "class",
        startPosition: 1,
        width: 1,
        outputOptionId: gradeA,
        sortOrder: 0,
      }),
    ).rejects.toThrow(
      /legacy bib mapping output option must belong to the same album and dimension/u,
    );

    await expect(
      database.insert(schema.mediaBibTags).values({
        ...tagBase,
        albumId: albumA.id,
        blindIndex: "d".repeat(64),
        gradeOptionId: gradeA,
        classOptionId: classA,
      }),
    ).resolves.toBeDefined();
  });

  it("compacts legacy exact bib mappings without deleting rollback data", async () => {
    const admin = await insertAdmin();
    const [album] = await database
      .insert(schema.albums)
      .values({
        slug: "legacy-bib",
        title: "Legacy bib migration",
        access: "password",
        passwordHash: "hash:test",
        idempotencyKey: "legacy-bib-migration",
        createdBy: admin.id,
      })
      .returning();
    if (album === undefined) throw new Error("Expected inserted album");

    const gradeOne = "019d1000-0000-7000-8000-000000000001";
    const gradeTwo = "019d1000-0000-7000-8000-000000000002";
    const gradeOneClassOne = "019d1000-0000-7000-8000-000000000003";
    const gradeOneClassTwo = "019d1000-0000-7000-8000-000000000004";
    const gradeTwoClassOne = "019d1000-0000-7000-8000-000000000005";
    await database.insert(schema.bibAttributeOptions).values([
      {
        id: gradeOne,
        albumId: album.id,
        dimension: "grade",
        displayName: "初一",
        sortOrder: 0,
        ordinal: null,
        enabled: true,
      },
      {
        id: gradeTwo,
        albumId: album.id,
        dimension: "grade",
        displayName: "初二",
        sortOrder: 1,
        ordinal: null,
        enabled: true,
      },
      {
        id: gradeOneClassOne,
        albumId: album.id,
        dimension: "class",
        displayName: "1班",
        sortOrder: 0,
        ordinal: null,
        enabled: true,
        parentGradeOptionId: gradeOne,
      },
      {
        id: gradeOneClassTwo,
        albumId: album.id,
        dimension: "class",
        displayName: "2班",
        sortOrder: 1,
        ordinal: null,
        enabled: true,
        parentGradeOptionId: gradeOne,
      },
      {
        id: gradeTwoClassOne,
        albumId: album.id,
        dimension: "class",
        displayName: "1班",
        sortOrder: 0,
        ordinal: null,
        enabled: true,
        parentGradeOptionId: gradeTwo,
      },
    ]);

    const legacy = [
      {
        dimension: "grade" as const,
        startPosition: 1,
        width: 1,
        value: "1",
        outputOptionId: gradeOne,
      },
      {
        dimension: "grade" as const,
        startPosition: 1,
        width: 1,
        value: "2",
        outputOptionId: gradeTwo,
      },
      {
        dimension: "class" as const,
        startPosition: 2,
        width: 2,
        value: "01",
        outputOptionId: gradeOneClassOne,
      },
      {
        dimension: "class" as const,
        startPosition: 2,
        width: 2,
        value: "02",
        outputOptionId: gradeOneClassTwo,
      },
      {
        dimension: "class" as const,
        startPosition: 2,
        width: 2,
        value: "01",
        outputOptionId: gradeTwoClassOne,
      },
    ];
    for (const [sortOrder, item] of legacy.entries()) {
      const [mapping] = await database
        .insert(schema.bibAttributeMappingsLegacy)
        .values({
          albumId: album.id,
          dimension: item.dimension,
          startPosition: item.startPosition,
          width: item.width,
          outputOptionId: item.outputOptionId,
          sortOrder,
        })
        .returning({ id: schema.bibAttributeMappingsLegacy.id });
      if (mapping === undefined) throw new Error("Expected inserted legacy mapping");
      await database.insert(schema.bibAttributeMappingRangesLegacy).values({
        mappingId: mapping.id,
        startValue: item.value,
        endValue: item.value,
        sortOrder: 0,
      });
    }

    const migrationPath = fileURLToPath(
      new URL("../drizzle/0041_compact_legacy_bib_mappings.sql", import.meta.url),
    );
    const migrationSql = await readFile(migrationPath, "utf8");
    const statements = migrationSql
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    for (const statement of statements) await pool.query(statement);
    for (const statement of statements) await pool.query(statement);

    const rules = await database
      .select()
      .from(schema.bibAttributeRules)
      .where(eq(schema.bibAttributeRules.albumId, album.id));
    expect(rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dimension: "grade",
          startPosition: 1,
          width: 1,
          firstValue: 1,
        }),
        expect.objectContaining({
          dimension: "class",
          startPosition: 2,
          width: 2,
          firstValue: 1,
        }),
      ]),
    );

    const options = await database
      .select({
        id: schema.bibAttributeOptions.id,
        ordinal: schema.bibAttributeOptions.ordinal,
      })
      .from(schema.bibAttributeOptions)
      .where(eq(schema.bibAttributeOptions.albumId, album.id));
    expect(options).toEqual(
      expect.arrayContaining([
        { id: gradeOne, ordinal: 0 },
        { id: gradeTwo, ordinal: 1 },
        { id: gradeOneClassOne, ordinal: 0 },
        { id: gradeOneClassTwo, ordinal: 1 },
        { id: gradeTwoClassOne, ordinal: 0 },
      ]),
    );

    const retainedLegacyMappings = await database
      .select()
      .from(schema.bibAttributeMappingsLegacy)
      .where(eq(schema.bibAttributeMappingsLegacy.albumId, album.id));
    expect(retainedLegacyMappings).toHaveLength(5);
  });

  async function insertAdmin() {
    const [created] = await database
      .insert(users)
      .values({
        username: "Admin",
        normalizedUsername: "admin",
        displayName: "系统管理员",
        role: "admin",
        passwordHash: "not-a-real-hash",
      })
      .returning();
    if (created === undefined) throw new Error("Expected inserted user");
    return created;
  }
});
