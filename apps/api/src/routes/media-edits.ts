import {
  apiErrorSchema,
  applyMediaEditRequestSchema,
  createMediaEditRevisionRequestSchema,
  mediaEditContextViewSchema,
  mediaEditSourceViewSchema,
  mediaEditVariantKindSchema,
  okResponseSchema,
  revertMediaEditRequestSchema,
  signedUploadSchema,
} from "@photostream/contracts";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { requireInternalCsrf, requireInternalSession } from "../auth/http.js";
import type { AuthService } from "../auth/service.js";
import type { AppConfig } from "../config.js";
import type { MediaEditService } from "../media/edit-service.js";

const mediaParamsSchema = z.object({ id: z.string().uuid() }).strict();
const revisionParamsSchema = z
  .object({ id: z.string().uuid(), revisionId: z.string().uuid() })
  .strict();
const variantParamsSchema = revisionParamsSchema
  .extend({ kind: mediaEditVariantKindSchema })
  .strict();

const commonErrors = {
  400: apiErrorSchema,
  401: apiErrorSchema,
  403: apiErrorSchema,
  404: apiErrorSchema,
  409: apiErrorSchema,
  429: apiErrorSchema,
  500: apiErrorSchema,
};

function actorFrom(session: Awaited<ReturnType<typeof requireInternalSession>>) {
  return { id: session.record.user.id, role: session.record.user.role };
}

export async function registerMediaEditRoutes(
  app: FastifyInstance,
  options: {
    readonly authService: AuthService;
    readonly config: AppConfig;
    readonly mediaEditService: MediaEditService;
  },
): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/api/v1/media/:id/edit-context",
    {
      schema: {
        operationId: "getMediaEditContext",
        tags: ["media-edit"],
        params: mediaParamsSchema,
        response: { 200: mediaEditContextViewSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      void reply.header("cache-control", "no-store");
      const session = await requireInternalSession(request, options.authService, options.config);
      return options.mediaEditService.getContext(actorFrom(session), request.params.id);
    },
  );

  typed.post(
    "/api/v1/media/:id/edits",
    {
      schema: {
        operationId: "createMediaEditRevision",
        tags: ["media-edit"],
        params: mediaParamsSchema,
        body: createMediaEditRevisionRequestSchema,
        response: { 201: mediaEditContextViewSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      void reply.header("cache-control", "no-store");
      const session = await requireInternalCsrf(request, options.authService, options.config);
      const context = await options.mediaEditService.createRevision({
        actor: actorFrom(session),
        mediaId: request.params.id,
        input: request.body,
        requestId: request.id,
      });
      return reply.status(201).send(context);
    },
  );

  typed.post(
    "/api/v1/media/:id/edit-source",
    {
      schema: {
        operationId: "createMediaEditSource",
        tags: ["media-edit"],
        params: mediaParamsSchema,
        response: { 200: mediaEditSourceViewSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      void reply.header("cache-control", "no-store");
      const session = await requireInternalCsrf(request, options.authService, options.config);
      return options.mediaEditService.source(actorFrom(session), request.params.id);
    },
  );

  typed.post(
    "/api/v1/media/:id/edits/:revisionId/variants/:kind/sign",
    {
      schema: {
        operationId: "signMediaEditVariant",
        tags: ["media-edit"],
        params: variantParamsSchema,
        response: { 200: signedUploadSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      void reply.header("cache-control", "no-store");
      const session = await requireInternalCsrf(request, options.authService, options.config);
      return options.mediaEditService.signVariant({
        actor: actorFrom(session),
        mediaId: request.params.id,
        revisionId: request.params.revisionId,
        kind: request.params.kind,
      });
    },
  );

  typed.post(
    "/api/v1/media/:id/edits/:revisionId/variants/:kind/complete",
    {
      schema: {
        operationId: "completeMediaEditVariant",
        tags: ["media-edit"],
        params: variantParamsSchema,
        response: { 200: okResponseSchema, ...commonErrors },
      },
    },
    async (request) => {
      const session = await requireInternalCsrf(request, options.authService, options.config);
      return options.mediaEditService.completeVariant({
        actor: actorFrom(session),
        mediaId: request.params.id,
        revisionId: request.params.revisionId,
        kind: request.params.kind,
      });
    },
  );

  typed.post(
    "/api/v1/media/:id/edits/:revisionId/complete",
    {
      schema: {
        operationId: "completeMediaEditRevision",
        tags: ["media-edit"],
        params: revisionParamsSchema,
        response: { 200: mediaEditContextViewSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      void reply.header("cache-control", "no-store");
      const session = await requireInternalCsrf(request, options.authService, options.config);
      return options.mediaEditService.completeRevision({
        actor: actorFrom(session),
        mediaId: request.params.id,
        revisionId: request.params.revisionId,
        requestId: request.id,
      });
    },
  );

  typed.post(
    "/api/v1/media/:id/edits/:revisionId/apply",
    {
      schema: {
        operationId: "applyMediaEditRevision",
        tags: ["media-edit"],
        params: revisionParamsSchema,
        body: applyMediaEditRequestSchema,
        response: { 200: mediaEditContextViewSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      void reply.header("cache-control", "no-store");
      const session = await requireInternalCsrf(request, options.authService, options.config);
      return options.mediaEditService.apply({
        actor: actorFrom(session),
        mediaId: request.params.id,
        revisionId: request.params.revisionId,
        input: request.body,
        requestId: request.id,
      });
    },
  );

  typed.post(
    "/api/v1/media/:id/edits/:revisionId/cancel",
    {
      schema: {
        operationId: "cancelMediaEditRevision",
        tags: ["media-edit"],
        params: revisionParamsSchema,
        response: { 200: mediaEditContextViewSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      void reply.header("cache-control", "no-store");
      const session = await requireInternalCsrf(request, options.authService, options.config);
      return options.mediaEditService.cancelPending({
        actor: actorFrom(session),
        mediaId: request.params.id,
        revisionId: request.params.revisionId,
        requestId: request.id,
      });
    },
  );

  typed.post(
    "/api/v1/media/:id/edits/revert",
    {
      schema: {
        operationId: "revertMediaEditRevision",
        tags: ["media-edit"],
        params: mediaParamsSchema,
        body: revertMediaEditRequestSchema,
        response: { 200: mediaEditContextViewSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      void reply.header("cache-control", "no-store");
      const session = await requireInternalCsrf(request, options.authService, options.config);
      return options.mediaEditService.revert({
        actor: actorFrom(session),
        mediaId: request.params.id,
        input: request.body,
        requestId: request.id,
      });
    },
  );
}
