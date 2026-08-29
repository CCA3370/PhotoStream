import { createHmac } from "node:crypto";

import {
  addBibTagRequestSchema,
  apiErrorSchema,
  bibBatchNoNumberRequestSchema,
  bibBatchResultSchema,
  bibBatchTagRequestSchema,
  bibConfigUpdateSchema,
  bibConfigViewSchema,
  bibMediaStateSchema,
  bibTestRequestSchema,
  bibTestResponseSchema,
  confirmBibTagRequestSchema,
  publicBibAttributeFilterRequestSchema,
  publicBibSearchRequestSchema,
  publicMediaListSchema,
  submitBibCandidatesRequestSchema,
} from "@photostream/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { requireInternalCsrf, requireInternalSession } from "../auth/http.js";
import type { AuthService } from "../auth/service.js";
import type { BibService } from "../bib/service.js";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import { visitorSessionToken } from "../media/visitor-http.js";

const albumParamsSchema = z.object({ id: z.string().uuid() }).strict();
const mediaParamsSchema = z.object({ id: z.string().uuid() }).strict();
const tagParamsSchema = z.object({ id: z.string().uuid(), tagId: z.string().uuid() }).strict();
const slugParamsSchema = z.object({ slug: z.string().min(12).max(32) }).strict();

function actorFrom(session: Awaited<ReturnType<typeof requireInternalSession>>) {
  return { id: session.record.user.id, role: session.record.user.role };
}

function idempotencyKey(request: FastifyRequest): string | undefined {
  const value = request.headers["idempotency-key"];
  return typeof value === "string" ? value : undefined;
}

function noStore(reply: FastifyReply): void {
  void reply.header("cache-control", "no-store");
  void reply.header("referrer-policy", "no-referrer");
}

function dailyRateDigest(config: AppConfig, scope: "ip" | "session", value: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return createHmac("sha256", config.ANALYTICS_HMAC_SECRET)
    .update(`${day}\n${scope}\n${value}`, "utf8")
    .digest("hex");
}

export async function registerBibRoutes(
  app: FastifyInstance,
  options: {
    readonly authService: AuthService;
    readonly bibService: BibService;
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
    429: apiErrorSchema,
    500: apiErrorSchema,
  };
  const checkIpRate = app.createRateLimit({
    max: 30,
    timeWindow: "10 minutes",
    keyGenerator: (request) => dailyRateDigest(options.config, "ip", request.ip),
  });
  const checkSessionRate = app.createRateLimit({
    max: 30,
    timeWindow: "10 minutes",
    keyGenerator: (request) => {
      const slug = (request.params as { slug?: string }).slug ?? "unknown";
      return dailyRateDigest(
        options.config,
        "session",
        visitorSessionToken(request, options.config, slug) ?? "missing",
      );
    },
  });

  async function enforcePublicBibRateLimit(request: FastifyRequest, slug: string): Promise<void> {
    const ipResult = await checkIpRate(request);
    const token = visitorSessionToken(request, options.config, slug);
    const sessionResult = token === undefined ? null : await checkSessionRate(request);
    if (
      (!ipResult.isAllowed && ipResult.isExceeded) ||
      (sessionResult !== null && !sessionResult.isAllowed && sessionResult.isExceeded)
    ) {
      throw new AppError({
        code: "AUTH_RATE_LIMITED",
        message: "尝试次数过多，请稍后再试",
        statusCode: 429,
        retryable: true,
      });
    }
  }

  typed.get(
    "/api/v1/albums/:id/bib-config",
    {
      schema: {
        operationId: "getBibConfig",
        tags: ["bib"],
        params: albumParamsSchema,
        response: { 200: bibConfigViewSchema, ...errors },
      },
    },
    async (request, reply) => {
      noStore(reply);
      const session = await requireInternalSession(request, options.authService, options.config);
      return options.bibService.getConfig(actorFrom(session), request.params.id);
    },
  );

  typed.put(
    "/api/v1/albums/:id/bib-config",
    {
      schema: {
        operationId: "updateBibConfig",
        tags: ["bib"],
        params: albumParamsSchema,
        body: bibConfigUpdateSchema,
        response: { 200: bibConfigViewSchema, ...errors },
      },
    },
    async (request, reply) => {
      noStore(reply);
      const session = await requireInternalCsrf(request, options.authService, options.config);
      return options.bibService.updateConfig({
        actor: actorFrom(session),
        albumId: request.params.id,
        input: request.body,
        requestId: request.id,
      });
    },
  );

  typed.post(
    "/api/v1/albums/:id/bib-config/test",
    {
      schema: {
        operationId: "testBibConfig",
        tags: ["bib"],
        params: albumParamsSchema,
        body: bibTestRequestSchema,
        response: { 200: bibTestResponseSchema, ...errors },
      },
    },
    async (request, reply) => {
      noStore(reply);
      const session = await requireInternalCsrf(request, options.authService, options.config);
      return options.bibService.testNumber(
        actorFrom(session),
        request.params.id,
        request.body.number,
      );
    },
  );

  typed.get(
    "/api/v1/media/:id/bib",
    {
      schema: {
        operationId: "getMediaBibState",
        tags: ["bib"],
        params: mediaParamsSchema,
        response: { 200: bibMediaStateSchema, ...errors },
      },
    },
    async (request, reply) => {
      noStore(reply);
      const session = await requireInternalSession(request, options.authService, options.config);
      return options.bibService.getMediaState(actorFrom(session), request.params.id);
    },
  );

  typed.post(
    "/api/v1/media/:id/bib-candidates",
    {
      schema: {
        operationId: "submitBibCandidates",
        tags: ["bib"],
        params: mediaParamsSchema,
        body: submitBibCandidatesRequestSchema,
        response: { 200: bibMediaStateSchema, ...errors },
      },
    },
    async (request, reply) => {
      noStore(reply);
      const session = await requireInternalCsrf(request, options.authService, options.config);
      return options.bibService.submitCandidates({
        actor: actorFrom(session),
        mediaId: request.params.id,
        activityStatus: request.body.activityStatus,
        modelVersion: request.body.modelVersion,
        ruleVersion: request.body.ruleVersion,
        candidates: request.body.candidates,
        idempotencyKey: idempotencyKey(request),
        requestId: request.id,
      });
    },
  );

  typed.post(
    "/api/v1/media/:id/bib-tags",
    {
      schema: {
        operationId: "addBibTag",
        tags: ["bib"],
        params: mediaParamsSchema,
        body: addBibTagRequestSchema,
        response: { 200: bibMediaStateSchema, ...errors },
      },
    },
    async (request, reply) => {
      noStore(reply);
      const session = await requireInternalCsrf(request, options.authService, options.config);
      return options.bibService.addManualTag({
        actor: actorFrom(session),
        mediaId: request.params.id,
        number: request.body.number,
        idempotencyKey: idempotencyKey(request),
        requestId: request.id,
      });
    },
  );

  typed.post(
    "/api/v1/media/:id/bib-tags/:tagId/confirm",
    {
      schema: {
        operationId: "confirmBibTag",
        tags: ["bib"],
        params: tagParamsSchema,
        body: confirmBibTagRequestSchema,
        response: { 200: bibMediaStateSchema, ...errors },
      },
    },
    async (request, reply) => {
      noStore(reply);
      const session = await requireInternalCsrf(request, options.authService, options.config);
      return options.bibService.confirmTag({
        actor: actorFrom(session),
        mediaId: request.params.id,
        tagId: request.params.tagId,
        correctedNumber: request.body.number,
        idempotencyKey: idempotencyKey(request),
        requestId: request.id,
      });
    },
  );

  typed.post(
    "/api/v1/media/:id/bib-tags/:tagId/reject",
    {
      schema: {
        operationId: "rejectBibTag",
        tags: ["bib"],
        params: tagParamsSchema,
        response: { 200: bibMediaStateSchema, ...errors },
      },
    },
    async (request, reply) => {
      noStore(reply);
      const session = await requireInternalCsrf(request, options.authService, options.config);
      return options.bibService.rejectTag({
        actor: actorFrom(session),
        mediaId: request.params.id,
        tagId: request.params.tagId,
        idempotencyKey: idempotencyKey(request),
        requestId: request.id,
      });
    },
  );

  typed.delete(
    "/api/v1/media/:id/bib-tags/:tagId",
    {
      schema: {
        operationId: "deleteBibTag",
        tags: ["bib"],
        params: tagParamsSchema,
        response: { 200: bibMediaStateSchema, ...errors },
      },
    },
    async (request, reply) => {
      noStore(reply);
      const session = await requireInternalCsrf(request, options.authService, options.config);
      return options.bibService.deleteTag({
        actor: actorFrom(session),
        mediaId: request.params.id,
        tagId: request.params.tagId,
        idempotencyKey: idempotencyKey(request),
        requestId: request.id,
      });
    },
  );

  for (const action of ["no-number", "reset"] as const) {
    typed.post(
      `/api/v1/media/:id/bib-review/${action}`,
      {
        schema: {
          operationId: action === "no-number" ? "confirmBibNoNumber" : "resetBibReview",
          tags: ["bib"],
          params: mediaParamsSchema,
          response: { 200: bibMediaStateSchema, ...errors },
        },
      },
      async (request, reply) => {
        noStore(reply);
        const session = await requireInternalCsrf(request, options.authService, options.config);
        const input = {
          actor: actorFrom(session),
          mediaId: request.params.id,
          idempotencyKey: idempotencyKey(request),
          requestId: request.id,
        };
        return action === "no-number"
          ? options.bibService.confirmNoNumber(input)
          : options.bibService.resetReview(input);
      },
    );
  }

  typed.post(
    "/api/v1/media/bib-tags/batch",
    {
      schema: {
        operationId: "batchAddBibTag",
        tags: ["bib"],
        body: bibBatchTagRequestSchema,
        response: { 200: bibBatchResultSchema, ...errors },
      },
    },
    async (request, reply) => {
      noStore(reply);
      const session = await requireInternalCsrf(request, options.authService, options.config);
      return options.bibService.addManualTagBatch({
        actor: actorFrom(session),
        mediaIds: request.body.mediaIds,
        number: request.body.number,
        idempotencyKey: idempotencyKey(request),
        requestId: request.id,
      });
    },
  );

  typed.post(
    "/api/v1/media/bib-review/no-number/batch",
    {
      schema: {
        operationId: "batchConfirmBibNoNumber",
        tags: ["bib"],
        body: bibBatchNoNumberRequestSchema,
        response: { 200: bibBatchResultSchema, ...errors },
      },
    },
    async (request, reply) => {
      noStore(reply);
      const session = await requireInternalCsrf(request, options.authService, options.config);
      return options.bibService.confirmNoNumberBatch({
        actor: actorFrom(session),
        mediaIds: request.body.mediaIds,
        idempotencyKey: idempotencyKey(request),
        requestId: request.id,
      });
    },
  );

  typed.post(
    "/api/v1/public/albums/:slug/bib-search",
    {
      schema: {
        operationId: "searchPublicBib",
        tags: ["public", "bib"],
        params: slugParamsSchema,
        body: publicBibSearchRequestSchema,
        response: { 200: publicMediaListSchema, ...errors },
      },
    },
    async (request, reply) => {
      noStore(reply);
      await enforcePublicBibRateLimit(request, request.params.slug);
      return options.bibService.searchPublic({
        slug: request.params.slug,
        visitorToken: visitorSessionToken(request, options.config, request.params.slug),
        number: request.body.number,
        cursor: request.body.cursor,
      });
    },
  );

  typed.post(
    "/api/v1/public/albums/:slug/bib-attributes-filter",
    {
      schema: {
        operationId: "filterPublicBibAttributes",
        tags: ["public", "bib"],
        params: slugParamsSchema,
        body: publicBibAttributeFilterRequestSchema,
        response: { 200: publicMediaListSchema, ...errors },
      },
    },
    async (request, reply) => {
      noStore(reply);
      await enforcePublicBibRateLimit(request, request.params.slug);
      return options.bibService.filterPublicAttributes({
        slug: request.params.slug,
        visitorToken: visitorSessionToken(request, options.config, request.params.slug),
        gradeOptionId: request.body.gradeOptionId,
        classOptionId: request.body.classOptionId,
        categoryId: request.body.categoryId,
        cursor: request.body.cursor,
      });
    },
  );
}
