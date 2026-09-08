import { Readable } from "node:stream";

import {
  apiErrorSchema,
  createFaceSearchRequestSchema,
  createFaceSearchResponseSchema,
  faceConfigUpdateSchema,
  faceConfigViewSchema,
  faceIndexExclusionsRequestSchema,
  faceIndexStateSchema,
  faceSearchParamsSchema,
  faceSearchSafeStateSchema,
  faceSearchViewSchema,
  okResponseSchema,
} from "@photostream/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import {
  requireInternalCsrf,
  requireInternalSession,
  verifyPasswordConfirmation,
} from "../auth/http.js";
import type { AuthService } from "../auth/service.js";
import type { AppConfig } from "../config.js";
import {
  EventBridgeVerificationError,
  type EventBridgeVerifier,
} from "../face/eventbridge-verifier.js";
import type { FacePublicStateService } from "../face/public-state-service.js";
import type { FaceService } from "../face/service.js";
import { faceSearchVisitorToken, visitorSessionToken } from "../media/visitor-http.js";

const albumParams = z.object({ id: z.string().uuid() }).strict();
const slugParams = z.object({ slug: z.string().min(12).max(32) }).strict();
const searchParams = z
  .object({ slug: z.string().min(12).max(32), searchId: z.string().uuid() })
  .strict();
const publicFaceStateSchema = z
  .object({
    enabled: z.boolean(),
    noticeVersion: z.string().min(1).max(80),
    indexState: faceIndexStateSchema,
  })
  .strict();

function actorFrom(session: Awaited<ReturnType<typeof requireInternalSession>>) {
  return { id: session.record.user.id, role: session.record.user.role };
}

function privateResponse(reply: FastifyReply): void {
  void reply.header("cache-control", "no-store");
  void reply.header("referrer-policy", "no-referrer");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function logFaceSearchSimilarityResults(
  request: FastifyRequest,
  payload: unknown,
  config: AppConfig,
): void {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  if (data === null || data.TaskType !== "FacesSearching") return;

  const groups = Array.isArray(data.SimilarFaces) ? data.SimilarFaces : [];
  const mediaPrefix =
    config.ALIYUN_OSS_MEDIA_BUCKET === undefined
      ? null
      : `oss://${config.ALIYUN_OSS_MEDIA_BUCKET}/`;
  const candidates = groups.flatMap((groupValue) => {
    const group = asRecord(groupValue);
    const similarFaces = Array.isArray(group?.SimilarFaces) ? group.SimilarFaces : [];
    return similarFaces.flatMap((candidateValue) => {
      const candidate = asRecord(candidateValue);
      if (candidate === null) return [];
      const similarity = candidate.Similarity;
      if (typeof similarity !== "number" || !Number.isFinite(similarity)) return [];
      const uri = candidate.URI;
      const objectKey =
        typeof uri === "string" && mediaPrefix !== null && uri.startsWith(mediaPrefix)
          ? uri.slice(mediaPrefix.length)
          : null;
      return [
        {
          objectKey,
          similarity,
          accepted: similarity >= config.FACE_SEARCH_ASYNC_THRESHOLD,
        },
      ];
    });
  });

  request.log.info(
    {
      event: "face_search_similarity",
      source: "aliyun_faces_searching",
      providerTaskId: typeof data.TaskId === "string" ? data.TaskId : null,
      providerStatus: typeof data.Status === "string" ? data.Status : null,
      threshold: config.FACE_SEARCH_ASYNC_THRESHOLD,
      candidateCount: candidates.length,
      candidates,
    },
    "face search similarity results",
  );
}

export async function registerFaceRoutes(
  app: FastifyInstance,
  options: {
    authService: AuthService;
    faceService: FaceService;
    facePublicStateService: FacePublicStateService;
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
        actor: actorFrom(session),
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
        actor: { ...actorFrom(session), authenticatedAt: new Date() },
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
      await verifyPasswordConfirmation(request, options.authService, session);
      return options.faceService.deleteIndex(
        { ...actorFrom(session), authenticatedAt: new Date() },
        request.params.id,
        request.id,
      );
    },
  );

  typed.get(
    "/api/v1/public/albums/:slug/face-state",
    {
      schema: {
        operationId: "getPublicFaceState",
        tags: ["public", "face"],
        params: slugParams,
        response: { 200: publicFaceStateSchema, ...errors },
      },
    },
    async (request, reply) => {
      privateResponse(reply);
      return options.facePublicStateService.get(
        request.params.slug,
        visitorSessionToken(request, options.config, request.params.slug),
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
        visitorToken: faceSearchVisitorToken(request, reply, options.config, request.params.slug),
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
        visitorToken: faceSearchVisitorToken(request, reply, options.config, request.params.slug),
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
        visitorToken: faceSearchVisitorToken(request, reply, options.config, request.params.slug),
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
        visitorToken: faceSearchVisitorToken(request, reply, options.config, request.params.slug),
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
            {
              eventBridgeVerificationStage: error.stage,
              ...error.context,
            },
            "EventBridge signature rejected",
          );
        }
        throw error;
      }
      const result = await options.faceService.processEvent(request.body);
      logFaceSearchSimilarityResults(request, request.body, options.config);
      return result;
    },
  );
}
