import { createHmac, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { createDatabase, createPool, migrateDatabase, schema } from "@photostream/db";
import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { loadConfig } from "../config.js";
import { LocalObjectStorage } from "./object-storage.js";
import { PhotoService } from "./service.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl !== undefined && new URL(databaseUrl).pathname !== "/photostream_test") {
  throw new Error("TEST_DATABASE_URL must target the dedicated photostream_test database");
}
const maybeDescribe = databaseUrl === undefined ? describe.skip : describe;
const legacyHiddenAt = new Date("2026-09-01T00:00:00.000Z");

maybeDescribe("review backlog consistency and historical repair", () => {
  const pool = createPool(databaseUrl ?? "");
  const database = createDatabase(pool);
  const config = loadConfig({
    NODE_ENV: "test",
    APP_ORIGIN: "http://localhost:3000",
    MEDIA_BASE_URL: "https://cdn.cloverta.top",
    DATABASE_URL: databaseUrl ?? "postgresql://invalid/photostream_test",
    SESSION_SECRET_CURRENT: "s".repeat(32),
    CSRF_SECRET: "c".repeat(32),
    CURSOR_SIGNING_SECRET: "u".repeat(32),
    VISITOR_SESSION_SECRET: "v".repeat(32),
    ALBUM_PASSWORD_GENERATION_SECRET: "a".repeat(32),
    USER_PASSWORD_GENERATION_SECRET: "w".repeat(32),
    ANALYTICS_HMAC_SECRET: "n".repeat(32),
    LOCAL_OBJECT_SECRET: "o".repeat(32),
  });
  const service = new PhotoService({
    database,
    storage: new LocalObjectStorage({
      baseUrl: "http://127.0.0.1:3002",
      secret: "o".repeat(32),
    }),
    passwordHasher: {
      async hash(value) {
        return `fixture:${value}`;
      },
      async verify(hash, value) {
        return hash === `fixture:${value}`;
      },
    },
    config,
  });
  let repairSql = "";
  const actorIds: string[] = [];
  const albumIds: string[] = [];

  beforeAll(async () => {
    await migrateDatabase(
      pool,
      fileURLToPath(new URL("../../../../packages/db/drizzle", import.meta.url)),
    );
    repairSql = await readFile(
      new URL(
        "../../../../packages/db/drizzle/0047_repair_hidden_review_backfill.sql",
        import.meta.url,
      ),
      "utf8",
    );
  });

  afterEach(async () => {
    if (actorIds.length > 0) {
      await database
        .delete(schema.auditLogs)
        .where(inArray(schema.auditLogs.actorUserId, actorIds));
    }
    if (albumIds.length > 0) {
      await database.delete(schema.albums).where(inArray(schema.albums.id, albumIds));
    }
    if (actorIds.length > 0) {
      await database.delete(schema.users).where(inArray(schema.users.id, actorIds));
    }
    actorIds.length = 0;
    albumIds.length = 0;
  });

  afterAll(async () => pool.end());

  async function createFixture() {
    const suffix = randomUUID();
    const users = await database
      .insert(schema.users)
      .values(
        (["admin", "reviewer"] as const).map((role) => ({
          username: `${role}-${suffix}`,
          normalizedUsername: `${role}-${suffix}`,
          displayName: role === "admin" ? "测试管理员" : "测试审核员",
          role,
          passwordHash: "fixture-hash",
          mustChangePassword: false,
        })),
      )
      .returning({ id: schema.users.id, role: schema.users.role });
    actorIds.push(...users.map((user) => user.id));
    const admin = users.find((user) => user.role === "admin");
    const reviewer = users.find((user) => user.role === "reviewer");
    if (admin === undefined || reviewer === undefined) throw new Error("Missing fixture users");
    const [album] = await database
      .insert(schema.albums)
      .values({
        slug: randomUUID().replaceAll("-", ""),
        title: "测试审核积压",
        createdBy: admin.id,
        idempotencyKey: randomUUID(),
      })
      .returning({ id: schema.albums.id });
    if (album === undefined) throw new Error("Missing fixture album");
    albumIds.push(album.id);
    return { albumId: album.id, admin, reviewer };
  }

  function mediaFixture(albumId: string, uploaderId: string) {
    return {
      albumId,
      uploaderId,
      ingestStatus: "ready" as const,
      publicationStatus: "hidden" as const,
      width: 100,
      height: 100,
      mediaType: "image/jpeg",
      totalBytes: 100,
      hiddenAt: legacyHiddenAt,
      createdAt: legacyHiddenAt,
      updatedAt: legacyHiddenAt,
    };
  }

  it("restores a preexisting 2000-photo backlog to two reviewers without waiting for uploads", async () => {
    const { albumId, admin, reviewer } = await createFixture();
    await database.insert(schema.media).values(
      Array.from({ length: 2_000 }, () => ({
        ...mediaFixture(albumId, admin.id),
        // Migration 0030 inferred review from default hidden visibility.
        reviewedAt: legacyHiddenAt,
      })),
    );
    await service.updateReviewCollaboration({
      actor: admin,
      albumId,
      participantIds: [admin.id, reviewer.id],
      requestId: "fixture-review-collaboration",
    });

    await pool.query(repairSql);

    const collaboration = await service.getReviewCollaboration(admin, albumId);
    expect(collaboration.participants.map((participant) => participant.remainingCount)).toEqual([
      1_000, 1_000,
    ]);
    for (const actor of [admin, reviewer]) {
      const selection = await service.listInternalMediaSelection(actor, {
        albumId,
        reviewAssignment: "mine",
        reviewStatus: "pending",
        limit: 1_000,
      });
      expect(selection.total).toBe(1_000);
      expect(selection.items).toHaveLength(1_000);
      const page = await service.listInternalMedia(actor, {
        albumId,
        reviewAssignment: "mine",
        reviewStatus: "pending",
        limit: 60,
      });
      expect(page.items).toHaveLength(60);
      expect(page.nextCursor).not.toBeNull();
    }
    const summary = (await service.listAlbumSummaries(admin)).find((album) => album.id === albumId);
    expect(summary?.pendingReviewCount).toBe(2_000);
  });

  it("preserves genuine review and publication history, excludes deleted photos, and is idempotent", async () => {
    const { albumId, admin } = await createFixture();
    const explicitReviewedAt = new Date("2026-09-02T00:00:00.000Z");
    const inserted = await database
      .insert(schema.media)
      .values([
        { ...mediaFixture(albumId, admin.id), reviewedAt: legacyHiddenAt },
        { ...mediaFixture(albumId, admin.id), reviewedAt: explicitReviewedAt },
        { ...mediaFixture(albumId, admin.id), reviewedAt: legacyHiddenAt },
        { ...mediaFixture(albumId, admin.id), reviewedAt: legacyHiddenAt },
        { ...mediaFixture(albumId, admin.id), reviewedAt: legacyHiddenAt },
        { ...mediaFixture(albumId, admin.id), reviewedAt: legacyHiddenAt },
        {
          ...mediaFixture(albumId, admin.id),
          reviewedAt: legacyHiddenAt,
          publishedAt: legacyHiddenAt,
          publishSequence: 1,
        },
        {
          ...mediaFixture(albumId, admin.id),
          publicationStatus: "published",
          reviewedAt: legacyHiddenAt,
          publishedAt: legacyHiddenAt,
          publishSequence: 2,
        },
        {
          ...mediaFixture(albumId, admin.id),
          publicationStatus: "deleted",
          reviewedAt: legacyHiddenAt,
        },
        { ...mediaFixture(albumId, admin.id), reviewedAt: null },
        { ...mediaFixture(albumId, admin.id), reviewedAt: legacyHiddenAt },
      ])
      .returning({ id: schema.media.id });
    const actions = ["media.reviewed", "media.hidden", "media.published", "media.restored"];
    await database.insert(schema.auditLogs).values(
      actions.map((action, index) => {
        const row = inserted[index + 2];
        if (row === undefined) throw new Error("Missing history fixture");
        return {
          actorUserId: admin.id,
          action,
          targetType: "media",
          targetId: row.id,
          result: "success",
          requestId: `fixture-${action}`,
        };
      }),
    );
    await database.insert(schema.auditLogs).values({
      actorUserId: admin.id,
      action: "media.hidden",
      targetType: "media",
      targetId: inserted[0]?.id ?? null,
      result: "failure",
      requestId: "fixture-failed-hide",
    });
    const publishedEventPhoto = inserted[10];
    if (publishedEventPhoto === undefined) throw new Error("Missing publication event fixture");
    await database.insert(schema.liveEvents).values({
      albumId,
      mediaId: publishedEventPhoto.id,
      type: "media.published",
      payload: {},
    });

    await pool.query(repairSql);
    const repaired = await database
      .select({ id: schema.media.id, reviewedAt: schema.media.reviewedAt })
      .from(schema.media)
      .where(eq(schema.media.albumId, albumId))
      .orderBy(schema.media.id);
    const repairedById = new Map(repaired.map((item) => [item.id, item.reviewedAt]));
    expect(repairedById.get(inserted[0]?.id ?? "")).toBeNull();
    expect(repairedById.get(inserted[1]?.id ?? "")).toEqual(explicitReviewedAt);
    for (const item of inserted.slice(2, 9)) {
      expect(repairedById.get(item.id)).toEqual(legacyHiddenAt);
    }
    expect(repairedById.get(inserted[9]?.id ?? "")).toBeNull();
    expect(repairedById.get(publishedEventPhoto.id)).toEqual(legacyHiddenAt);

    const version = await service.reviewRevision(admin, albumId);
    await pool.query(repairSql);
    expect(await service.reviewRevision(admin, albumId)).toBe(version);
    expect(
      await database
        .select({ id: schema.media.id, reviewedAt: schema.media.reviewedAt })
        .from(schema.media)
        .where(eq(schema.media.albumId, albumId))
        .orderBy(schema.media.id),
    ).toEqual(repaired);
  });

  it("uses the same pending-review definition for summaries, pages, selections, and assignments", async () => {
    const { albumId, admin, reviewer } = await createFixture();
    const inserted = await database
      .insert(schema.media)
      .values([
        mediaFixture(albumId, admin.id),
        { ...mediaFixture(albumId, admin.id), publicationStatus: "pending_review" },
        {
          ...mediaFixture(albumId, admin.id),
          publicationStatus: "draft",
          ingestStatus: "uploading_source",
        },
        { ...mediaFixture(albumId, admin.id), ingestStatus: "failed" },
        { ...mediaFixture(albumId, admin.id), reviewedAt: legacyHiddenAt },
        { ...mediaFixture(albumId, admin.id), publicationStatus: "deleted" },
        {
          ...mediaFixture(albumId, admin.id),
          publicationStatus: "published",
          reviewedAt: legacyHiddenAt,
          publishedAt: legacyHiddenAt,
          publishSequence: 1,
        },
      ])
      .returning({ id: schema.media.id });
    await service.updateReviewCollaboration({
      actor: admin,
      albumId,
      participantIds: [admin.id, reviewer.id],
      requestId: "fixture-review-consistency",
    });
    const expectedIds = new Set(inserted.slice(0, 4).map((item) => item.id));
    const page = await service.listInternalMedia(admin, {
      albumId,
      reviewStatus: "pending",
      limit: 60,
    });
    const selection = await service.listInternalMediaSelection(admin, {
      albumId,
      reviewStatus: "pending",
      limit: 1_000,
    });
    const summary = (await service.listAlbumSummaries(admin)).find((album) => album.id === albumId);
    const collaboration = await service.getReviewCollaboration(admin, albumId);
    expect(new Set(page.items.map((item) => item.id))).toEqual(expectedIds);
    expect(new Set(selection.items.map((item) => item.id))).toEqual(expectedIds);
    expect(selection.total).toBe(4);
    expect(summary?.pendingReviewCount).toBe(4);
    expect(collaboration.participants.map((participant) => participant.remainingCount)).toEqual([
      2, 2,
    ]);
  });

  it("paginates exact PostgreSQL microseconds without repeated or skipped photos in either order", async () => {
    const { albumId, admin } = await createFixture();
    const chronologicalIds = [
      "00000000-0000-7000-8000-000000000003",
      "00000000-0000-7000-8000-000000000002",
      "00000000-0000-7000-8000-000000000001",
    ];
    await database.insert(schema.media).values(
      chronologicalIds.map((id) => ({
        ...mediaFixture(albumId, admin.id),
        id,
      })),
    );
    const timestamps = [
      "2026-09-01T00:00:00.123001Z",
      "2026-09-01T00:00:00.123002Z",
      "2026-09-01T00:00:00.123900Z",
    ];
    for (const [index, id] of chronologicalIds.entries()) {
      await pool.query("update media set created_at = $1::timestamptz where id = $2::uuid", [
        timestamps[index],
        id,
      ]);
    }

    for (const sort of ["oldest", "newest"] as const) {
      const expected = sort === "oldest" ? chronologicalIds : [...chronologicalIds].reverse();
      for (const surface of ["media", "selection"] as const) {
        const seen: string[] = [];
        let cursor: string | undefined;
        let completed = false;
        for (let step = 0; step < 6; step += 1) {
          const options = { albumId, sort, limit: 1, cursor };
          const page =
            surface === "media"
              ? await service.listInternalMedia(admin, options)
              : await service.listInternalMediaSelection(admin, options);
          seen.push(...page.items.map((item) => item.id));
          if (page.nextCursor === null) {
            completed = true;
            break;
          }
          cursor = page.nextCursor;
        }
        expect(seen, `${surface} ${sort}`).toEqual(expected);
        expect(new Set(seen).size, `${surface} ${sort} uniqueness`).toBe(3);
        expect(completed, `${surface} ${sort} completion`).toBe(true);
      }
    }
  });

  it("continues legacy signed millisecond cursors using the precise anchor and tolerates its deletion", async () => {
    const { albumId, admin } = await createFixture();
    const chronologicalIds = [randomUUID(), randomUUID(), randomUUID()].sort().reverse();
    await database
      .insert(schema.media)
      .values(chronologicalIds.map((id) => ({ ...mediaFixture(albumId, admin.id), id })));
    const timestamps = [
      "2026-09-01T00:00:00.123001Z",
      "2026-09-01T00:00:00.123002Z",
      "2026-09-01T00:00:00.123900Z",
    ];
    for (const [index, id] of chronologicalIds.entries()) {
      await pool.query("update media set created_at = $1::timestamptz where id = $2::uuid", [
        timestamps[index],
        id,
      ]);
    }
    const anchorId = chronologicalIds[1];
    if (anchorId === undefined) throw new Error("Missing cursor anchor fixture");
    function legacyCursor(sort: "oldest" | "newest") {
      const encoded = Buffer.from(
        JSON.stringify({
          albumId,
          createdAt: "2026-09-01T00:00:00.123Z",
          mediaId: anchorId,
          sort,
        }),
        "utf8",
      ).toString("base64url");
      const signature = createHmac("sha256", "u".repeat(32))
        .update(encoded, "utf8")
        .digest("base64url");
      return `${encoded}.${signature}`;
    }
    async function expectContinuation() {
      for (const sort of ["oldest", "newest"] as const) {
        const expectedId = sort === "oldest" ? chronologicalIds[2] : chronologicalIds[0];
        const options = { albumId, sort, limit: 1, cursor: legacyCursor(sort) };
        const page = await service.listInternalMedia(admin, options);
        const selection = await service.listInternalMediaSelection(admin, options);
        expect(
          page.items.map((item) => item.id),
          `legacy media ${sort}`,
        ).toEqual([expectedId]);
        expect(
          selection.items.map((item) => item.id),
          `legacy selection ${sort}`,
        ).toEqual([expectedId]);
        expect(page.nextCursor).toBeNull();
        expect(selection.nextCursor).toBeNull();
      }
    }
    await expectContinuation();

    // Once the old anchor is physically deleted, its microseconds cannot be
    // reconstructed. The retained millisecond boundary still remains usable.
    await database.delete(schema.media).where(eq(schema.media.id, anchorId));
    await pool.query("update media set created_at = $1::timestamptz where id = $2::uuid", [
      "2026-09-01T00:00:00.122999Z",
      chronologicalIds[0],
    ]);
    await pool.query("update media set created_at = $1::timestamptz where id = $2::uuid", [
      "2026-09-01T00:00:00.124000Z",
      chronologicalIds[2],
    ]);
    await expectContinuation();
  });
});
