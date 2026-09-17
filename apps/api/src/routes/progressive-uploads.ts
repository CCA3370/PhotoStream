import { apiErrorSchema, uploadIntentViewSchema } from "@photostream/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { requireInternalCsrf, type requireInternalSession } from "../auth/http.js";
import type { AuthService } from "../auth/service.js";
import type { AppConfig } from "../config.js";
import type {
  ProgressiveDerivedVariantInput,
  ProgressiveUploadInput,
  ProgressiveUploadService,
} from "../media/progressive-upload-service.js";
import type { PhotoService } from "../media/service.js";

const commonErrors = {
  400: apiErrorSchema,
  401: apiErrorSchema,
  403: apiErrorSchema,
  404: apiErrorSchema,
  409: apiErrorSchema,
  429: apiErrorSchema,
  500: apiErrorSchema,
};

const progressiveUploadSchema = z
  .object({
    albumId: z.string().uuid(),
    categoryId: z.string().uuid().nullable().default(null),
    width: z.number().int().min(1).max(100_000),
    height: z.number().int().min(1).max(100_000),
    totalBytes: z
      .number()
      .int()
      .min(1)
      .max(50 * 1024 * 1024),
    capturedAt: z.string().datetime().nullable().default(null),
    original: z
      .object({
        format: z.enum(["jpeg", "png", "webp"]),
        contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
        bytes: z
          .number()
          .int()
          .min(1)
          .max(50 * 1024 * 1024),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.width * value.height > 100_000_000) {
      context.addIssue({ code: "custom", message: "照片总像素不能超过 100MP", path: ["width"] });
    }
    if (value.original.bytes !== value.totalBytes) {
      context.addIssue({
        code: "custom",
        message: "原图字节数必须与照片声明一致",
        path: ["original", "bytes"],
      });
    }
    const expectedType =
      value.original.format === "jpeg" ? "image/jpeg" : `image/${value.original.format}`;
    if (value.original.contentType !== expectedType) {
      context.addIssue({
        code: "custom",
        message: "原图格式与 Content-Type 不一致",
        path: ["original", "contentType"],
      });
    }
  });

const progressiveVariantSchema = z
  .object({
    kind: z.enum(["photo_480", "photo_960", "photo_1920"]),
    format: z.enum(["webp", "jpeg"]),
    contentType: z.enum(["image/webp", "image/jpeg"]),
    width: z.number().int().min(1).max(1_920),
    height: z.number().int().min(1).max(1_920),
    bytes: z
      .number()
      .int()
      .min(1)
      .max(50 * 1024 * 1024),
  })
  .strict();

const intentParamsSchema = z.object({ id: z.string().uuid() }).strict();

function idempotencyKey(request: FastifyRequest): string | undefined {
  const value = request.headers["idempotency-key"];
  return typeof value === "string" ? value : undefined;
}

function actorFrom(session: Awaited<ReturnType<typeof requireInternalSession>>) {
  return { id: session.record.user.id, role: session.record.user.role };
}

export async function registerProgressiveUploadRoutes(
  app: FastifyInstance,
  options: {
    readonly authService: AuthService;
    readonly config: AppConfig;
    readonly photoService: PhotoService;
    readonly progressiveUploadService: ProgressiveUploadService;
  },
): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post(
    "/api/v1/uploads/progressive",
    {
      schema: {
        operationId: "createProgressivePhotoUpload",
        tags: ["uploads"],
        body: progressiveUploadSchema,
        response: { 201: uploadIntentViewSchema, 200: uploadIntentViewSchema, ...commonErrors },
      },
    },
    async (request, reply) => {
      const session = await requireInternalCsrf(request, options.authService, options.config);
      const actor = actorFrom(session);
      const intentId = await options.progressiveUploadService.createUpload({
        actor,
        input: request.body as ProgressiveUploadInput,
        idempotencyKey: idempotencyKey(request),
      });
      const intent = await options.photoService.getUploadIntent(actor, intentId);
      return reply.status(201).send(intent);
    },
  );

  typed.post(
    "/api/v1/uploads/:id/variants",
    {
      schema: {
        operationId: "registerProgressivePhotoVariant",
        tags: ["uploads"],
        params: intentParamsSchema,
        body: progressiveVariantSchema,
        response: { 200: uploadIntentViewSchema, ...commonErrors },
      },
    },
    async (request) => {
      const session = await requireInternalCsrf(request, options.authService, options.config);
      const actor = actorFrom(session);
      await options.progressiveUploadService.registerDerivedVariant({
        actor,
        intentId: request.params.id,
        variant: request.body as ProgressiveDerivedVariantInput,
      });
      return options.photoService.getUploadIntent(actor, request.params.id);
    },
  );
}
