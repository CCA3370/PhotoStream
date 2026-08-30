import { get } from "node:http";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { createDatabase, createPool, migrateDatabase, schema } from "@photostream/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { PostgresAuthStore } from "../auth/postgres-store.js";
import type { PasswordHasher } from "../auth/types.js";
import { loadConfig } from "../config.js";
import { LiveEventBroker, liveEventChannel } from "./live-event-broker.js";
import type { ObjectMetadata, ObjectStorage, SignedPut } from "./object-storage.js";
import { PhotoService } from "./service.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl !== undefined && new URL(databaseUrl).pathname !== "/photostream_test") {
  throw new Error("TEST_DATABASE_URL must target the dedicated photostream_test database");
}
const maybeDescribe = databaseUrl === undefined ? describe.skip : describe;

const capacityPort = 3101;
const config = loadConfig({
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: capacityPort.toString(),
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

class CapacityObjectStorage implements ObjectStorage {
  signPut(options: {
    readonly key: string;
    readonly contentType: string;
    readonly bytes: number;
    readonly expiresAt: Date;
  }): SignedPut {
    return {
      url: `https://objects.invalid/${options.key}`,
      headers: { "content-type": options.contentType },
      expiresAt: options.expiresAt,
    };
  }

  signRead(options: { readonly key: string; readonly expiresAt: Date }): string {
    return `https://cdn.cloverta.top/${options.key}?expires=${options.expiresAt.getTime()}`;
  }

  signMultipartPart(options: {
    readonly uploadId: string;
    readonly partNumber: number;
    readonly contentType: string;
    readonly bytes: number;
    readonly expiresAt: Date;
  }): SignedPut {
    return {
      url: `https://objects.invalid/multipart/${options.uploadId}/${options.partNumber}`,
      headers: { "content-type": options.contentType },
      expiresAt: options.expiresAt,
    };
  }

  async completeMultipart(): Promise<void> {
    throw new Error("Capacity test never uploads media bodies");
  }

  async head(): Promise<ObjectMetadata | null> {
    return null;
  }

  async delete(): Promise<void> {
    throw new Error("Capacity test never deletes media objects");
  }
}

function percentile(values: readonly number[], percentileValue: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

function withDeadline<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`${label} exceeded ${milliseconds}ms`)),
      milliseconds,
    );
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function openSse(url: string) {
  let establishedResolve: () => void;
  let establishedReject: (error: unknown) => void;
  const established = new Promise<void>((resolve, reject) => {
    establishedResolve = resolve;
    establishedReject = reject;
  });
  let eventResolve: (receivedAt: number) => void;
  let eventReject: (error: unknown) => void;
  const received = new Promise<number>((resolve, reject) => {
    eventResolve = resolve;
    eventReject = reject;
  });
  const request = get(url, (response) => {
    if (response.statusCode !== 200) {
      const error = new Error(`SSE returned ${response.statusCode}`);
      establishedReject(error);
      eventReject(error);
      response.resume();
      return;
    }
    establishedResolve();
    response.setEncoding("utf8");
    let buffer = "";
    response.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.includes("event: media.published\n")) eventResolve(performance.now());
      if (buffer.length > 16_384) buffer = buffer.slice(-8_192);
    });
  });
  request.on("error", (error) => {
    establishedReject(error);
    eventReject(error);
  });
  return { established, received, close: () => request.destroy() };
}

maybeDescribe("phase 2 local capacity", () => {
  const pool = createPool(databaseUrl ?? "");
  const database = createDatabase(pool);
  const storage = new CapacityObjectStorage();
  const service = new PhotoService({ database, storage, passwordHasher: fakeHasher, config });

  beforeAll(async () => {
    await migrateDatabase(
      pool,
      fileURLToPath(new URL("../../../../packages/db/drizzle", import.meta.url)),
    );
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
    await database.delete(schema.sessions);
    await database.delete(schema.users);
  });

  afterAll(async () => pool.end());

  it("pages 5000 media and fans one persistent event out to 500 clients", async () => {
    const [user] = await database
      .insert(schema.users)
      .values({
        username: "capacity-admin",
        normalizedUsername: "capacity-admin",
        displayName: "容量夹具管理员",
        role: "admin",
        passwordHash: "not-a-real-hash",
        mustChangePassword: false,
      })
      .returning({ id: schema.users.id });
    if (user === undefined) throw new Error("Capacity user insert failed");
    const [album] = await database
      .insert(schema.albums)
      .values({
        slug: "capacity-album-5000",
        title: "容量验证相册",
        description: "纯元数据夹具",
        state: "live",
        access: "public",
        publishMode: "auto",
        passwordHash: null,
        publishSequence: 5_000,
        idempotencyKey: "capacity-album-idempotency",
        createdBy: user.id,
      })
      .returning({ id: schema.albums.id, slug: schema.albums.slug });
    if (album === undefined) throw new Error("Capacity album insert failed");

    const now = new Date();
    for (let start = 1; start <= 5_000; start += 500) {
      const rows = await database
        .insert(schema.media)
        .values(
          Array.from({ length: Math.min(500, 5_001 - start) }, (_, index) => {
            const publishSequence = start + index;
            return {
              albumId: album.id,
              uploaderId: user.id,
              ingestStatus: "ready" as const,
              publicationStatus: "published" as const,
              width: 1_920,
              height: 1_280,
              mediaType: "image/jpeg",
              totalBytes: 1_000,
              publishSequence,
              publishedAt: now,
            };
          }),
        )
        .returning({ id: schema.media.id, publishSequence: schema.media.publishSequence });
      await database.insert(schema.mediaVariants).values(
        rows.flatMap((media) =>
          (["photo_480", "photo_960"] as const).map((kind) => ({
            mediaId: media.id,
            kind,
            objectKey: `media/capacity/${media.publishSequence}/${kind}.webp`,
            format: "webp",
            contentType: "image/webp",
            width: kind === "photo_480" ? 480 : 960,
            height: kind === "photo_480" ? 320 : 640,
            expectedBytes: 100,
            bytes: 100,
            etag: `etag-${media.publishSequence}-${kind}`,
            verified: true,
            completedAt: now,
          })),
        ),
      );
    }

    const pageDurations: number[] = [];
    const sequences: number[] = [];
    let cursor: string | undefined;
    do {
      const startedAt = performance.now();
      const page = await service.listPublicMedia({
        slug: album.slug,
        visitorToken: undefined,
        cursor,
        categoryId: undefined,
        limit: 60,
      });
      pageDurations.push(performance.now() - startedAt);
      sequences.push(...page.items.map((item) => item.publishSequence));
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);

    expect(sequences).toHaveLength(5_000);
    expect(new Set(sequences).size).toBe(5_000);
    expect(sequences[0]).toBe(5_000);
    expect(sequences.at(-1)).toBe(1);
    const paginationP95 = percentile(pageDurations, 0.95);
    expect(paginationP95).toBeLessThan(300);

    const broker = new LiveEventBroker();
    await broker.start(pool);
    const app = await buildApp({
      config,
      authStore: new PostgresAuthStore(database),
      passwordHasher: fakeHasher,
      photoService: service,
      broker,
      logger: false,
    });
    const clients: ReturnType<typeof openSse>[] = [];
    try {
      await app.listen({ host: "127.0.0.1", port: capacityPort });
      const url = `http://127.0.0.1:${capacityPort}/api/v1/public/albums/${album.slug}/events?after=0`;
      for (let index = 0; index < 500; index += 1) clients.push(openSse(url));
      await withDeadline(
        Promise.all(clients.map((client) => client.established)),
        20_000,
        "500 SSE connections",
      );

      const publishedAt = performance.now();
      await database.insert(schema.liveEvents).values({
        albumId: album.id,
        mediaId: null,
        type: "media.published",
        payload: {},
      });
      await pool.query("select pg_notify($1, $2)", [liveEventChannel, album.id]);
      const receivedAt = await withDeadline(
        Promise.all(clients.map((client) => client.received)),
        20_000,
        "500 SSE event deliveries",
      );
      const sseLatencies = receivedAt.map((timestamp) => timestamp - publishedAt);
      const sseP95 = percentile(sseLatencies, 0.95);
      expect(sseP95).toBeLessThan(10_000);
      process.stdout.write(
        `${JSON.stringify({
          media: sequences.length,
          pages: pageDurations.length,
          paginationP95Ms: Number(paginationP95.toFixed(2)),
          sseClients: clients.length,
          sseP95Ms: Number(sseP95.toFixed(2)),
        })}\n`,
      );
    } finally {
      for (const client of clients) client.close();
      await app.close();
      await broker.close();
    }
  });
});
