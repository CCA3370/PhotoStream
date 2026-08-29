import { createHmac } from "node:crypto";

import { type AdminUserView, normalizeUsername, type UserRole } from "@photostream/contracts";
import type { Database } from "@photostream/db";
import { schema } from "@photostream/db";
import { and, eq, isNull, sql } from "drizzle-orm";

import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import {
  findOperationRequest,
  lockOperationRequest,
  operationRequestHash,
  saveOperationRequest,
} from "../idempotency.js";
import type { PasswordHasher } from "./types.js";

const recentAuthenticationMs = 15 * 60 * 1_000;

function view(row: typeof schema.users.$inferSelect): AdminUserView {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    isActive: row.isActive,
    mustChangePassword: row.mustChangePassword,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function requireAdmin(role: UserRole): void {
  if (role !== "admin") {
    throw new AppError({ code: "FORBIDDEN", message: "仅管理员可以管理成员", statusCode: 403 });
  }
}

function requireIdempotencyKey(value: string | undefined): string {
  if (value === undefined || value.length < 16 || value.length > 128) {
    throw new AppError({ code: "BAD_REQUEST", message: "缺少有效幂等键", statusCode: 400 });
  }
  return value;
}

export class UserAdminService {
  readonly #database: Database;
  readonly #hasher: PasswordHasher;
  readonly #passwordSecret: string;

  constructor(options: {
    readonly database: Database;
    readonly passwordHasher: PasswordHasher;
    readonly config: AppConfig;
  }) {
    this.#database = options.database;
    this.#hasher = options.passwordHasher;
    this.#passwordSecret = options.config.USER_PASSWORD_GENERATION_SECRET;
  }

  async listUsers(actor: { readonly role: UserRole }): Promise<AdminUserView[]> {
    requireAdmin(actor.role);
    return (await this.#database.select().from(schema.users).orderBy(schema.users.createdAt)).map(
      view,
    );
  }

  async createUser(options: {
    readonly actor: { readonly id: string; readonly role: UserRole };
    readonly input: {
      readonly username: string;
      readonly displayName: string;
      readonly role: UserRole;
    };
    readonly idempotencyKey: string | undefined;
    readonly requestId: string;
  }): Promise<{ readonly user: AdminUserView; readonly generatedTemporaryPassword: string }> {
    requireAdmin(options.actor.role);
    const idempotencyKey = requireIdempotencyKey(options.idempotencyKey);
    const normalizedUsername = normalizeUsername(options.input.username);
    const generatedTemporaryPassword = this.#temporaryPassword(
      `create\n${options.actor.id}\n${idempotencyKey}`,
    );
    const passwordHash = await this.#hasher.hash(generatedTemporaryPassword);
    return this.#database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`user-create:${options.actor.id}:${idempotencyKey}`}, 0))`,
      );
      const [retried] = await transaction
        .select()
        .from(schema.users)
        .where(
          and(
            eq(schema.users.creationActorId, options.actor.id),
            eq(schema.users.creationIdempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (retried !== undefined) {
        if (
          retried.normalizedUsername !== normalizedUsername ||
          retried.displayName !== options.input.displayName.trim() ||
          retried.role !== options.input.role
        ) {
          throw new AppError({
            code: "IDEMPOTENCY_CONFLICT",
            message: "同一幂等键不能用于不同成员请求",
            statusCode: 409,
          });
        }
        return { user: view(retried), generatedTemporaryPassword };
      }
      const [sameUsername] = await transaction
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.normalizedUsername, normalizedUsername))
        .limit(1);
      if (sameUsername !== undefined) {
        throw new AppError({ code: "CONFLICT", message: "用户名已存在", statusCode: 409 });
      }
      const now = new Date();
      const [created] = await transaction
        .insert(schema.users)
        .values({
          username: options.input.username.trim(),
          normalizedUsername,
          displayName: options.input.displayName.trim(),
          role: options.input.role,
          passwordHash,
          isActive: true,
          mustChangePassword: true,
          creationActorId: options.actor.id,
          creationIdempotencyKey: idempotencyKey,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (created === undefined) throw new Error("User insert returned no row");
      await transaction.insert(schema.auditLogs).values({
        actorUserId: options.actor.id,
        action: "user.created",
        targetType: "user",
        targetId: created.id,
        result: "success",
        changedFields: ["username", "displayName", "role", "mustChangePassword"],
        requestId: options.requestId,
      });
      return { user: view(created), generatedTemporaryPassword };
    });
  }

  async updateUser(options: {
    readonly actor: { readonly id: string; readonly role: UserRole };
    readonly userId: string;
    readonly input: {
      readonly displayName?: string | undefined;
      readonly role?: UserRole | undefined;
      readonly isActive?: boolean | undefined;
    };
    readonly requestId: string;
  }): Promise<AdminUserView> {
    requireAdmin(options.actor.role);
    return this.#database.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(130071002)`);
      const [current] = await transaction
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, options.userId))
        .limit(1);
      if (current === undefined) throw this.#userNotFound();
      const displayName = options.input.displayName?.trim();
      const displayNameChanged = displayName !== undefined && displayName !== current.displayName;
      const roleChanged = options.input.role !== undefined && options.input.role !== current.role;
      const activeChanged =
        options.input.isActive !== undefined && options.input.isActive !== current.isActive;
      const removesActiveAdmin =
        current.isActive &&
        current.role === "admin" &&
        ((activeChanged && options.input.isActive === false) ||
          (roleChanged && options.input.role !== "admin"));
      if (removesActiveAdmin) {
        const [count] = await transaction
          .select({ value: sql<number>`count(*)::int` })
          .from(schema.users)
          .where(and(eq(schema.users.role, "admin"), eq(schema.users.isActive, true)));
        if ((count?.value ?? 0) <= 1) {
          throw new AppError({
            code: "STATE_CONFLICT",
            message: "必须至少保留一名启用的管理员",
            statusCode: 409,
          });
        }
      }
      const changedFields = [
        ...(displayNameChanged ? ["displayName"] : []),
        ...(roleChanged ? ["role"] : []),
        ...(activeChanged ? ["isActive"] : []),
      ];
      if (changedFields.length === 0) return view(current);
      const now = new Date();
      const [updated] = await transaction
        .update(schema.users)
        .set({
          ...(displayNameChanged ? { displayName } : {}),
          ...(roleChanged ? { role: options.input.role } : {}),
          ...(activeChanged ? { isActive: options.input.isActive } : {}),
          updatedAt: now,
        })
        .where(eq(schema.users.id, options.userId))
        .returning();
      if (updated === undefined) throw this.#userNotFound();
      if (roleChanged || activeChanged) {
        await transaction
          .update(schema.sessions)
          .set({ revokedAt: now })
          .where(
            and(eq(schema.sessions.userId, options.userId), isNull(schema.sessions.revokedAt)),
          );
        changedFields.push("sessions");
      }
      await transaction.insert(schema.auditLogs).values({
        actorUserId: options.actor.id,
        action: "user.updated",
        targetType: "user",
        targetId: options.userId,
        result: "success",
        changedFields,
        requestId: options.requestId,
      });
      return view(updated);
    });
  }

  async resetPassword(options: {
    readonly actor: {
      readonly id: string;
      readonly role: UserRole;
      readonly authenticatedAt: Date;
    };
    readonly userId: string;
    readonly idempotencyKey: string | undefined;
    readonly requestId: string;
    readonly now?: Date;
  }): Promise<string> {
    requireAdmin(options.actor.role);
    const now = options.now ?? new Date();
    if (now.getTime() - options.actor.authenticatedAt.getTime() > recentAuthenticationMs) {
      throw new AppError({
        code: "RECENT_AUTH_REQUIRED",
        message: "该高风险操作需要重新登录后执行",
        statusCode: 403,
      });
    }
    const idempotencyKey = requireIdempotencyKey(options.idempotencyKey);
    const generatedTemporaryPassword = this.#temporaryPassword(
      `reset\n${options.actor.id}\n${options.userId}\n${idempotencyKey}`,
    );
    const passwordHash = await this.#hasher.hash(generatedTemporaryPassword);
    await this.#database.transaction(async (transaction) => {
      const actorScope = `user:${options.actor.id}`;
      const operation = `user.password.reset:${options.userId}`;
      const requestHash = operationRequestHash({ userId: options.userId });
      await lockOperationRequest(transaction, { actorScope, operation, idempotencyKey });
      const retried = await findOperationRequest(transaction, {
        actorScope,
        operation,
        idempotencyKey,
        requestHash,
      });
      if (retried !== null) return;
      const [updated] = await transaction
        .update(schema.users)
        .set({ passwordHash, mustChangePassword: true, passwordChangedAt: now, updatedAt: now })
        .where(eq(schema.users.id, options.userId))
        .returning({ id: schema.users.id });
      if (updated === undefined) throw this.#userNotFound();
      await transaction
        .update(schema.sessions)
        .set({ revokedAt: now })
        .where(and(eq(schema.sessions.userId, options.userId), isNull(schema.sessions.revokedAt)));
      await transaction.insert(schema.auditLogs).values({
        actorUserId: options.actor.id,
        action: "user.password.reset",
        targetType: "user",
        targetId: options.userId,
        result: "success",
        changedFields: ["passwordHash", "mustChangePassword", "sessions"],
        requestId: options.requestId,
      });
      await saveOperationRequest(transaction, {
        actorScope,
        operation,
        idempotencyKey,
        requestHash,
        result: { userId: options.userId },
      });
    });
    return generatedTemporaryPassword;
  }

  #temporaryPassword(value: string): string {
    return `${createHmac("sha256", this.#passwordSecret).update(value, "utf8").digest("base64url").slice(0, 18)}!A1`;
  }

  #userNotFound(): AppError {
    return new AppError({ code: "USER_NOT_FOUND", message: "成员不存在", statusCode: 404 });
  }
}
