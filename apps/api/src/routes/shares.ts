import {
  apiErrorSchema,
  derivedPhotoVariantKindSchema,
  downloadKindSchema,
  publicMediaViewSchema,
  refreshedPhotoVariantSchema,
  signedDownloadSchema,
} from "@photostream/contracts";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { AppConfig } from "../config.js";
import type { PhotoShareService } from "../media/share-service.js";
import {
  anonymousVisitorId,
  likeVisitorId,
  visitorSessionToken,
} from "../media/visitor-http.js";

const paramsSchema = z
  .object({
    slug: z.string().min(12).max(32),
    mediaId: z.string().uuid(),
  })
  .strict();
const shareQuerySchema = z.object({ share: z.string().uuid() }).strict();
const createShareResponseSchema = z.object({ shareId: z.string().uuid() }).strict();
const mediaLikeStateSchema = z
  .object({
    mediaId: z.string().uuid(),
    count: z.number().int().min(0),
    likedByViewer: z.boolean(),
  })
  .strict();

export async function registerShareRoutes(
  app: FastifyInstance,
  options: { readonly config: AppConfig; readonly shareService: PhotoShareService },
): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const commonErrors = {
    400: apiErrorSchema,
    403: apiErrorSchema,
    404: apiErrorSchema,
    409: apiErrorSchema,
    429: apiErrorSchema,
    500: apiErrorSchema,
  };

  typed.post(
    "/api/v1/public/albums/:slug/media/:mediaId/share",
    {
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: {
        operationId: "createPublicPhotoShare",
        tags: ["public"],
        params: paramsSchema,
        response: { 200: createShareResponseSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      void reply.header("cache-control", "no-store");
      return options.shareService.createShare({
        ...request.params,
        visitorToken: visitorSessionToken(request, options.config, request.params.slug),
      });
    },
  );

  typed.get(
    "/api/v1/public/albums/:slug/media/:mediaId",
    {
      schema: {
        operationId: "getPublicPhoto",
        tags: ["public"],
        params: paramsSchema,
        response: { 200: publicMediaViewSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      void reply.header("cache-control", "no-store");
      return options.shareService.getAuthorizedMedia({
        ...request.params,
        visitorToken: visitorSessionToken(request, options.config, request.params.slug),
      });
    },
  );

  typed.get(
    "/api/v1/public/albums/:slug/shared/:mediaId",
    {
      schema: {
        operationId: "getSharedPublicPhoto",
        tags: ["public"],
        params: paramsSchema,
        querystring: shareQuerySchema,
        response: { 200: publicMediaViewSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      void reply.header("cache-control", "no-store");
      return options.shareService.getSharedMedia({
        ...request.params,
        shareId: request.query.share,
      });
    },
  );

  typed.get(
    "/api/v1/public/albums/:slug/shared/:mediaId/like",
    {
      schema: {
        operationId: "getSharedPublicPhotoLike",
        tags: ["public", "likes"],
        params: paramsSchema,
        querystring: shareQuerySchema,
        response: { 200: mediaLikeStateSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      void reply.header("cache-control", "no-store");
      return options.shareService.getSharedLikeState({
        ...request.params,
        shareId: request.query.share,
        viewerId: likeVisitorId(request, reply, options.config),
      });
    },
  );

  for (const liked of [true, false] as const) {
    typed.route({
      method: liked ? "POST" : "DELETE",
      url: "/api/v1/public/albums/:slug/shared/:mediaId/like",
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      schema: {
        operationId: liked ? "likeSharedPublicPhoto" : "unlikeSharedPublicPhoto",
        tags: ["public", "likes"],
        params: paramsSchema,
        querystring: shareQuerySchema,
        response: { 200: mediaLikeStateSchema, ...commonErrors },
      },
      handler: async (request, reply) => {
        void reply.header("cache-control", "no-store");
        return options.shareService.setSharedLike({
          ...request.params,
          shareId: request.query.share,
          viewerId: likeVisitorId(request, reply, options.config),
          liked,
        });
      },
    });
  }

  typed.post(
    "/api/v1/public/albums/:slug/shared/:mediaId/original/view",
    {
      config: { rateLimit: { max: 60, timeWindow: "10 minutes" } },
      schema: {
        operationId: "issueSharedOriginalView",
        tags: ["public"],
        params: paramsSchema,
        querystring: shareQuerySchema,
        response: { 200: signedDownloadSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      void reply.header("cache-control", "no-store");
      return options.shareService.issueSharedOriginalView({
        ...request.params,
        shareId: request.query.share,
      });
    },
  );

  typed.post(
    "/api/v1/public/albums/:slug/shared/:mediaId/downloads/:kind",
    {
      config: { rateLimit: { max: 30, timeWindow: "10 minutes" } },
      schema: {
        operationId: "issueSharedPhotoDownload",
        tags: ["public"],
        params: paramsSchema.extend({ kind: downloadKindSchema }),
        querystring: shareQuerySchema,
        response: { 200: signedDownloadSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      void reply.header("cache-control", "no-store");
      return options.shareService.issueSharedDownload({
        ...request.params,
        shareId: request.query.share,
        visitorId: anonymousVisitorId(request, reply, options.config),
      });
    },
  );

  typed.get(
    "/api/v1/public/albums/:slug/shared/:mediaId/variants/:kind",
    {
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      schema: {
        operationId: "refreshSharedPublicPhotoVariant",
        tags: ["public"],
        params: paramsSchema.extend({ kind: derivedPhotoVariantKindSchema }),
        querystring: shareQuerySchema,
        response: { 200: refreshedPhotoVariantSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      void reply.header("cache-control", "no-store");
      return options.shareService.refreshSharedVariant({
        ...request.params,
        shareId: request.query.share,
      });
    },
  );
}
