import {
  albumStatisticsSchema,
  albumViewSchema,
  apiErrorSchema,
  auditLogListSchema,
  categoryViewSchema,
  deleteMediaRequestSchema,
  deletionTaskViewSchema,
  downloadKindSchema,
  mediaBatchRequestSchema,
  mediaBatchResultSchema,
  okResponseSchema,
  rotateAlbumPasswordResponseSchema,
  signedDownloadSchema,
  updateAlbumRequestSchema,
  updateCategoryRequestSchema,
} from "@photostream/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import {
  requireInternalCsrf,
  requireInternalSession,
  verifyPasswordConfirmation,
} from "../auth/http.js";
import type { AuthService } from "../auth/service.js";
import type { AppConfig } from "../config.js";
import type { OperationsService } from "../media/operations-service.js";
import type { PhotoService } from "../media/service.js";
import { anonymousVisitorId, visitorSessionToken } from "../media/visitor-http.js";

const idParamsSchema = z.object({ id: z.string().uuid() }).strict();
const albumCategoryParamsSchema = z
  .object({ id: z.string().uuid(), categoryId: z.string().uuid() })
  .strict();
const downloadParamsSchema = z
  .object({
    slug: z.string().min(12).max(32),
    mediaId: z.string().uuid(),
    kind: downloadKindSchema,
  })
  .strict();
const slugParamsSchema = z.object({ slug: z.string().min(12).max(32) }).strict();
const auditQuerySchema = z
  .object({
    cursor: z.string().max(1_000).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(60),
  })
  .strict();

function idempotencyKey(request: FastifyRequest): string | undefined {
  const value = request.headers["idempotency-key"];
  return typeof value === "string" ? value : undefined;
}

function actorFrom(session: Awaited<ReturnType<typeof requireInternalSession>>) {
  return { id: session.record.user.id, role: session.record.user.role };
}

export async function registerOperationsRoutes(
  app: FastifyInstance,
  options: {
    readonly authService: AuthService;
    readonly photoService: PhotoService;
    readonly operationsService: OperationsService;
    readonly config: AppConfig;
  },
): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const errors = {
    400: apiErrorSchema,
    401: apiErrorSchema,
    403: apiErrorSchema,
    404: apiErrorSchema,
    409: apiErrorSchema,
    500: apiErrorSchema,
  };

  typed.patch(
    "/api/v1/albums/:id",
    {
      schema: {
        operationId: "updateAlbum",
        tags: ["albums"],
        params: idParamsSchema,
        body: updateAlbumRequestSchema,
        response: { 200: albumViewSchema, ...errors },
      },
    },
    async (request) => {
      const session = await requireInternalCsrf(request, options.authService, options.config);
      return options.photoService.updateAlbum({
        actor: actorFrom(session),
        albumId: request.params.id,
        input: request.body,
        requestId: request.id,
      });
    },
  );

  for (const transition of ["end", "archive", "restore"] as const) {
    typed.post(
      `/api/v1/albums/:id/${transition}`,
      {
        schema: {
          operationId:
            transition === "end"
              ? "endAlbum"
              : transition === "archive"
                ? "archiveAlbum"
                : "restoreAlbum",
          tags: ["albums"],
          params: idParamsSchema,
          response: { 200: albumViewSchema, ...errors },
        },
      },
      async (request) => {
        const session = await requireInternalCsrf(request, options.authService, options.config);
        const input = {
          actor: actorFrom(session),
          albumId: request.params.id,
          requestId: request.id,
        };
        if (transition === "end") return options.photoService.endAlbum(input);
        if (transition === "archive") return options.photoService.archiveAlbum(input);
        return options.photoService.restoreAlbum(input);
      },
    );
  }

  typed.post(
    "/api/v1/albums/:id/rotate-password",
    {
      schema: {
        operationId: "rotateAlbumPassword",
        tags: ["albums"],
        params: idParamsSchema,
        response: { 200: rotateAlbumPasswordResponseSchema, ...errors },
      },
    },
    async (request) => {
      const session = await requireInternalCsrf(request, options.authService, options.config);
      return options.photoService.rotateAlbumPassword({
        actor: actorFrom(session),
        albumId: request.params.id,
        idempotencyKey: idempotencyKey(request),
        requestId: request.id,
      });
    },
  );

  typed.patch(
    "/api/v1/albums/:id/categories/:categoryId",
    {
      schema: {
        operationId: "updateCategory",
        tags: ["albums"],
        params: albumCategoryParamsSchema,
        body: updateCategoryRequestSchema,
        response: { 200: categoryViewSchema, ...errors },
      },
    },
    async (request) => {
      const session = await requireInternalCsrf(request, options.authService, options.config);
      return options.photoService.updateCategory({
        actor: actorFrom(session),
        albumId: request.params.id,
        categoryId: request.params.categoryId,
        input: request.body,
      });
    },
  );

  for (const action of ["hide", "restore"] as const) {
    typed.post(
      `/api/v1/media/:id/${action}`,
      {
        schema: {
          operationId: action === "hide" ? "hideMedia" : "restoreMedia",
          tags: ["media"],
          params: idParamsSchema,
          response: { 200: okResponseSchema, ...errors },
        },
      },
      async (request) => {
        const session = await requireInternalCsrf(request, options.authService, options.config);
        const input = {
          actor: actorFrom(session),
          mediaId: request.params.id,
          requestId: request.id,
          idempotencyKey: idempotencyKey(request),
        };
        if (action === "hide") await options.operationsService.hideMedia(input);
        else await options.operationsService.restoreMedia(input);
        return { ok: true as const };
      },
    );
  }

  typed.post(
    "/api/v1/media/batch",
    {
      schema: {
        operationId: "batchMedia",
        tags: ["media"],
        body: mediaBatchRequestSchema,
        response: { 200: mediaBatchResultSchema, ...errors },
      },
    },
    async (request) => {
      const session = await requireInternalCsrf(request, options.authService, options.config);
      return options.operationsService.applyBatch({
        actor: actorFrom(session),
        input: request.body,
        idempotencyKey: idempotencyKey(request),
        requestId: request.id,
      });
    },
  );

  typed.delete(
    "/api/v1/media/:id",
    {
      schema: {
        operationId: "deleteMedia",
        tags: ["media"],
        params: idParamsSchema,
        body: deleteMediaRequestSchema,
        response: { 202: deletionTaskViewSchema, ...errors },
      },
    },
    async (request, reply) => {
      const session = await requireInternalCsrf(request, options.authService, options.config);
      await verifyPasswordConfirmation(request, options.authService, session);
      const task = await options.operationsService.requestDeletion({
        actor: {
          ...actorFrom(session),
          authenticatedAt: new Date(),
        },
        mediaId: request.params.id,
        confirmation: request.body.confirmation,
        requestId: request.id,
      });
      return reply.status(202).send(task);
    },
  );

  typed.get(
    "/api/v1/deletion-tasks/:id",
    {
      schema: {
        operationId: "getDeletionTask",
        tags: ["media"],
        params: idParamsSchema,
        response: { 200: deletionTaskViewSchema, ...errors },
      },
    },
    async (request) => {
      const session = await requireInternalSession(request, options.authService, options.config);
      return options.operationsService.getDeletionTask(actorFrom(session), request.params.id);
    },
  );

  typed.post(
    "/api/v1/deletion-tasks/:id/retry",
    {
      schema: {
        operationId: "retryDeletionTask",
        tags: ["media"],
        params: idParamsSchema,
        response: { 200: deletionTaskViewSchema, ...errors },
      },
    },
    async (request) => {
      const session = await requireInternalCsrf(request, options.authService, options.config);
      return options.operationsService.retryDeletion({
        actor: { ...actorFrom(session), authenticatedAt: new Date() },
        taskId: request.params.id,
      });
    },
  );

  typed.post(
    "/api/v1/public/albums/:slug/downloads/:mediaId/:kind",
    {
      config: { rateLimit: { max: 30, timeWindow: "10 minutes" } },
      schema: {
        operationId: "issueDownload",
        tags: ["public"],
        params: downloadParamsSchema,
        response: { 200: signedDownloadSchema, ...errors },
      },
    },
    async (request, reply) => {
      const visitorId = anonymousVisitorId(request, reply, options.config);
      return options.operationsService.issueDownload({
        slug: request.params.slug,
        visitorToken: visitorSessionToken(request, options.config, request.params.slug),
        mediaId: request.params.mediaId,
        kind: request.params.kind,
        visitorId,
        idempotencyKey: idempotencyKey(request),
      });
    },
  );

  typed.post(
    "/api/v1/public/albums/:slug/analytics/open",
    {
      config: { rateLimit: { max: 60, timeWindow: "10 minutes" } },
      schema: {
        operationId: "recordAlbumOpen",
        tags: ["public"],
        params: slugParamsSchema,
        response: { 200: okResponseSchema, ...errors },
      },
    },
    async (request, reply) => {
      await options.operationsService.recordOpen({
        slug: request.params.slug,
        visitorToken: visitorSessionToken(request, options.config, request.params.slug),
        visitorId: anonymousVisitorId(request, reply, options.config),
      });
      return { ok: true as const };
    },
  );

  typed.get(
    "/api/v1/albums/:id/statistics",
    {
      schema: {
        operationId: "getAlbumStatistics",
        tags: ["albums"],
        params: idParamsSchema,
        response: { 200: albumStatisticsSchema, ...errors },
      },
    },
    async (request) => {
      const session = await requireInternalSession(request, options.authService, options.config);
      return options.operationsService.albumStatistics(actorFrom(session), request.params.id);
    },
  );

  typed.get(
    "/api/v1/audit",
    {
      schema: {
        operationId: "listAuditLogs",
        tags: ["audit"],
        querystring: auditQuerySchema,
        response: { 200: auditLogListSchema, ...errors },
      },
    },
    async (request) => {
      const session = await requireInternalSession(request, options.authService, options.config);
      return options.operationsService.listAudit({
        actor: actorFrom(session),
        cursor: request.query.cursor,
        limit: request.query.limit,
      });
    },
  );
}
