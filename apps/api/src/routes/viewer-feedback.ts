import { apiErrorSchema } from "@photostream/contracts";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { requireInternalSession } from "../auth/http.js";
import type { AuthService } from "../auth/service.js";
import type { AppConfig } from "../config.js";
import type { LiveEventBroker } from "../media/live-event-broker.js";
import {
  type ViewerFeedbackService,
  viewerFeedbackTopic,
} from "../media/viewer-feedback-service.js";
import { visitorSessionToken } from "../media/visitor-http.js";

const slugParamsSchema = z.object({ slug: z.string().min(12).max(32) }).strict();
const reportParamsSchema = z
  .object({ slug: z.string().min(12).max(32), mediaId: z.string().uuid() })
  .strict();
const shareReportParamsSchema = z.object({ shareId: z.string().uuid() }).strict();
const feedbackKindSchema = z.enum(["problem", "suggestion", "other"]);
const feedbackRecordKindSchema = z.enum(["problem", "suggestion", "other", "report"]);
const reportReasonSchema = z.enum([
  "privacy",
  "inappropriate",
  "copyright",
  "inaccurate",
  "malicious_spread",
  "other",
]);
const createFeedbackSchema = z
  .object({
    kind: feedbackKindSchema,
    message: z.string().trim().min(2).max(2_000),
    pagePath: z.string().trim().min(1).max(512).startsWith("/").nullable().default(null),
  })
  .strict();
const createReportSchema = z
  .object({
    reason: reportReasonSchema,
    message: z.string().trim().min(2).max(2_000),
    pagePath: z.string().trim().min(1).max(512).startsWith("/").nullable().default(null),
  })
  .strict();
const feedbackViewSchema = z
  .object({
    id: z.number().int().positive(),
    albumId: z.string().uuid(),
    albumTitle: z.string().min(1),
    albumSlug: z.string().min(1),
    mediaId: z.string().uuid().nullable(),
    mediaStatus: z.string().nullable(),
    kind: feedbackRecordKindSchema,
    reportReason: reportReasonSchema.nullable(),
    message: z.string(),
    pagePath: z.string().nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();
const feedbackListSchema = z
  .object({
    items: z.array(feedbackViewSchema),
    latestId: z.number().int().nonnegative(),
  })
  .strict();
const feedbackListQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(100).default(50) })
  .strict();
const feedbackStreamQuerySchema = z
  .object({ after: z.coerce.number().int().min(0).optional() })
  .strict();
const createFeedbackResponseSchema = z
  .object({ id: z.number().int().positive(), received: z.literal(true) })
  .strict();

export async function registerViewerFeedbackRoutes(
  app: FastifyInstance,
  options: {
    readonly authService: AuthService;
    readonly config: AppConfig;
    readonly feedbackService: ViewerFeedbackService;
    readonly broker: LiveEventBroker;
  },
): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const errors = {
    400: apiErrorSchema,
    401: apiErrorSchema,
    403: apiErrorSchema,
    404: apiErrorSchema,
    429: apiErrorSchema,
    500: apiErrorSchema,
  };

  typed.post(
    "/api/v1/public/albums/:slug/feedback",
    {
      config: { rateLimit: { max: 5, timeWindow: "10 minutes" } },
      schema: {
        operationId: "createViewerFeedback",
        tags: ["public", "feedback"],
        params: slugParamsSchema,
        body: createFeedbackSchema,
        response: { 201: createFeedbackResponseSchema, ...errors },
      },
    },
    async (request, reply) => {
      const result = await options.feedbackService.createPublic({
        slug: request.params.slug,
        visitorToken: visitorSessionToken(request, options.config, request.params.slug),
        kind: request.body.kind,
        message: request.body.message,
        pagePath: request.body.pagePath,
      });
      void reply.header("cache-control", "no-store");
      return reply.status(201).send(result);
    },
  );

  typed.post(
    "/api/v1/public/albums/:slug/media/:mediaId/report",
    {
      config: { rateLimit: { max: 3, timeWindow: "10 minutes" } },
      schema: {
        operationId: "createPhotoReport",
        tags: ["public", "feedback", "media"],
        params: reportParamsSchema,
        body: createReportSchema,
        response: { 201: createFeedbackResponseSchema, ...errors },
      },
    },
    async (request, reply) => {
      const result = await options.feedbackService.createPublic({
        slug: request.params.slug,
        visitorToken: visitorSessionToken(request, options.config, request.params.slug),
        kind: "report",
        mediaId: request.params.mediaId,
        reportReason: request.body.reason,
        message: request.body.message,
        pagePath: request.body.pagePath,
      });
      void reply.header("cache-control", "no-store");
      return reply.status(201).send(result);
    },
  );

  typed.post(
    "/api/v1/public/shares/:shareId/report",
    {
      config: { rateLimit: { max: 3, timeWindow: "10 minutes" } },
      schema: {
        operationId: "createSharedPhotoReport",
        tags: ["public", "feedback", "media"],
        params: shareReportParamsSchema,
        body: createReportSchema,
        response: { 201: createFeedbackResponseSchema, ...errors },
      },
    },
    async (request, reply) => {
      const result = await options.feedbackService.createSharedReport({
        shareId: request.params.shareId,
        reportReason: request.body.reason,
        message: request.body.message,
        pagePath: request.body.pagePath,
      });
      void reply.header("cache-control", "no-store");
      return reply.status(201).send(result);
    },
  );

  typed.get(
    "/api/v1/feedback",
    {
      schema: {
        operationId: "listViewerFeedback",
        tags: ["feedback"],
        querystring: feedbackListQuerySchema,
        response: { 200: feedbackListSchema, ...errors },
      },
    },
    async (request, reply) => {
      await requireInternalSession(request, options.authService, options.config);
      const items = await options.feedbackService.listRecent(request.query.limit);
      void reply.header("cache-control", "no-store");
      return { items, latestId: items[0]?.id ?? 0 };
    },
  );

  typed.get(
    "/api/v1/feedback/events",
    {
      schema: {
        operationId: "streamViewerFeedback",
        tags: ["feedback"],
        querystring: feedbackStreamQuerySchema,
        response: { ...errors },
      },
    },
    async (request, reply) => {
      await requireInternalSession(request, options.authService, options.config);
      const lastEventHeader = request.headers["last-event-id"];
      const headerEventId =
        typeof lastEventHeader === "string" && /^\d+$/u.test(lastEventHeader)
          ? Number(lastEventHeader)
          : 0;
      const hasReplayCursor = request.query.after !== undefined || headerEventId > 0;
      let lastEventId = hasReplayCursor
        ? Math.max(headerEventId, request.query.after ?? 0)
        : await options.feedbackService.latestId();

      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      reply.raw.flushHeaders();
      reply.raw.write(": connected\n\n");

      let running = false;
      const flush = async () => {
        if (running || reply.raw.destroyed) return;
        running = true;
        try {
          while (!reply.raw.destroyed) {
            const items = await options.feedbackService.listAfter(lastEventId);
            for (const item of items) {
              lastEventId = item.id;
              reply.raw.write(`id: ${item.id}\n`);
              reply.raw.write("event: viewer.feedback.created\n");
              reply.raw.write(`data: ${JSON.stringify(item)}\n\n`);
            }
            if (items.length < 100) break;
          }
        } finally {
          running = false;
        }
      };
      const safeFlush = () => {
        void flush().catch((error: unknown) => {
          request.log.error({ err: error }, "viewer feedback SSE replay failed");
          reply.raw.end();
        });
      };

      const unsubscribe = options.broker.subscribe(viewerFeedbackTopic, safeFlush);
      const poll = setInterval(safeFlush, 15_000);
      const heartbeat = setInterval(() => {
        if (!reply.raw.destroyed) reply.raw.write(": heartbeat\n\n");
      }, 20_000);
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        clearInterval(poll);
        clearInterval(heartbeat);
      };
      request.raw.once("close", close);
      reply.raw.once("error", close);
      return reply;
    },
  );
}
