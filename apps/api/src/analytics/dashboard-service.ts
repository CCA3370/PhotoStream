import type { Database } from "@photostream/db";
import { schema } from "@photostream/db";
import { and, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";

import { AppError } from "../errors.js";
import type { ObjectStorage } from "../media/object-storage.js";
import type { InternalActor } from "../media/service.js";

const maxRangeMs = 30 * 24 * 60 * 60 * 1_000;
const thumbnailValidityMs = 10 * 60 * 1_000;

export type DashboardBucket = "5m" | "30m" | "1h" | "6h" | "1d";

const bucketSeconds: Record<DashboardBucket, number> = {
  "5m": 5 * 60,
  "30m": 30 * 60,
  "1h": 60 * 60,
  "6h": 6 * 60 * 60,
  "1d": 24 * 60 * 60,
};

function requireAlbumRead(actor: InternalActor): void {
  if (actor.role !== "admin" && actor.role !== "reviewer" && actor.role !== "uploader") {
    throw new AppError({ code: "FORBIDDEN", message: "当前角色无权查看统计", statusCode: 403 });
  }
}

function automaticBucket(durationMs: number): DashboardBucket {
  if (durationMs <= 2 * 60 * 60 * 1_000) return "5m";
  if (durationMs <= 12 * 60 * 60 * 1_000) return "30m";
  if (durationMs <= 2 * 24 * 60 * 60 * 1_000) return "1h";
  if (durationMs <= 14 * 24 * 60 * 60 * 1_000) return "6h";
  return "1d";
}

export class DashboardService {
  readonly #database: Database;
  readonly #storage: ObjectStorage;

  constructor(options: { readonly database: Database; readonly storage: ObjectStorage }) {
    this.#database = options.database;
    this.#storage = options.storage;
  }

  async statistics(options: {
    readonly actor: InternalActor;
    readonly from: Date;
    readonly to: Date;
    readonly limit: number;
    readonly bucket?: DashboardBucket;
    readonly now?: Date;
  }) {
    requireAlbumRead(options.actor);
    const now = options.now ?? new Date();
    const from = options.from;
    const to = options.to;
    const durationMs = to.getTime() - from.getTime();

    if (durationMs <= 0) {
      throw new AppError({
        code: "BAD_REQUEST",
        message: "统计结束时间必须晚于开始时间",
        statusCode: 400,
      });
    }
    if (durationMs > maxRangeMs) {
      throw new AppError({
        code: "BAD_REQUEST",
        message: "单次统计区间最长为 30 天",
        statusCode: 400,
      });
    }
    if (from.getTime() < now.getTime() - maxRangeMs - 5 * 60 * 1_000) {
      throw new AppError({
        code: "BAD_REQUEST",
        message: "分钟级分析明细仅保留最近 30 天",
        statusCode: 400,
      });
    }
    if (to.getTime() > now.getTime() + 5 * 60 * 1_000) {
      throw new AppError({
        code: "BAD_REQUEST",
        message: "统计结束时间不能位于未来",
        statusCode: 400,
      });
    }

    const bucket = options.bucket ?? automaticBucket(durationMs);
    const seconds = bucketSeconds[bucket];
    // The bucket width only comes from the fixed DashboardBucket whitelist above. Keep it as a SQL
    // literal so SELECT/GROUP BY/ORDER BY contain the exact same PostgreSQL expression instead of
    // distinct bind parameters ($1, $2, ...), which PostgreSQL does not consider equivalent for
    // grouping purposes.
    const secondsSql = sql.raw(String(seconds));
    const bucketExpression =
      sql<Date>`to_timestamp(floor(extract(epoch from ${schema.analyticsEvents.createdAt}) / ${secondsSql}) * ${secondsSql})`.mapWith(
        schema.analyticsEvents.createdAt,
      );

    const [trend, mediaAggregate, storageAggregate, topPhotos] = await Promise.all([
      this.#database
        .select({
          bucket: bucketExpression,
          opens: sql<number>`count(*) filter (where ${schema.analyticsEvents.eventType} = 'open')::int`,
          sessions: sql<number>`count(*) filter (where ${schema.analyticsEvents.eventType} = 'session')::int`,
          downloads: sql<number>`count(*) filter (where ${schema.analyticsEvents.eventType} = 'download')::int`,
          uniqueVisitors: sql<number>`count(distinct ${schema.analyticsEvents.visitorDigest})::int`,
        })
        .from(schema.analyticsEvents)
        .where(
          and(
            gte(schema.analyticsEvents.createdAt, from),
            lt(schema.analyticsEvents.createdAt, to),
          ),
        )
        .groupBy(bucketExpression)
        .orderBy(bucketExpression),
      this.#database
        .select({ mediaCount: sql<number>`count(*)::int` })
        .from(schema.media)
        .where(sql`${schema.media.publicationStatus} <> 'deleted'`),
      this.#database
        .select({
          logicalBytes: sql<number>`coalesce(sum(${schema.mediaVariants.bytes}), 0)::bigint`,
        })
        .from(schema.mediaVariants)
        .innerJoin(schema.media, eq(schema.mediaVariants.mediaId, schema.media.id))
        .where(
          and(
            eq(schema.mediaVariants.verified, true),
            sql`${schema.media.publicationStatus} <> 'deleted'`,
          ),
        ),
      this.#database
        .select({
          mediaId: schema.media.id,
          albumId: schema.albums.id,
          albumTitle: schema.albums.title,
          publishSequence: schema.media.publishSequence,
          capturedAt: schema.media.capturedAt,
          downloads: sql<number>`count(${schema.analyticsEvents.id})::int`,
          thumbnailObjectKey: schema.mediaVariants.objectKey,
        })
        .from(schema.analyticsEvents)
        .innerJoin(schema.media, eq(schema.analyticsEvents.mediaId, schema.media.id))
        .innerJoin(schema.albums, eq(schema.media.albumId, schema.albums.id))
        .leftJoin(
          schema.mediaVariants,
          and(
            eq(schema.mediaVariants.mediaId, schema.media.id),
            eq(schema.mediaVariants.kind, "photo_480"),
            eq(schema.mediaVariants.verified, true),
          ),
        )
        .where(
          and(
            eq(schema.analyticsEvents.eventType, "download"),
            isNotNull(schema.analyticsEvents.mediaId),
            gte(schema.analyticsEvents.createdAt, from),
            lt(schema.analyticsEvents.createdAt, to),
            sql`${schema.media.publicationStatus} <> 'deleted'`,
          ),
        )
        .groupBy(
          schema.media.id,
          schema.albums.id,
          schema.albums.title,
          schema.media.publishSequence,
          schema.media.capturedAt,
          schema.mediaVariants.objectKey,
        )
        .orderBy(desc(sql`count(${schema.analyticsEvents.id})`), desc(schema.media.publishSequence))
        .limit(options.limit),
    ]);

    const totals = trend.reduce(
      (sum, row) => ({
        opens: sum.opens + row.opens,
        sessions: sum.sessions + row.sessions,
        downloads: sum.downloads + row.downloads,
      }),
      { opens: 0, sessions: 0, downloads: 0 },
    );
    const [uniqueVisitorAggregate] = await this.#database
      .select({ count: sql<number>`count(distinct ${schema.analyticsEvents.visitorDigest})::int` })
      .from(schema.analyticsEvents)
      .where(
        and(gte(schema.analyticsEvents.createdAt, from), lt(schema.analyticsEvents.createdAt, to)),
      );

    const thumbnailExpiresAt = new Date(now.getTime() + thumbnailValidityMs);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      bucket,
      maxRangeDays: 30,
      mediaCount: mediaAggregate[0]?.mediaCount ?? 0,
      logicalBytes: Number(storageAggregate[0]?.logicalBytes ?? 0),
      ...totals,
      uniqueVisitors: uniqueVisitorAggregate?.count ?? 0,
      points: trend.map((row) => ({
        at: row.bucket.toISOString(),
        opens: row.opens,
        sessions: row.sessions,
        downloads: row.downloads,
        uniqueVisitors: row.uniqueVisitors,
      })),
      topPhotos: topPhotos
        .filter((row) => row.publishSequence !== null)
        .map((row) => ({
          mediaId: row.mediaId,
          albumId: row.albumId,
          albumTitle: row.albumTitle,
          publishSequence: row.publishSequence as number,
          downloads: row.downloads,
          thumbnailUrl:
            row.thumbnailObjectKey === null
              ? null
              : this.#storage.signRead({
                  key: row.thumbnailObjectKey,
                  expiresAt: thumbnailExpiresAt,
                }),
          capturedAt: row.capturedAt?.toISOString() ?? null,
        })),
    };
  }
}