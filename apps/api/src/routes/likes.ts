import { apiErrorSchema } from "@photostream/contracts";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import type { MediaLikeService } from "../media/like-service.js";
import type { PhotoService } from "../media/service.js";
import { likeVisitorId, visitorSessionToken } from "../media/visitor-http.js";

const slugParamsSchema = z.object({ slug: z.string().min(12).max(32) }).strict();
const mediaLikeParamsSchema = z
  .object({ slug: z.string().min(12).max(32), id: z.string().uuid() })
  .strict();
const likeListQuerySchema = z.object({ mediaIds: z.string().min(1).max(10_000) }).strict();
const mediaLikeStateSchema = z
  .object({
    mediaId: z.string().uuid(),
    count: z.number().int().min(0),
    likedByViewer: z.boolean(),
  })
  .strict();
const mediaLikeListSchema = z.object({ items: z.array(mediaLikeStateSchema) }).strict();

function parseMediaIds(value: string): string[] {
  const ids = [...new Set(value.split(",").filter((candidate) => candidate.length > 0))];
  if (ids.length === 0 || ids.length > 120 || ids.some((id) => !z.string().uuid().safeParse(id).success)) {
    throw new AppError({ code: "BAD_REQUEST", message: "照片列表无效", statusCode: 400 });
  }
  return ids;
}

export async function registerLikeRoutes(
  app: FastifyInstance,
  options: {
    readonly config: AppConfig;
    readonly likeService: MediaLikeService;
    readonly photoService: PhotoService;
  },
): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const commonErrors = {
    400: apiErrorSchema,
    403: apiErrorSchema,
    404: apiErrorSchema,
    429: apiErrorSchema,
    500: apiErrorSchema,
  };

  typed.get(
    "/api/v1/public/albums/:slug/likes",
    {
      schema: {
        operationId: "listPublicMediaLikes",
        tags: ["public", "likes"],
        params: slugParamsSchema,
        querystring: likeListQuerySchema,
        response: { 200: mediaLikeListSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      void reply.header("cache-control", "no-store");
      const visitorToken = visitorSessionToken(request, options.config, request.params.slug);
      const album = await options.photoService.getAuthorizedPublicAlbum(
        request.params.slug,
        visitorToken,
      );
      const items = await options.likeService.listStates({
        albumId: album.id,
        mediaIds: parseMediaIds(request.query.mediaIds),
        viewerId: likeVisitorId(request, reply, options.config),
      });
      return { items };
    },
  );

  typed.post(
    "/api/v1/public/albums/:slug/media/:id/like",
    {
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      schema: {
        operationId: "likePublicMedia",
        tags: ["public", "likes"],
        params: mediaLikeParamsSchema,
        response: { 200: mediaLikeStateSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      void reply.header("cache-control", "no-store");
      const visitorToken = visitorSessionToken(request, options.config, request.params.slug);
      const album = await options.photoService.getAuthorizedPublicAlbum(
        request.params.slug,
        visitorToken,
      );
      return options.likeService.setLike({
        albumId: album.id,
        mediaId: request.params.id,
        viewerId: likeVisitorId(request, reply, options.config),
        liked: true,
      });
    },
  );

  typed.delete(
    "/api/v1/public/albums/:slug/media/:id/like",
    {
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      schema: {
        operationId: "unlikePublicMedia",
        tags: ["public", "likes"],
        params: mediaLikeParamsSchema,
        response: { 200: mediaLikeStateSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      void reply.header("cache-control", "no-store");
      const visitorToken = visitorSessionToken(request, options.config, request.params.slug);
      const album = await options.photoService.getAuthorizedPublicAlbum(
        request.params.slug,
        visitorToken,
      );
      return options.likeService.setLike({
        albumId: album.id,
        mediaId: request.params.id,
        viewerId: likeVisitorId(request, reply, options.config),
        liked: false,
      });
    },
  );
}
