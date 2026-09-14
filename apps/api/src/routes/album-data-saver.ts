import { apiErrorSchema } from "@photostream/contracts";
import {
  dataSaverSettingViewSchema,
  updateDataSaverSettingRequestSchema,
} from "@photostream/contracts/bandwidth";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { requireInternalCsrf, requireInternalSession } from "../auth/http.js";
import type { AuthService } from "../auth/service.js";
import type { AppConfig } from "../config.js";
import type { AlbumDataSaverService } from "../media/album-data-saver-service.js";

const idParamsSchema = z.object({ id: z.string().uuid() }).strict();
const slugParamsSchema = z.object({ slug: z.string().min(12).max(32) }).strict();

function actorFrom(session: Awaited<ReturnType<typeof requireInternalSession>>) {
  return { id: session.record.user.id, role: session.record.user.role };
}

export async function registerAlbumDataSaverRoutes(
  app: FastifyInstance,
  options: {
    readonly authService: AuthService;
    readonly dataSaverService: AlbumDataSaverService;
    readonly config: AppConfig;
  },
): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const errors = {
    400: apiErrorSchema,
    401: apiErrorSchema,
    403: apiErrorSchema,
    404: apiErrorSchema,
    500: apiErrorSchema,
  };

  typed.get(
    "/api/v1/albums/:id/data-saver",
    {
      schema: {
        operationId: "getAlbumDataSaverSetting",
        tags: ["albums"],
        params: idParamsSchema,
        response: { 200: dataSaverSettingViewSchema, ...errors },
      },
    },
    async (request) => {
      const session = await requireInternalSession(request, options.authService, options.config);
      return options.dataSaverService.getForAlbum(actorFrom(session), request.params.id);
    },
  );

  typed.patch(
    "/api/v1/albums/:id/data-saver",
    {
      schema: {
        operationId: "updateAlbumDataSaverSetting",
        tags: ["albums"],
        params: idParamsSchema,
        body: updateDataSaverSettingRequestSchema,
        response: { 200: dataSaverSettingViewSchema, ...errors },
      },
    },
    async (request) => {
      const session = await requireInternalCsrf(request, options.authService, options.config);
      return options.dataSaverService.update({
        actor: actorFrom(session),
        albumId: request.params.id,
        enabled: request.body.enabled,
        requestId: request.id,
      });
    },
  );

  typed.get(
    "/api/v1/public/albums/:slug/data-saver",
    {
      schema: {
        operationId: "getPublicAlbumDataSaverSetting",
        tags: ["public", "albums"],
        params: slugParamsSchema,
        response: { 200: dataSaverSettingViewSchema, ...errors },
      },
    },
    async (request, reply) => {
      void reply.header("cache-control", "no-store");
      return options.dataSaverService.getForSlug(request.params.slug);
    },
  );
}
