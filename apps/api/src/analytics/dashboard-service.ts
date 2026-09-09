import type { Database } from "@photostream/db";
import { schema } from "@photostream/db";
import { and, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import { AppError } from "../errors.js";
import type { ObjectStorage } from "../media/object-storage.js";
import type { InternalActor } from "../media/service.js";
import {
  type CdnMetricsProvider,
  type CdnMetricsSnapshot,
  UnavailableCdnMetricsProvider,
} from "./cdn-metrics-provider.js";

const maxRangeMs = 30 * 24 * 60 * 60 * 1_000;
const thumbnailValidityMs = 10 * 60 * 1_000;

export type DashboardBucket = "5m" | "30m" | "1h" | "6h" | "1d";
export type SearchUsageMethod = "number" | "attributes" | "face";

export interface MediaDeliveryInput {
  readonly memoryHits: number;
  readonly memoryBytes: number;
  readonly diskHits: number;
  readonly diskBytes: number;
  readonly joinedRequests: number;
  readonly networkRequests: number;
  readonly networkBytes: number;
  readonly readFailures: number;
  readonly writeFailures: number;
  readonly sizeMismatches: number;
  readonly refreshedUrls: number;
  readonly evictions: number;
  readonly directFallbacks: number;
}

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

function failedCdnMetrics(): CdnMetricsSnapshot {
  return {
    status: "error",
    domain: null,
    intervalSeconds: 0,
    dataDelaySeconds: 0,
    trafficBytes: 0,
    originTrafficBytes: 0,
    peakBandwidthBps: 0,
    averageByteHitRate: null,
    averageRequestHitRate: null,
    requests: 0,
    errorRequests: 0,
    points: [],
    message: "CDN 监控数据暂不可用",
  };
}

function numeric(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export class DashboardService {
  readonly #database: Database;
  readonly #storage: ObjectStorage;
  readonly #cdnMetrics: CdnMetricsProvider;

  constructor(options: {
    readonly database: Database;
    readonly storage: ObjectStorage;
    readonly cdnMetrics?: CdnMetricsProvider;
  }) {
    this.#database = options.database;
    this.#storage = options.storage;
    this.#cdnMetrics = options.cdnMetrics ?? new UnavailableCdnMetricsProvider();
  }

  async recordSearchUsage(options: {
    readonly slug: string;
    readonly method: SearchUsageMethod;
    readonly now?: Date;
  }): Promise<void> {
    const [album] = await this.#database
      .select({ id: schema.albums.id })
      .from(schema.albums)
      .where(eq(schema.albums.slug, options.slug))
      .limit(1);
    if (album === undefined) {
      throw new AppError({ code: "NOT_FOUND", message: "相册不存在", statusCode: 404 });
    }
    await this.#database.insert(schema.searchUsageEvents).values({
      albumId: album.id,
      method: options.method,
      createdAt: options.now ?? new Date(),
    });
  }

  async recordMediaDelivery(options: {
    readonly slug: string;
    readonly input: MediaDeliveryInput;
    readonly now?: Date;
  }): Promise<void> {
    const [album] = await this.#database
      .select({ id: schema.albums.id })
      .from(schema.albums)
      .where(eq(schema.albums.slug, options.slug))
      .limit(1);
    if (album === undefined) {
      throw new AppError({ code: "NOT_FOUND", message: "相册不存在", statusCode: 404 });
    }
    await this.#database.insert(schema.mediaDeliveryEvents).values({
      albumId: album.id,
      ...options.input,
      createdAt: options.now ?? new Date(),
    });
  }

  async cleanupSearchUsage(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - maxRangeMs);
    return this.#database.transaction(async (transaction) => {
      const searchDeleted = await transaction
        .delete(schema.searchUsageEvents)
        .where(lt(schema.searchUsageEvents.createdAt, cutoff))
        .returning({ id: schema.searchUsageEvents.id });
      const deliveryDeleted = await transaction
        .delete(schema.mediaDeliveryEvents)
        .where(lt(schema.mediaDeliveryEvents.createdAt, cutoff))
        .returning({ id: schema.mediaDeliveryEvents.id });
      return searchDeleted.length + deliveryDeleted.length;
    });
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
    const secondsSql = sql.raw(String(seconds));
    const bucketExpression =
      sql<Date>`to_timestamp(floor(extract(epoch from ${schema.analyticsEvents.createdAt}) / ${secondsSql}) * ${secondsSql})`.mapWith(
        schema.analyticsEvents.createdAt,
      );
    const searchBucketExpression =
      sql<Date>`to_timestamp(floor(extract(epoch from ${schema.searchUsageEvents.createdAt}) / ${secondsSql}) * ${secondsSql})`.mapWith(
        schema.searchUsageEvents.createdAt,
      );

    const [
      trend,
      searchTrend,
      mediaAggregate,
      storageAggregate,
      topPhotos,
      topLikedPhotos,
      mediaDeliveryAggregate,
      cdn,
    ] = await Promise.all([
      this.#database
        .select({
          bucket: bucketExpression,
          opens: sql<number>`count(*) filter (where ${schema.analyticsEvents.eventType} = 'open')::int`,
          sessions: sql<number>`count(*) filter (where ${schema.analyticsEvents.eventType} = 'session')::int`,
          downloads: sql<number>`count(*) filter (where ${schema.analyticsEvents.eventType} = 'download')::int`,
          uniqueVisitors: sql<number>`count(distinct ${schema.analyticsEvents.visitorDigest})::int`,
        })
        .from(schema.analyticsEvents)
        .where(and(gte(schema.analyticsEvents.createdAt, from), lt(schema.analyticsEvents.createdAt, to)))
        .groupBy(bucketExpression)
        .orderBy(bucketExpression),
      this.#database
        .select({
          bucket: searchBucketExpression,
          number: sql<number>`count(*) filter (where ${schema.searchUsageEvents.method} = 'number')::int`,
          attributes: sql<number>`count(*) filter (where ${schema.searchUsageEvents.method} = 'attributes')::int`,
          face: sql<number>`count(*) filter (where ${schema.searchUsageEvents.method} = 'face')::int`,
        })
        .from(schema.searchUsageEvents)
        .where(
          and(gte(schema.searchUsageEvents.createdAt, from), lt(schema.searchUsageEvents.createdAt, to)),
        )
        .groupBy(searchBucketExpression)
        .orderBy(searchBucketExpression),
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
      this.#database
        .select({
          mediaId: schema.media.id,
          albumId: schema.albums.id,
          albumTitle: schema.albums.title,
          publishSequence: schema.media.publishSequence,
          capturedAt: schema.media.capturedAt,
          likes: sql<number>`count(${schema.mediaLikes.id})::int`,
          thumbnailObjectKey: schema.mediaVariants.objectKey,
        })
        .from(schema.mediaLikes)
        .innerJoin(schema.media, eq(schema.mediaLikes.mediaId, schema.media.id))
        .innerJoin(schema.albums, eq(schema.media.albumId, schema.albums.id))
        .leftJoin(
          schema.mediaVariants,
          and(
            eq(schema.mediaVariants.mediaId, schema.media.id),
            eq(schema.mediaVariants.kind, "photo_480"),
            eq(schema.mediaVariants.verified, true),
          ),
        )
        .where(sql`${schema.media.publicationStatus} <> 'deleted'`)
        .groupBy(
          schema.media.id,
          schema.albums.id,
          schema.albums.title,
          schema.media.publishSequence,
          schema.media.capturedAt,
          schema.mediaVariants.objectKey,
        )
        .orderBy(desc(sql`count(${schema.mediaLikes.id})`), desc(schema.media.publishSequence))
        .limit(options.limit),
      this.#database
        .select({
          memoryHits: sql<number>`coalesce(sum(${schema.mediaDeliveryEvents.memoryHits}), 0)::bigint`,
          memoryBytes: sql<number>`coalesce(sum(${schema.mediaDeliveryEvents.memoryBytes}), 0)::bigint`,
          diskHits: sql<number>`coalesce(sum(${schema.mediaDeliveryEvents.diskHits}), 0)::bigint`,
          diskBytes: sql<number>`coalesce(sum(${schema.mediaDeliveryEvents.diskBytes}), 0)::bigint`,
          joinedRequests: sql<number>`coalesce(sum(${schema.mediaDeliveryEvents.joinedRequests}), 0)::bigint`,
          networkRequests: sql<number>`coalesce(sum(${schema.mediaDeliveryEvents.networkRequests}), 0)::bigint`,
          networkBytes: sql<number>`coalesce(sum(${schema.mediaDeliveryEvents.networkBytes}), 0)::bigint`,
          readFailures: sql<number>`coalesce(sum(${schema.mediaDeliveryEvents.readFailures}), 0)::bigint`,
          writeFailures: sql<number>`coalesce(sum(${schema.mediaDeliveryEvents.writeFailures}), 0)::bigint`,
          sizeMismatches: sql<number>`coalesce(sum(${schema.mediaDeliveryEvents.sizeMismatches}), 0)::bigint`,
          refreshedUrls: sql<number>`coalesce(sum(${schema.mediaDeliveryEvents.refreshedUrls}), 0)::bigint`,
          evictions: sql<number>`coalesce(sum(${schema.mediaDeliveryEvents.evictions}), 0)::bigint`,
          directFallbacks: sql<number>`coalesce(sum(${schema.mediaDeliveryEvents.directFallbacks}), 0)::bigint`,
        })
        .from(schema.mediaDeliveryEvents)
        .where(
          and(
            gte(schema.mediaDeliveryEvents.createdAt, from),
            lt(schema.mediaDeliveryEvents.createdAt, to),
          ),
        ),
      this.#cdnMetrics.query({ from, to }).catch(() => failedCdnMetrics()),
    ]);

    const totals = trend.reduce(
      (sum, row) => ({
        opens: sum.opens + row.opens,
        sessions: sum.sessions + row.sessions,
        downloads: sum.downloads + row.downloads,
      }),
      { opens: 0, sessions: 0, downloads: 0 },
    );
    const searchTotals = searchTrend.reduce(
      (sum, row) => ({
        number: sum.number + row.number,
        attributes: sum.attributes + row.attributes,
        face: sum.face + row.face,
      }),
      { number: 0, attributes: 0, face: 0 },
    );
    const [uniqueVisitorAggregate] = await this.#database
      .select({ count: sql<number>`count(distinct ${schema.analyticsEvents.visitorDigest})::int` })
      .from(schema.analyticsEvents)
      .where(and(gte(schema.analyticsEvents.createdAt, from), lt(schema.analyticsEvents.createdAt, to)));

    const deliveryRow = mediaDeliveryAggregate[0];
    const memoryHits = numeric(deliveryRow?.memoryHits);
    const memoryBytes = numeric(deliveryRow?.memoryBytes);
    const diskHits = numeric(deliveryRow?.diskHits);
    const diskBytes = numeric(deliveryRow?.diskBytes);
    const joinedRequests = numeric(deliveryRow?.joinedRequests);
    const networkRequests = numeric(deliveryRow?.networkRequests);
    const networkBytes = numeric(deliveryRow?.networkBytes);
    const cacheDecisions = memoryHits + diskHits + networkRequests;
    const browserDelivery = {
      memoryHits,
      memoryBytes,
      diskHits,
      diskBytes,
      joinedRequests,
      networkRequests,
      networkBytes,
      readFailures: numeric(deliveryRow?.readFailures),
      writeFailures: numeric(deliveryRow?.writeFailures),
      sizeMismatches: numeric(deliveryRow?.sizeMismatches),
      refreshedUrls: numeric(deliveryRow?.refreshedUrls),
      evictions: numeric(deliveryRow?.evictions),
      directFallbacks: numeric(deliveryRow?.directFallbacks),
      cacheHitRate:
        cacheDecisions === 0 ? null : ((memoryHits + diskHits) / cacheDecisions) * 100,
    };

    const thumbnailExpiresAt = new Date(now.getTime() + thumbnailValidityMs);
    const thumbnailUrl = (objectKey: string | null) =>
      objectKey === null
        ? null
        : this.#storage.signRead({
            key: objectKey,
            expiresAt: thumbnailExpiresAt,
          });

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
      searchUsage: {
        ...searchTotals,
        points: searchTrend.map((row) => ({
          at: row.bucket.toISOString(),
          number: row.number,
          attributes: row.attributes,
          face: row.face,
        })),
      },
      cdn: { ...cdn, browser: browserDelivery },
      topPhotos: topPhotos
        .filter((row) => row.publishSequence !== null)
        .map((row) => ({
          mediaId: row.mediaId,
          albumId: row.albumId,
          albumTitle: row.albumTitle,
          publishSequence: row.publishSequence as number,
          downloads: row.downloads,
          thumbnailUrl: thumbnailUrl(row.thumbnailObjectKey),
          capturedAt: row.capturedAt?.toISOString() ?? null,
        })),
      topLikedPhotos: topLikedPhotos
        .filter((row) => row.publishSequence !== null)
        .map((row) => ({
          mediaId: row.mediaId,
          albumId: row.albumId,
          albumTitle: row.albumTitle,
          publishSequence: row.publishSequence as number,
          likes: row.likes,
          thumbnailUrl: thumbnailUrl(row.thumbnailObjectKey),
          capturedAt: row.capturedAt?.toISOString() ?? null,
        })),
    };
  }
}
