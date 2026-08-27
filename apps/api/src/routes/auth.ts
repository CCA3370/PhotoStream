import {
  apiErrorSchema,
  authSessionSchema,
  changePasswordRequestSchema,
  loginRequestSchema,
  okResponseSchema,
} from "@photostream/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { AuthenticatedSession, AuthService, IssuedSession } from "../auth/service.js";
import type { AppConfig } from "../config.js";

function cookieName(config: AppConfig): string {
  return config.NODE_ENV === "production" ? "__Host-photostream_session" : "photostream_session";
}

function sessionToken(request: FastifyRequest, config: AppConfig): string | undefined {
  return request.cookies[cookieName(config)];
}

function setSessionCookie(reply: FastifyReply, issued: IssuedSession, config: AppConfig): void {
  reply.setCookie(cookieName(config), issued.rawToken, {
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: issued.absoluteExpiresAt,
  });
}

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

  async function requireSession(request: FastifyRequest): Promise<AuthenticatedSession> {
    return options.authService.authenticate(sessionToken(request, options.config));
  }

  async function requireCsrf(request: FastifyRequest): Promise<AuthenticatedSession> {
    const session = await requireSession(request);
    const csrfHeader = request.headers["x-csrf-token"];
    options.authService.verifyCsrf(
      session.rawToken,
      typeof csrfHeader === "string" ? csrfHeader : undefined,
    );
    return session;
  }

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
      setSessionCookie(reply, issued, options.config);
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
      return (await requireSession(request)).view;
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
      const session = await requireCsrf(request);
      const issued = await options.authService.changePassword({
        session,
        currentPassword: request.body.currentPassword,
        newPassword: request.body.newPassword,
        requestId: request.id,
      });
      setSessionCookie(reply, issued, options.config);
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
      const session = await requireCsrf(request);
      await options.authService.logout(session);
      reply.clearCookie(cookieName(options.config), { path: "/" });
      return { ok: true as const };
    },
  );
}
