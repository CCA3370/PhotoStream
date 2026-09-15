import { apiErrorSchema, okResponseSchema, signedUploadSchema } from "@photostream/contracts";
import { microPreviewUploadRequestSchema } from "@photostream/contracts/micro-preview";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { requireInternalCsrf } from "../auth/http.js";
import type { AuthService } from "../auth/service.js";
import type { AppConfig } from "../config.js";
import type { MicroPreviewService } from "../media/micro-preview-service.js";
import { visitorSessionToken } from "../media/visitor-http.js";

const mediaParamsSchema = z.object({ id: z.string().uuid() }).strict();
const publicParamsSchema = z
  .object({
    slug: z.string().min(12).max(32),
    mediaId: z.string().uuid(),
  })
  .strict();
const publicQuerySchema = z.object({ share: z.string().uuid().optional() }).strict();

function actorFrom(session: Awaited<ReturnType<typeof requireInternalCsrf>>) {
  return { id: session.record.user.id, role: session.record.user.role };
}

export async function registerMicroPreviewRoutes(
  app: FastifyInstance,
  options: {
    readonly authService: AuthService;
    readonly microPreviewService: MicroPreviewService;
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

  typed.post(
    "/api/v1/media/:id/micro-preview/sign",
    {
      schema: {
        operationId: "signMicroPreviewUpload",
        tags: ["uploads"],
        params: mediaParamsSchema,
        body: microPreviewUploadRequestSchema,
        response: { 200: signedUploadSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      void reply.header("cache-control", "no-store");
      const session = await requireInternalCsrf(request, options.authService, options.config);
      return options.microPreviewService.signUpload({
        actor: actorFrom(session),
        mediaId: request.params.id,
        input: request.body,
      });
    },
  );

  typed.post(
    "/api/v1/media/:id/micro-preview/complete",
    {
      schema: {
        operationId: "completeMicroPreviewUpload",
        tags: ["uploads"],
        params: mediaParamsSchema,
        response: { 200: okResponseSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      void reply.header("cache-control", "no-store");
      const session = await requireInternalCsrf(request, options.authService, options.config);
      return options.microPreviewService.completeUpload({
        actor: actorFrom(session),
        mediaId: request.params.id,
      });
    },
  );

  typed.get(
    "/api/v1/public/albums/:slug/media/:mediaId/micro-preview",
    {
      config: { rateLimit: { max: 300, timeWindow: "1 minute" } },
      schema: {
        operationId: "readPublicMicroPreview",
        tags: ["public"],
        params: publicParamsSchema,
        querystring: publicQuerySchema,
      },
    },
    async (request, reply) => {
      const url = await options.microPreviewService.publicUrl({
        ...request.params,
        visitorToken: visitorSessionToken(request, options.config, request.params.slug),
        ...(request.query.share === undefined ? {} : { shareId: request.query.share }),
      });
      return reply
        .status(302)
        .header("cache-control", "private, max-age=60")
        .header("location", url)
        .send();
    },
  );
}
