import type { Database } from "@photostream/db";
import { schema } from "@photostream/db";
import { and, eq, isNull, sql } from "drizzle-orm";

import { AppError } from "../errors.js";
import type {
  AuthSessionRecord,
  AuthStore,
  AuthUserRecord,
  BootstrapUserInput,
  NewSessionRecord,
} from "./types.js";

function toAuthUser(row: typeof schema.users.$inferSelect): AuthUserRecord {
  return {
    id: row.id,
    username: row.username,
    normalizedUsername: row.normalizedUsername,
    displayName: row.displayName,
    role: row.role,
    passwordHash: row.passwordHash,
    isActive: row.isActive,
    mustChangePassword: row.mustChangePassword,
  };
}

export class PostgresAuthStore implements AuthStore {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  async ping(): Promise<void> {
    await this.#database.execute(sql`select 1`);
  }

  async findUserByNormalizedUsername(normalizedUsername: string): Promise<AuthUserRecord | null> {
    const [row] = await this.#database
      .select()
      .from(schema.users)
      .where(eq(schema.users.normalizedUsername, normalizedUsername))
      .limit(1);
    return row === undefined ? null : toAuthUser(row);
  }

  async findSessionByTokenHash(tokenHash: string): Promise<AuthSessionRecord | null> {
    const [row] = await this.#database
      .select({ session: schema.sessions, user: schema.users })
      .from(schema.sessions)
      .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
      .where(eq(schema.sessions.tokenHash, tokenHash))
      .limit(1);

    if (row === undefined) {
      return null;
    }
    return {
      ...row.session,
      user: toAuthUser(row.user),
    };
  }

  async createSession(input: NewSessionRecord): Promise<string> {
    const [row] = await this.#database
      .insert(schema.sessions)
      .values(input)
      .returning({ id: schema.sessions.id });
    if (row === undefined) {
      throw new Error("Session insert returned no row");
    }
    return row.id;
  }

  async touchSession(id: string, lastSeenAt: Date, idleExpiresAt: Date): Promise<void> {
    await this.#database
      .update(schema.sessions)
      .set({ lastSeenAt, idleExpiresAt })
      .where(and(eq(schema.sessions.id, id), isNull(schema.sessions.revokedAt)));
  }

  async revokeSession(id: string, revokedAt: Date): Promise<void> {
    await this.#database
      .update(schema.sessions)
      .set({ revokedAt })
      .where(and(eq(schema.sessions.id, id), isNull(schema.sessions.revokedAt)));
  }

  async updatePasswordAndRevokeSessions(
    userId: string,
    passwordHash: string,
    changedAt: Date,
    requestId: string,
  ): Promise<void> {
    await this.#database.transaction(async (transaction) => {
      await transaction
        .update(schema.users)
        .set({
          passwordHash,
          mustChangePassword: false,
          passwordChangedAt: changedAt,
          updatedAt: changedAt,
        })
        .where(eq(schema.users.id, userId));
      await transaction
        .update(schema.sessions)
        .set({ revokedAt: changedAt })
        .where(and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)));
      await transaction.insert(schema.auditLogs).values({
        actorUserId: userId,
        action: "auth.password.changed",
        targetType: "user",
        targetId: userId,
        result: "success",
        changedFields: ["passwordHash", "mustChangePassword", "sessions"],
        requestId,
      });
    });
  }

  async createBootstrapAdmin(input: BootstrapUserInput): Promise<AuthUserRecord> {
    return this.#database.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(130071001)`);
      const [existing] = await transaction
        .select({ id: schema.users.id })
        .from(schema.users)
        .limit(1);
      if (existing !== undefined) {
        throw new AppError({
          code: "CONFLICT",
          message: "首位管理员已初始化",
          statusCode: 409,
        });
      }

      const [created] = await transaction
        .insert(schema.users)
        .values({
          username: input.username,
          normalizedUsername: input.normalizedUsername,
          displayName: input.displayName,
          role: input.role,
          passwordHash: input.passwordHash,
          isActive: true,
          mustChangePassword: true,
        })
        .returning();
      if (created === undefined) {
        throw new Error("Bootstrap user insert returned no row");
      }
      await transaction.insert(schema.auditLogs).values({
        actorUserId: created.id,
        action: "user.bootstrap.created",
        targetType: "user",
        targetId: created.id,
        result: "success",
        changedFields: ["username", "displayName", "role"],
        requestId: input.requestId,
      });
      return toAuthUser(created);
    });
  }
}
