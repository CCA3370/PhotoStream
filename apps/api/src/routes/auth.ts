import {
  apiErrorSchema,
  authSessionSchema,
  changePasswordRequestSchema,
  loginRequestSchema,
  okResponseSchema,
} from "@photostream/contracts";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  clearInternalSessionCookie,
  requireInternalCsrf,
  requireInternalSession,
  setInternalSessionCookie,
} from "../auth/http.js";
import type { AuthService } from "../auth/service.js";
import type { AppConfig } from "../config.js";

function noStore(reply: FastifyReply): void {
  void reply.header("cache-control", "no-store");
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  options: { readonly authService: AuthService; readonly config: AppConfig },
): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const errorResponses = {
    400: apiErrorSchema,
    401: apiErrorSchema,
    403: apiErrorSchema,
    429: apiErrorSchema,
    500: apiErrorSchema,
  };

  typed.post(
    "/api/v1/auth/login",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      schema: {
        operationId: "login",
        tags: ["auth"],
        body: loginRequestSchema,
        response: { 200: authSessionSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      noStore(reply);
      const issued = await options.authService.login(request.body);
      setInternalSessionCookie(reply, issued, options.config);
      return issued.view;
    },
  );

  typed.get(
    "/api/v1/auth/session",
    {
      schema: {
        operationId: "getSession",
        tags: ["auth"],
        response: { 200: authSessionSchema, 401: apiErrorSchema, 403: apiErrorSchema },
      },
    },
    async (request, reply) => {
      noStore(reply);
      return (await requireInternalSession(request, options.authService, options.config)).view;
    },
  );

  typed.post(
    "/api/v1/auth/change-password",
    {
      schema: {
        operationId: "changePassword",
        tags: ["auth"],
        body: changePasswordRequestSchema,
        response: { 200: authSessionSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      noStore(reply);
      const session = await requireInternalCsrf(request, options.authService, options.config);
      const issued = await options.authService.changePassword({
        session,
        currentPassword: request.body.currentPassword,
        newPassword: request.body.newPassword,
        requestId: request.id,
      });
      setInternalSessionCookie(reply, issued, options.config);
      return issued.view;
    },
  );

  typed.post(
    "/api/v1/auth/logout",
    {
      schema: {
        operationId: "logout",
        tags: ["auth"],
        response: { 200: okResponseSchema, 401: apiErrorSchema, 403: apiErrorSchema },
      },
    },
    async (request, reply) => {
      noStore(reply);
      const session = await requireInternalCsrf(request, options.authService, options.config);
      await options.authService.logout(session);
      clearInternalSessionCookie(reply, options.config);
      return { ok: true as const };
    },
  );
}
