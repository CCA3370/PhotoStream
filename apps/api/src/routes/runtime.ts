import { apiErrorSchema } from "@photostream/contracts";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { requireInternalSession } from "../auth/http.js";
import type { AuthService } from "../auth/service.js";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import type { RuntimeMetrics } from "../observability/runtime-metrics.js";

const nullableTimestamp = z.iso.datetime().nullable();
const jobSchema = z
  .object({
    running: z.boolean(),
    runs: z.number().int().min(0),
    failures: z.number().int().min(0),
    skippedRuns: z.number().int().min(0),
    lastStartedAt: nullableTimestamp,
    lastCompletedAt: nullableTimestamp,
    lastErrorAt: nullableTimestamp,
    lastDurationMs: z.number().min(0).nullable(),
  })
  .strict();

const runtimeResponseSchema = z
  .object({
    generatedAt: z.iso.datetime(),
    uptimeSeconds: z.number().int().min(0),
    deployment: z
      .object({
        release: z.string().min(1).nullable(),
        slot: z.string().min(1).nullable(),
        nodeVersion: z.string().min(1),
      })
      .strict(),
    requests: z
      .object({
        total: z.number().int().min(0),
        inFlight: z.number().int().min(0),
        slow: z.number().int().min(0),
        status2xx: z.number().int().min(0),
        status3xx: z.number().int().min(0),
        status4xx: z.number().int().min(0),
        status5xx: z.number().int().min(0),
        sampleSize: z.number().int().min(0),
        p50Ms: z.number().min(0).nullable(),
        p95Ms: z.number().min(0).nullable(),
        p99Ms: z.number().min(0).nullable(),
      })
      .strict(),
    process: z
      .object({
        rssBytes: z.number().int().min(0),
        heapUsedBytes: z.number().int().min(0),
        heapTotalBytes: z.number().int().min(0),
        externalBytes: z.number().int().min(0),
        arrayBuffersBytes: z.number().int().min(0),
      })
      .strict(),
    database: z
      .object({
        totalConnections: z.number().int().min(0),
        idleConnections: z.number().int().min(0),
        waitingRequests: z.number().int().min(0),
      })
      .strict(),
    live: z.object({ subscribers: z.number().int().min(0) }).strict(),
    jobs: z
      .object({
        deletion: jobSchema,
        analyticsCleanup: jobSchema,
        bibMaintenance: jobSchema,
        faceMaintenance: jobSchema,
        bibCleanup: jobSchema,
      })
      .strict(),
  })
  .strict();

export async function registerRuntimeRoutes(
  app: FastifyInstance,
  options: {
    readonly authService: AuthService;
    readonly runtimeMetrics: RuntimeMetrics;
    readonly config: AppConfig;
  },
): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  typed.get(
    "/api/v1/operations/runtime",
    {
      schema: {
        operationId: "getRuntimeMetrics",
        tags: ["operations"],
        response: {
          200: runtimeResponseSchema,
          401: apiErrorSchema,
          403: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request) => {
      const session = await requireInternalSession(request, options.authService, options.config);
      if (session.record.user.role !== "admin") {
        throw new AppError({
          code: "FORBIDDEN",
          message: "仅管理员可查看运行状态",
          statusCode: 403,
        });
      }
      return options.runtimeMetrics.snapshot();
    },
  );
}
