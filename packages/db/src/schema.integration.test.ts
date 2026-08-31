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
           'face_search_candidates',
           'face_search_intents',
           'media_face_index_tasks'
         )
         and (
           column_name like '%vector%'
           or column_name like '%similarity%'
           or column_name like '%cluster%'
           or column_name like '%face_box%'
           or column_name like '%payload%'
           or column_name like '%uri%'
           or column_name in ('name', 'ip_address', 'user_agent', 'image_body')
         )`,
    );
    expect(forbiddenColumns.rows).toEqual([]);
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
