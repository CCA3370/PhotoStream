import { Readable } from "node:stream";

import {
  apiErrorSchema,
  createFaceSearchRequestSchema,
  createFaceSearchResponseSchema,
  faceConfigUpdateSchema,
  faceConfigViewSchema,
  faceIndexExclusionsRequestSchema,
  faceSearchParamsSchema,
  faceSearchSafeStateSchema,
  faceSearchViewSchema,
  okResponseSchema,
} from "@photostream/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { requireInternalCsrf, requireInternalSession } from "../auth/http.js";
import type { AuthService } from "../auth/service.js";
import type { AppConfig } from "../config.js";
import {
  EventBridgeVerificationError,
  type EventBridgeVerifier,
} from "../face/eventbridge-verifier.js";
import type { FaceService } from "../face/service.js";
import { visitorSessionToken } from "../media/visitor-http.js";

const albumParams = z.object({ id: z.string().uuid() }).strict();
const slugParams = z.object({ slug: z.string().min(12).max(32) }).strict();
const searchParams = z
  .object({ slug: z.string().min(12).max(32), searchId: z.string().uuid() })
  .strict();

function actorFrom(session: Awaited<ReturnType<typeof requireInternalSession>>) {
  return { id: session.record.user.id, role: session.record.user.role };
}

function privateResponse(reply: FastifyReply): void {
  void reply.header("cache-control", "no-store");
  void reply.header("referrer-policy", "no-referrer");
}

export async function registerFaceRoutes(
  app: FastifyInstance,
  options: {
    authService: AuthService;
    faceService: FaceService;
    eventBridgeVerifier: EventBridgeVerifier;
    config: AppConfig;
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
    503: apiErrorSchema,
  };

  typed.get(
    "/api/v1/albums/:id/face-config",
    {
      schema: {
        operationId: "getFaceConfig",
        tags: ["face"],
        params: albumParams,
        response: { 200: faceConfigViewSchema, ...errors },
      },
    },
    async (request, reply) => {
      privateResponse(reply);
      const session = await requireInternalSession(request, options.authService, options.config);
      return options.faceService.getConfig(actorFrom(session), request.params.id);
    },
  );

  typed.put(
    "/api/v1/albums/:id/face-config",
    {
      schema: {
        operationId: "updateFaceConfig",
        tags: ["face"],
        params: albumParams,
        body: faceConfigUpdateSchema,
        response: { 200: faceConfigViewSchema, ...errors },
      },
    },
    async (request, reply) => {
      privateResponse(reply);
      const session = await requireInternalCsrf(request, options.authService, options.config);
      return options.faceService.updateConfig({
        actor: { ...actorFrom(session), authenticatedAt: session.record.createdAt },
        albumId: request.params.id,
        input: request.body,
        requestId: request.id,
      });
    },
  );

  typed.post(
    "/api/v1/albums/:id/face-index/exclusions",
    {
      schema: {
        operationId: "excludeFaceIndexMedia",
        tags: ["face"],
        params: albumParams,
        body: faceIndexExclusionsRequestSchema,
        response: { 200: faceConfigViewSchema, ...errors },
      },
    },
    async (request, reply) => {
      privateResponse(reply);
      const session = await requireInternalCsrf(request, options.authService, options.config);
      return options.faceService.excludeMedia({
        actor: { ...actorFrom(session), authenticatedAt: session.record.createdAt },
        albumId: request.params.id,
        mediaIds: request.body.mediaIds,
        requestId: request.id,
      });
    },
  );

  typed.post(
    "/api/v1/albums/:id/face-index/retry",
    {
      schema: {
        operationId: "retryFaceIndex",
        tags: ["face"],
        params: albumParams,
        response: { 200: faceConfigViewSchema, ...errors },
      },
    },
    async (request, reply) => {
      privateResponse(reply);
      const session = await requireInternalCsrf(request, options.authService, options.config);
      return options.faceService.retry(actorFrom(session), request.params.id);
    },
  );

  typed.delete(
    "/api/v1/albums/:id/face-index",
    {
      schema: {
        operationId: "deleteFaceIndex",
        tags: ["face"],
        params: albumParams,
        response: { 200: faceConfigViewSchema, ...errors },
      },
    },
    async (request, reply) => {
      privateResponse(reply);
      const session = await requireInternalCsrf(request, options.authService, options.config);
      return options.faceService.deleteIndex(
        { ...actorFrom(session), authenticatedAt: session.record.createdAt },
        request.params.id,
        request.id,
      );
    },
  );

  typed.post(
    "/api/v1/public/albums/:slug/face-searches",
    {
      schema: {
        operationId: "createFaceSearch",
        tags: ["face"],
        params: slugParams,
        body: createFaceSearchRequestSchema,
        response: { 200: createFaceSearchResponseSchema, ...errors },
      },
    },
    async (request, reply) => {
      privateResponse(reply);
      return options.faceService.createSearch({
        slug: request.params.slug,
        visitorToken: visitorSessionToken(request, options.config, request.params.slug),
        ip: request.ip,
        noticeVersion: request.body.noticeVersion,
        declaration: request.body.declaration,
        bytes: request.body.reference.bytes,
      });
    },
  );

  typed.post(
    "/api/v1/public/albums/:slug/face-searches/:searchId/complete",
    {
      schema: {
        operationId: "completeFaceSearch",
        tags: ["face"],
        params: searchParams,
        response: { 200: faceSearchSafeStateSchema, ...errors },
      },
    },
    async (request, reply) => {
      privateResponse(reply);
      return options.faceService.completeSearch({
        slug: request.params.slug,
        searchId: request.params.searchId,
        visitorToken: visitorSessionToken(request, options.config, request.params.slug),
        ip: request.ip,
      });
    },
  );

  typed.get(
    "/api/v1/public/albums/:slug/face-searches/:searchId",
    {
      schema: {
        operationId: "getFaceSearch",
        tags: ["face"],
        params: searchParams,
        querystring: faceSearchParamsSchema,
        response: { 200: faceSearchViewSchema, ...errors },
      },
    },
    async (request, reply) => {
      privateResponse(reply);
      return options.faceService.getSearch({
        slug: request.params.slug,
        searchId: request.params.searchId,
        visitorToken: visitorSessionToken(request, options.config, request.params.slug),
        ip: request.ip,
        cursor: request.query.cursor,
        limit: request.query.limit,
      });
    },
  );

  typed.delete(
    "/api/v1/public/albums/:slug/face-searches/:searchId",
    {
      schema: {
        operationId: "deleteFaceSearch",
        tags: ["face"],
        params: searchParams,
        response: { 200: okResponseSchema, ...errors },
      },
    },
    async (request, reply) => {
      privateResponse(reply);
      return options.faceService.deleteSearch({
        slug: request.params.slug,
        searchId: request.params.searchId,
        visitorToken: visitorSessionToken(request, options.config, request.params.slug),
        ip: request.ip,
      });
    },
  );

  typed.post(
    "/api/v1/integrations/aliyun/eventbridge",
    {
      config: { rawBody: true },
      preParsing: async (request, _reply, payload) => {
        const chunks: Buffer[] = [];
        let total = 0;
        for await (const chunk of payload) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += buffer.byteLength;
          if (total > 512 * 1024) throw new Error("event body too large");
          chunks.push(buffer);
        }
        const body = Buffer.concat(chunks);
        (request as FastifyRequest & { faceRawBody?: Buffer }).faceRawBody = body;
        return Readable.from(body);
      },
      schema: {
        operationId: "receiveAliyunFaceEvent",
        tags: ["integrations"],
        hide: true,
        body: z.unknown(),
        response: { 200: okResponseSchema, 403: apiErrorSchema },
      },
    },
    async (request, reply) => {
      privateResponse(reply);
      const body = (request as FastifyRequest & { faceRawBody?: Buffer }).faceRawBody;
      if (body === undefined) throw new Error("raw event body unavailable");
      try {
        await options.eventBridgeVerifier.verify(request.headers, body);
      } catch (error) {
        if (error instanceof EventBridgeVerificationError) {
          request.log.warn(
            { eventBridgeVerificationStage: error.stage },
            "EventBridge signature rejected",
          );
        }
        throw error;
      }
      return options.faceService.processEvent(request.body);
    },
  );
}
