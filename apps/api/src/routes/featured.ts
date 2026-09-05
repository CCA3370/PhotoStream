import { apiErrorSchema, deletionTaskViewSchema } from "@photostream/contracts";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { requireInternalCsrf, requireInternalSession } from "../auth/http.js";
import type { AuthService } from "../auth/service.js";
import type { AppConfig } from "../config.js";
import type { FeaturedService } from "../media/featured-service.js";
import type { OperationsService } from "../media/operations-service.js";
import type { PhotoService } from "../media/service.js";
import { visitorSessionToken } from "../media/visitor-http.js";

const idParamsSchema = z.object({ id: z.string().uuid() }).strict();
const slugParamsSchema = z.object({ slug: z.string().min(12).max(32) }).strict();
const featuredListSchema = z.object({ mediaIds: z.array(z.string().uuid()) }).strict();
const featuredStateSchema = z
  .object({ mediaId: z.string().uuid(), featured: z.boolean() })
  .strict();
const setFeaturedSchema = z.object({ featured: z.boolean() }).strict();

function actorFrom(session: Awaited<ReturnType<typeof requireInternalSession>>) {
  return { id: session.record.user.id, role: session.record.user.role };
}

export async function registerFeaturedRoutes(
  app: FastifyInstance,
  options: {
    readonly authService: AuthService;
    readonly featuredService: FeaturedService;
    readonly operationsService: OperationsService;
    readonly photoService: PhotoService;
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

  typed.get(
    "/api/v1/albums/:id/featured",
    {
      schema: {
        operationId: "listInternalFeaturedMedia",
        tags: ["media"],
        params: idParamsSchema,
        response: { 200: featuredListSchema, ...errors },
      },
    },
    async (request) => {
      const session = await requireInternalSession(request, options.authService, options.config);
      return {
        mediaIds: await options.featuredService.listInternal(actorFrom(session), request.params.id),
      };
    },
  );

  typed.post(
    "/api/v1/media/:id/featured",
    {
      schema: {
        operationId: "setMediaFeatured",
        tags: ["media"],
        params: idParamsSchema,
        body: setFeaturedSchema,
        response: { 200: featuredStateSchema, ...errors },
      },
    },
    async (request) => {
      const session = await requireInternalCsrf(request, options.authService, options.config);
      return options.featuredService.setFeatured({
        actor: actorFrom(session),
        mediaId: request.params.id,
        featured: request.body.featured,
        requestId: request.id,
      });
    },
  );

  typed.get(
    "/api/v1/public/albums/:slug/featured",
    {
      schema: {
        operationId: "listPublicFeaturedMedia",
        tags: ["public", "media"],
        params: slugParamsSchema,
        response: { 200: featuredListSchema, ...errors },
      },
    },
    async (request, reply) => {
      const token = visitorSessionToken(request, options.config, request.params.slug);
      const album = await options.photoService.getPublicAlbum(request.params.slug, token);
      void reply.header("cache-control", "no-store");
      if (album.view.accessRequired) return { mediaIds: [] };
      return { mediaIds: await options.featuredService.listPublishedBySlug(request.params.slug) };
    },
  );

  typed.delete(
    "/api/v1/media/:id/direct",
    {
      schema: {
        operationId: "deleteMediaDirectly",
        tags: ["media"],
        params: idParamsSchema,
        response: { 202: deletionTaskViewSchema, ...errors },
      },
    },
    async (request, reply) => {
      const session = await requireInternalCsrf(request, options.authService, options.config);
      const context = await options.featuredService.deletionContext(request.params.id);
      const task = await options.operationsService.requestDeletion({
        actor: { ...actorFrom(session), authenticatedAt: new Date() },
        mediaId: request.params.id,
        confirmation: context.albumTitle,
        requestId: request.id,
      });
      return reply.status(202).send(task);
    },
  );
}
