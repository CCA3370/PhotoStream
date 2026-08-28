import {
  albumViewSchema,
  apiErrorSchema,
  categoryViewSchema,
  completeUploadPartRequestSchema,
  createAlbumRequestSchema,
  createAlbumResponseSchema,
  createCategoryRequestSchema,
  createPhotoUploadRequestSchema,
  internalMediaViewSchema,
  liveEventViewSchema,
  okResponseSchema,
  photoVariantKindSchema,
  publicAlbumViewSchema,
  publicMediaListSchema,
  signedUploadSchema,
  unlockAlbumRequestSchema,
  unlockAlbumResponseSchema,
  uploadIntentViewSchema,
} from "@photostream/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { requireInternalCsrf, requireInternalSession } from "../auth/http.js";
import type { AuthService } from "../auth/service.js";
import type { AppConfig } from "../config.js";
import type { LiveEventBroker } from "../media/live-event-broker.js";
import type { PhotoService } from "../media/service.js";

const idParamsSchema = z.object({ id: z.string().uuid() }).strict();
const albumIdParamsSchema = z.object({ id: z.string().uuid() }).strict();
const uploadVariantParamsSchema = z
  .object({ id: z.string().uuid(), variant: photoVariantKindSchema })
  .strict();
const uploadPartParamsSchema = z
  .object({
    id: z.string().uuid(),
    variant: photoVariantKindSchema,
    partNumber: z.coerce.number().int().positive().max(10_000),
  })
  .strict();
const mediaIdParamsSchema = z.object({ id: z.string().uuid() }).strict();
const slugParamsSchema = z.object({ slug: z.string().min(12).max(32) }).strict();
const publicMediaQuerySchema = z
  .object({
    cursor: z.string().max(1_000).optional(),
    categoryId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(60).default(60),
  })
  .strict();
const changesQuerySchema = z.object({ after: z.coerce.number().int().min(0).default(0) }).strict();
const eventStreamQuerySchema = z
  .object({ after: z.coerce.number().int().min(0).optional() })
  .strict();
const eventListSchema = z.object({ events: z.array(liveEventViewSchema) }).strict();

function idempotencyKey(request: FastifyRequest): string | undefined {
  const value = request.headers["idempotency-key"];
  return typeof value === "string" ? value : undefined;
}

function visitorCookieName(config: AppConfig, slug: string): string {
  const prefix = config.NODE_ENV === "production" ? "__Host-" : "";
  return `${prefix}photostream_album_${slug}`;
}

function visitorToken(
  request: FastifyRequest,
  config: AppConfig,
  slug: string,
): string | undefined {
  return request.cookies[visitorCookieName(config, slug)];
}

function actorFrom(session: Awaited<ReturnType<typeof requireInternalSession>>) {
  return { id: session.record.user.id, role: session.record.user.role };
}

export async function registerPhotoRoutes(
  app: FastifyInstance,
  options: {
    readonly authService: AuthService;
    readonly photoService: PhotoService;
    readonly broker: LiveEventBroker;
    readonly config: AppConfig;
  },
): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const commonErrors = {
    400: apiErrorSchema,
    401: apiErrorSchema,
    403: apiErrorSchema,
    404: apiErrorSchema,
    409: apiErrorSchema,
    429: apiErrorSchema,
    500: apiErrorSchema,
  };

  typed.get(
    "/api/v1/albums",
    {
      schema: {
        operationId: "listAlbums",
        tags: ["albums"],
        response: { 200: z.array(albumViewSchema), ...commonErrors },
      },
    },
    async (request) => {
      const session = await requireInternalSession(request, options.authService, options.config);
      return options.photoService.listAlbums(actorFrom(session));
    },
  );

  typed.post(
    "/api/v1/albums",
    {
      schema: {
        operationId: "createAlbum",
        tags: ["albums"],
        body: createAlbumRequestSchema,
        response: {
          201: createAlbumResponseSchema,
          200: createAlbumResponseSchema,
          ...commonErrors,
        },
      },
    },
    async (request, reply) => {
      const session = await requireInternalCsrf(request, options.authService, options.config);
      const result = await options.photoService.createAlbum({
        actor: actorFrom(session),
        input: request.body,
        idempotencyKey: idempotencyKey(request),
        requestId: request.id,
      });
      return reply.status(201).send(result);
    },
  );

  typed.get(
    "/api/v1/albums/:id",
    {
      schema: {
        operationId: "getAlbum",
        tags: ["albums"],
        params: idParamsSchema,
        response: { 200: albumViewSchema, ...commonErrors },
      },
    },
    async (request) => {
      const session = await requireInternalSession(request, options.authService, options.config);
      return options.photoService.getAlbum(actorFrom(session), request.params.id);
    },
  );

  typed.post(
    "/api/v1/albums/:id/start",
    {
      schema: {
        operationId: "startAlbum",
        tags: ["albums"],
        params: albumIdParamsSchema,
        response: { 200: albumViewSchema, ...commonErrors },
      },
    },
    async (request) => {
      const session = await requireInternalCsrf(request, options.authService, options.config);
      return options.photoService.startAlbum({
        actor: actorFrom(session),
        albumId: request.params.id,
        requestId: request.id,
      });
    },
  );

  typed.post(
    "/api/v1/albums/:id/categories",
    {
      schema: {
        operationId: "createCategory",
        tags: ["albums"],
        params: albumIdParamsSchema,
        body: createCategoryRequestSchema,
        response: { 201: categoryViewSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      const session = await requireInternalCsrf(request, options.authService, options.config);
      const category = await options.photoService.createCategory({
        actor: actorFrom(session),
        albumId: request.params.id,
        name: request.body.name,
        sortOrder: request.body.sortOrder,
        idempotencyKey: idempotencyKey(request),
      });
      return reply.status(201).send(category);
    },
  );

  typed.get(
    "/api/v1/albums/:id/categories",
    {
      schema: {
        operationId: "listCategories",
        tags: ["albums"],
        params: albumIdParamsSchema,
        response: { 200: z.array(categoryViewSchema), ...commonErrors },
      },
    },
    async (request) => {
      const session = await requireInternalSession(request, options.authService, options.config);
      return options.photoService.listCategories(actorFrom(session), request.params.id);
    },
  );

  typed.post(
    "/api/v1/uploads",
    {
      schema: {
        operationId: "createPhotoUpload",
        tags: ["uploads"],
        body: createPhotoUploadRequestSchema,
        response: { 201: uploadIntentViewSchema, 200: uploadIntentViewSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      const session = await requireInternalCsrf(request, options.authService, options.config);
      const intent = await options.photoService.createPhotoUpload({
        actor: actorFrom(session),
        input: request.body,
        idempotencyKey: idempotencyKey(request),
      });
      return reply.status(201).send(intent);
    },
  );

  typed.get(
    "/api/v1/uploads/:id",
    {
      schema: {
        operationId: "getUploadIntent",
        tags: ["uploads"],
        params: idParamsSchema,
        response: { 200: uploadIntentViewSchema, ...commonErrors },
      },
    },
    async (request) => {
      const session = await requireInternalSession(request, options.authService, options.config);
      return options.photoService.getUploadIntent(actorFrom(session), request.params.id);
    },
  );

  typed.post(
    "/api/v1/uploads/:id/objects/:variant/sign",
    {
      schema: {
        operationId: "signUploadObject",
        tags: ["uploads"],
        params: uploadVariantParamsSchema,
        response: { 200: signedUploadSchema, ...commonErrors },
      },
    },
    async (request) => {
      const session = await requireInternalCsrf(request, options.authService, options.config);
      return options.photoService.signUpload({
        actor: actorFrom(session),
        intentId: request.params.id,
        kind: request.params.variant,
      });
    },
  );

  typed.post(
    "/api/v1/uploads/:id/objects/:variant/complete",
    {
      schema: {
        operationId: "completeUploadObject",
        tags: ["uploads"],
        params: uploadVariantParamsSchema,
        response: { 200: uploadIntentViewSchema, ...commonErrors },
      },
    },
    async (request) => {
      const session = await requireInternalCsrf(request, options.authService, options.config);
      return options.photoService.completeUploadObject({
        actor: actorFrom(session),
        intentId: request.params.id,
        kind: request.params.variant,
      });
    },
  );

  typed.post(
    "/api/v1/uploads/:id/objects/:variant/parts/:partNumber/sign",
    {
      schema: {
        operationId: "signUploadPart",
        tags: ["uploads"],
        params: uploadPartParamsSchema,
        response: { 200: signedUploadSchema, ...commonErrors },
      },
    },
    async (request) => {
      const session = await requireInternalCsrf(request, options.authService, options.config);
      return options.photoService.signUploadPart({
        actor: actorFrom(session),
        intentId: request.params.id,
        kind: request.params.variant,
        partNumber: request.params.partNumber,
      });
    },
  );

  typed.post(
    "/api/v1/uploads/:id/objects/:variant/parts/:partNumber/complete",
    {
      schema: {
        operationId: "completeUploadPart",
        tags: ["uploads"],
        params: uploadPartParamsSchema,
        body: completeUploadPartRequestSchema,
        response: { 200: uploadIntentViewSchema, ...commonErrors },
      },
    },
    async (request) => {
      const session = await requireInternalCsrf(request, options.authService, options.config);
      return options.photoService.completeUploadPart({
        actor: actorFrom(session),
        intentId: request.params.id,
        kind: request.params.variant,
        partNumber: request.params.partNumber,
        etag: request.body.etag,
      });
    },
  );

  typed.post(
    "/api/v1/media/:id/publish",
    {
      schema: {
        operationId: "publishMedia",
        tags: ["media"],
        params: mediaIdParamsSchema,
        response: { 200: okResponseSchema, ...commonErrors },
      },
    },
    async (request) => {
      const session = await requireInternalCsrf(request, options.authService, options.config);
      await options.photoService.publishMedia({
        actor: actorFrom(session),
        mediaId: request.params.id,
        requestId: request.id,
      });
      return { ok: true as const };
    },
  );

  typed.get(
    "/api/v1/albums/:id/media",
    {
      schema: {
        operationId: "listInternalMedia",
        tags: ["media"],
        params: albumIdParamsSchema,
        response: { 200: z.array(internalMediaViewSchema), ...commonErrors },
      },
    },
    async (request) => {
      const session = await requireInternalSession(request, options.authService, options.config);
      return options.photoService.listInternalMedia(actorFrom(session), request.params.id);
    },
  );

  typed.get(
    "/api/v1/public/albums/:slug",
    {
      schema: {
        operationId: "getPublicAlbum",
        tags: ["public"],
        params: slugParamsSchema,
        response: { 200: publicAlbumViewSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      void reply.header("cache-control", "no-store");
      const result = await options.photoService.getPublicAlbum(
        request.params.slug,
        visitorToken(request, options.config, request.params.slug),
      );
      return result.view;
    },
  );

  typed.post(
    "/api/v1/public/albums/:slug/unlock",
    {
      config: { rateLimit: { max: 10, timeWindow: "10 minutes" } },
      schema: {
        operationId: "unlockPublicAlbum",
        tags: ["public"],
        params: slugParamsSchema,
        body: unlockAlbumRequestSchema,
        response: { 200: unlockAlbumResponseSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      const unlocked = await options.photoService.unlockAlbum(
        request.params.slug,
        request.body.password,
      );
      reply.setCookie(visitorCookieName(options.config, request.params.slug), unlocked.rawToken, {
        httpOnly: true,
        secure: options.config.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        expires: unlocked.expiresAt,
      });
      void reply.header("cache-control", "no-store");
      return { unlocked: true as const };
    },
  );

  typed.get(
    "/api/v1/public/albums/:slug/media",
    {
      schema: {
        operationId: "listPublicMedia",
        tags: ["public"],
        params: slugParamsSchema,
        querystring: publicMediaQuerySchema,
        response: { 200: publicMediaListSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      void reply.header("cache-control", "no-store");
      return options.photoService.listPublicMedia({
        slug: request.params.slug,
        visitorToken: visitorToken(request, options.config, request.params.slug),
        cursor: request.query.cursor,
        categoryId: request.query.categoryId,
        limit: request.query.limit,
      });
    },
  );

  typed.get(
    "/api/v1/public/albums/:slug/changes",
    {
      schema: {
        operationId: "listPublicChanges",
        tags: ["public"],
        params: slugParamsSchema,
        querystring: changesQuerySchema,
        response: { 200: eventListSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      void reply.header("cache-control", "no-store");
      const result = await options.photoService.listLiveEvents({
        slug: request.params.slug,
        visitorToken: visitorToken(request, options.config, request.params.slug),
        afterId: request.query.after,
      });
      return { events: result.events };
    },
  );

  typed.get(
    "/api/v1/public/albums/:slug/events",
    {
      schema: {
        operationId: "streamPublicEvents",
        tags: ["public"],
        params: slugParamsSchema,
        querystring: eventStreamQuerySchema,
        response: { ...commonErrors },
      },
    },
    async (request, reply) => {
      const lastEventHeader = request.headers["last-event-id"];
      const headerEventId =
        typeof lastEventHeader === "string" && /^\d+$/u.test(lastEventHeader)
          ? Number(lastEventHeader)
          : 0;
      let lastEventId = Math.max(headerEventId, request.query.after ?? 0);
      const initial = await options.photoService.listLiveEvents({
        slug: request.params.slug,
        visitorToken: visitorToken(request, options.config, request.params.slug),
        afterId: lastEventId,
      });

      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      reply.raw.flushHeaders();
      reply.raw.write(": connected\n\n");
      const send = (events: typeof initial.events) => {
        for (const event of events) {
          lastEventId = event.id;
          reply.raw.write(`id: ${event.id}\n`);
          reply.raw.write(`event: ${event.type}\n`);
          reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
        }
      };
      send(initial.events);

      let running = false;
      const flush = async () => {
        if (running || reply.raw.destroyed) return;
        running = true;
        try {
          const next = await options.photoService.listLiveEvents({
            slug: request.params.slug,
            visitorToken: visitorToken(request, options.config, request.params.slug),
            afterId: lastEventId,
          });
          send(next.events);
        } finally {
          running = false;
        }
      };
      const safeFlush = () => {
        void flush().catch((error: unknown) => {
          request.log.error({ err: error }, "SSE replay failed");
          reply.raw.end();
        });
      };
      const unsubscribe = options.broker.subscribe(initial.album.id, safeFlush);
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
