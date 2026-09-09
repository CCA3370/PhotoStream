import { apiErrorSchema, okResponseSchema } from "@photostream/contracts";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { DashboardService } from "../analytics/dashboard-service.js";
import { requireInternalSession } from "../auth/http.js";
import type { AuthService } from "../auth/service.js";
import type { AppConfig } from "../config.js";

const dashboardQuerySchema = z
  .object({
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
    bucket: z.enum(["5m", "30m", "1h", "6h", "1d"]).optional(),
    limit: z.coerce.number().int().min(1).max(20).default(8),
  })
  .strict();

const searchUsageParamsSchema = z.object({ slug: z.string().min(12).max(32) }).strict();
const searchUsageRequestSchema = z
  .object({ method: z.enum(["number", "attributes", "face"]) })
  .strict();
const deliveryCounterSchema = z.number().int().min(0).max(100_000);
const deliveryBytesSchema = z.number().int().min(0).max(10 * 1024 * 1024 * 1024);
const mediaDeliveryFields = {
  memoryHits: deliveryCounterSchema,
  memoryBytes: deliveryBytesSchema,
  diskHits: deliveryCounterSchema,
  diskBytes: deliveryBytesSchema,
  joinedRequests: deliveryCounterSchema,
  networkRequests: deliveryCounterSchema,
  networkBytes: deliveryBytesSchema,
  readFailures: deliveryCounterSchema,
  writeFailures: deliveryCounterSchema,
  sizeMismatches: deliveryCounterSchema,
  refreshedUrls: deliveryCounterSchema,
  evictions: deliveryCounterSchema,
  directFallbacks: deliveryCounterSchema,
} as const;
const mediaDeliveryRequestSchema = z
  .object(mediaDeliveryFields)
  .strict()
  .refine((value) => Object.values(value).some((item) => item > 0), {
    message: "媒体交付统计不能为空",
  });
const browserDeliverySchema = z
  .object({
    ...mediaDeliveryFields,
    cacheHitRate: z.number().min(0).max(100).nullable(),
  })
  .strict();

const rankedPhotoSchema = z
  .object({
    mediaId: z.string().uuid(),
    albumId: z.string().uuid(),
    albumTitle: z.string(),
    publishSequence: z.number().int().positive(),
    thumbnailUrl: z.string().url().nullable(),
    capturedAt: z.iso.datetime().nullable(),
  })
  .strict();

const dashboardResponseSchema = z
  .object({
    from: z.iso.datetime(),
    to: z.iso.datetime(),
    bucket: z.enum(["5m", "30m", "1h", "6h", "1d"]),
    maxRangeDays: z.number().int().positive(),
    mediaCount: z.number().int().min(0),
    logicalBytes: z.number().int().min(0),
    opens: z.number().int().min(0),
    sessions: z.number().int().min(0),
    downloads: z.number().int().min(0),
    uniqueVisitors: z.number().int().min(0),
    points: z.array(
      z
        .object({
          at: z.iso.datetime(),
          opens: z.number().int().min(0),
          sessions: z.number().int().min(0),
          downloads: z.number().int().min(0),
          uniqueVisitors: z.number().int().min(0),
        })
        .strict(),
    ),
    searchUsage: z
      .object({
        number: z.number().int().min(0),
        attributes: z.number().int().min(0),
        face: z.number().int().min(0),
        points: z.array(
          z
            .object({
              at: z.iso.datetime(),
              number: z.number().int().min(0),
              attributes: z.number().int().min(0),
              face: z.number().int().min(0),
            })
            .strict(),
        ),
      })
      .strict(),
    cdn: z
      .object({
        status: z.enum(["ok", "partial", "unavailable", "error"]),
        domain: z.string().min(1).nullable(),
        intervalSeconds: z.number().int().min(0),
        dataDelaySeconds: z.number().int().min(0),
        trafficBytes: z.number().min(0),
        originTrafficBytes: z.number().min(0),
        peakBandwidthBps: z.number().min(0),
        averageByteHitRate: z.number().min(0).max(100).nullable(),
        averageRequestHitRate: z.number().min(0).max(100).nullable(),
        requests: z.number().min(0),
        errorRequests: z.number().min(0),
        points: z.array(
          z
            .object({
              at: z.iso.datetime(),
              trafficBytes: z.number().min(0),
              bandwidthBps: z.number().min(0),
              originTrafficBytes: z.number().min(0),
              byteHitRate: z.number().min(0).max(100).nullable(),
              requestHitRate: z.number().min(0).max(100).nullable(),
              http2xx: z.number().min(0),
              http3xx: z.number().min(0),
              http4xx: z.number().min(0),
              http5xx: z.number().min(0),
            })
            .strict(),
        ),
        message: z.string().nullable(),
        browser: browserDeliverySchema,
      })
      .strict(),
    topPhotos: z.array(
      rankedPhotoSchema.extend({ downloads: z.number().int().positive() }).strict(),
    ),
    topLikedPhotos: z.array(
      rankedPhotoSchema.extend({ likes: z.number().int().positive() }).strict(),
    ),
  })
  .strict();

export async function registerDashboardRoutes(
  app: FastifyInstance,
  options: {
    readonly authService: AuthService;
    readonly dashboardService: DashboardService;
    readonly config: AppConfig;
  },
): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const errors = {
    400: apiErrorSchema,
    401: apiErrorSchema,
    403: apiErrorSchema,
    404: apiErrorSchema,
    500: apiErrorSchema,
  };

  typed.post(
    "/api/v1/public/albums/:slug/analytics/search-usage",
    {
      config: { rateLimit: { max: 60, timeWindow: "10 minutes" } },
      schema: {
        operationId: "recordPhotoSearchUsage",
        tags: ["public", "analytics"],
        params: searchUsageParamsSchema,
        body: searchUsageRequestSchema,
        response: { 200: okResponseSchema, ...errors },
      },
    },
    async (request) => {
      await options.dashboardService.recordSearchUsage({
        slug: request.params.slug,
        method: request.body.method,
      });
      return { ok: true as const };
    },
  );

  typed.post(
    "/api/v1/public/albums/:slug/analytics/media-delivery",
    {
      config: { rateLimit: { max: 120, timeWindow: "10 minutes" } },
      schema: {
        operationId: "recordMediaDelivery",
        tags: ["public", "analytics"],
        params: searchUsageParamsSchema,
        body: mediaDeliveryRequestSchema,
        response: { 200: okResponseSchema, ...errors },
      },
    },
    async (request) => {
      await options.dashboardService.recordMediaDelivery({
        slug: request.params.slug,
        input: request.body,
      });
      return { ok: true as const };
    },
  );

  typed.get(
    "/api/v1/dashboard",
    {
      schema: {
        operationId: "getDashboardStatistics",
        tags: ["analytics"],
        querystring: dashboardQuerySchema,
        response: { 200: dashboardResponseSchema, ...errors },
      },
    },
    async (request) => {
      const session = await requireInternalSession(request, options.authService, options.config);
      const now = new Date();
      const to = request.query.to === undefined ? now : new Date(request.query.to);
      const from =
        request.query.from === undefined
          ? new Date(to.getTime() - 30 * 24 * 60 * 60 * 1_000)
          : new Date(request.query.from);
      return options.dashboardService.statistics({
        actor: { id: session.record.user.id, role: session.record.user.role },
        from,
        to,
        limit: request.query.limit,
        ...(request.query.bucket === undefined ? {} : { bucket: request.query.bucket }),
        now,
      });
    },
  );
}
