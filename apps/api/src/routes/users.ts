import {
  adminUserViewSchema,
  apiErrorSchema,
  createUserRequestSchema,
  createUserResponseSchema,
  resetUserPasswordResponseSchema,
  updateUserRequestSchema,
} from "@photostream/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import {
  requireInternalCsrf,
  requireInternalSession,
  verifyPasswordConfirmation,
} from "../auth/http.js";
import type { AuthService } from "../auth/service.js";
import type { UserAdminService } from "../auth/user-admin-service.js";
import type { AppConfig } from "../config.js";

const userParamsSchema = z.object({ id: z.string().uuid() }).strict();

function idempotencyKey(request: FastifyRequest): string | undefined {
  const value = request.headers["idempotency-key"];
  return typeof value === "string" ? value : undefined;
}

export async function registerUserRoutes(
  app: FastifyInstance,
  options: {
    readonly authService: AuthService;
    readonly userAdminService: UserAdminService;
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
    "/api/v1/users",
    {
      schema: {
        operationId: "listUsers",
        tags: ["users"],
        response: { 200: z.array(adminUserViewSchema), ...errors },
      },
    },
    async (request) => {
      const session = await requireInternalSession(request, options.authService, options.config);
      return options.userAdminService.listUsers({ role: session.record.user.role });
    },
  );

  typed.post(
    "/api/v1/users",
    {
      schema: {
        operationId: "createUser",
        tags: ["users"],
        body: createUserRequestSchema,
        response: { 201: createUserResponseSchema, ...errors },
      },
    },
    async (request, reply) => {
      const session = await requireInternalCsrf(request, options.authService, options.config);
      const result = await options.userAdminService.createUser({
        actor: { id: session.record.user.id, role: session.record.user.role },
        input: request.body,
        idempotencyKey: idempotencyKey(request),
        requestId: request.id,
      });
      return reply.status(201).send(result);
    },
  );

  typed.patch(
    "/api/v1/users/:id",
    {
      schema: {
        operationId: "updateUser",
        tags: ["users"],
        params: userParamsSchema,
        body: updateUserRequestSchema,
        response: { 200: adminUserViewSchema, ...errors },
      },
    },
    async (request) => {
      const session = await requireInternalCsrf(request, options.authService, options.config);
      return options.userAdminService.updateUser({
        actor: { id: session.record.user.id, role: session.record.user.role },
        userId: request.params.id,
        input: request.body,
        requestId: request.id,
      });
    },
  );

  typed.post(
    "/api/v1/users/:id/reset-password",
    {
      schema: {
        operationId: "resetUserPassword",
        tags: ["users"],
        params: userParamsSchema,
        response: { 200: resetUserPasswordResponseSchema, ...errors },
      },
    },
    async (request) => {
      const session = await requireInternalCsrf(request, options.authService, options.config);
      await verifyPasswordConfirmation(request, options.authService, session);
      const generatedTemporaryPassword = await options.userAdminService.resetPassword({
        actor: {
          id: session.record.user.id,
          role: session.record.user.role,
          authenticatedAt: new Date(),
        },
        userId: request.params.id,
        idempotencyKey: idempotencyKey(request),
        requestId: request.id,
      });
      return { generatedTemporaryPassword };
    },
  );
}
