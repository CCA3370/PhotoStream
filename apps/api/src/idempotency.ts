import { createHash } from "node:crypto";

import type { Database } from "@photostream/db";
import { schema } from "@photostream/db";
import { and, eq, sql } from "drizzle-orm";

import { AppError } from "./errors.js";

export type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export function operationRequestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export async function lockOperationRequest(
  transaction: DatabaseTransaction,
  options: {
    readonly actorScope: string;
    readonly operation: string;
    readonly idempotencyKey: string;
  },
): Promise<void> {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${options.actorScope}:${options.operation}:${options.idempotencyKey}`}, 0))`,
  );
}

export async function findOperationRequest(
  transaction: DatabaseTransaction,
  options: {
    readonly actorScope: string;
    readonly operation: string;
    readonly idempotencyKey: string;
    readonly requestHash: string;
  },
): Promise<Record<string, unknown> | null> {
  const [record] = await transaction
    .select()
    .from(schema.operationRequests)
    .where(
      and(
        eq(schema.operationRequests.actorScope, options.actorScope),
        eq(schema.operationRequests.operation, options.operation),
        eq(schema.operationRequests.idempotencyKey, options.idempotencyKey),
      ),
    )
    .limit(1);
  if (record === undefined) return null;
  if (record.requestHash !== options.requestHash) {
    throw new AppError({
      code: "IDEMPOTENCY_CONFLICT",
      message: "同一幂等键不能用于不同请求",
      statusCode: 409,
    });
  }
  return record.result;
}

export async function saveOperationRequest(
  transaction: DatabaseTransaction,
  options: {
    readonly actorScope: string;
    readonly operation: string;
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly result: Record<string, unknown>;
  },
): Promise<void> {
  await transaction.insert(schema.operationRequests).values(options);
}
