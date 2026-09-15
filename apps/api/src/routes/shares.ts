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
import { anonymousVisitorId, likeVisitorId, visitorSessionToken } from "../media/visitor-http.js";

const paramsSchema = z
  .object({
    slug: z.string().min(12).max(32),
    mediaId: z.string().uuid(),
  })
  .strict();
const shareIdParamsSchema = z.object({ shareId: z.string().uuid() }).strict();
const createShareResponseSchema = z.object({ shareId: z.string().uuid() }).strict();
const shortShareViewSchema = z
  .object({
    slug: z.string().min(12).max(32),
    title: z.string(),
    description: z.string().nullable(),
    media: publicMediaViewSchema,
  })
  .strict();
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
    "/api/v1/public/shares/:shareId",
    {
      config: { rateLimit: { max: 180, timeWindow: "1 minute" } },
      schema: {
        operationId: "getPublicPhotoShare",
        tags: ["public"],
        params: shareIdParamsSchema,
        response: { 200: shortShareViewSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      void reply.header("cache-control", "no-store");
      return options.shareService.getShareView(request.params);
    },
  );

  typed.get(
    "/api/v1/public/shares/:shareId/micro-preview",
    {
      config: { rateLimit: { max: 300, timeWindow: "1 minute" } },
      schema: {
        operationId: "readPublicPhotoShareMicroPreview",
        tags: ["public"],
        params: shareIdParamsSchema,
      },
    },
    async (request, reply) => {
      const url = await options.shareService.sharedMicroPreviewUrl(request.params);
      return reply
        .status(302)
        .header("cache-control", "public, max-age=60")
        .header("location", url)
        .send();
    },
  );

  typed.get(
    "/api/v1/public/shares/:shareId/like",
    {
      schema: {
        operationId: "getPublicPhotoShareLike",
        tags: ["public", "likes"],
        params: shareIdParamsSchema,
        response: { 200: mediaLikeStateSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      void reply.header("cache-control", "no-store");
      return options.shareService.getSharedLikeState({
        ...request.params,
        viewerId: likeVisitorId(request, reply, options.config),
      });
    },
  );

  for (const liked of [true, false] as const) {
    typed.route({
      method: liked ? "POST" : "DELETE",
      url: "/api/v1/public/shares/:shareId/like",
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      schema: {
        operationId: liked ? "likePublicPhotoShare" : "unlikePublicPhotoShare",
        tags: ["public", "likes"],
        params: shareIdParamsSchema,
        response: { 200: mediaLikeStateSchema, ...commonErrors },
      },
      handler: async (request, reply) => {
        void reply.header("cache-control", "no-store");
        return options.shareService.setSharedLike({
          ...request.params,
          viewerId: likeVisitorId(request, reply, options.config),
          liked,
        });
      },
    });
  }

  typed.post(
    "/api/v1/public/shares/:shareId/original/view",
    {
      config: { rateLimit: { max: 60, timeWindow: "10 minutes" } },
      schema: {
        operationId: "issuePublicPhotoShareOriginalView",
        tags: ["public"],
        params: shareIdParamsSchema,
        response: { 200: signedDownloadSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      void reply.header("cache-control", "no-store");
      return options.shareService.issueSharedOriginalView(request.params);
    },
  );

  typed.post(
    "/api/v1/public/shares/:shareId/downloads/:kind",
    {
      config: { rateLimit: { max: 30, timeWindow: "10 minutes" } },
      schema: {
        operationId: "issuePublicPhotoShareDownload",
        tags: ["public"],
        params: shareIdParamsSchema.extend({ kind: downloadKindSchema }),
        response: { 200: signedDownloadSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      void reply.header("cache-control", "no-store");
      return options.shareService.issueSharedDownload({
        ...request.params,
        visitorId: anonymousVisitorId(request, reply, options.config),
      });
    },
  );

  typed.get(
    "/api/v1/public/shares/:shareId/variants/:kind",
    {
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      schema: {
        operationId: "refreshPublicPhotoShareVariant",
        tags: ["public"],
        params: shareIdParamsSchema.extend({ kind: derivedPhotoVariantKindSchema }),
        response: { 200: refreshedPhotoVariantSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      void reply.header("cache-control", "no-store");
      return options.shareService.refreshSharedVariant(request.params);
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
}
