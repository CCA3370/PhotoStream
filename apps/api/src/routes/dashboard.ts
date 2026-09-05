import { apiErrorSchema } from "@photostream/contracts";
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
    500: apiErrorSchema,
  };

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
