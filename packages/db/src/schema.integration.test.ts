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
