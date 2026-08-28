import type { FastifyReply, FastifyRequest } from "fastify";

import type { AppConfig } from "../config.js";
import type { AuthenticatedSession, AuthService, IssuedSession } from "./service.js";

export function internalSessionCookieName(config: AppConfig): string {
  return config.NODE_ENV === "production" ? "__Host-photostream_session" : "photostream_session";
}

export function internalSessionToken(
  request: FastifyRequest,
  config: AppConfig,
): string | undefined {
  return request.cookies[internalSessionCookieName(config)];
}

export function setInternalSessionCookie(
  reply: FastifyReply,
  issued: IssuedSession,
  config: AppConfig,
): void {
  reply.setCookie(internalSessionCookieName(config), issued.rawToken, {
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: issued.absoluteExpiresAt,
  });
}

export function clearInternalSessionCookie(reply: FastifyReply, config: AppConfig): void {
  reply.clearCookie(internalSessionCookieName(config), { path: "/" });
}

export async function requireInternalSession(
  request: FastifyRequest,
  authService: AuthService,
  config: AppConfig,
): Promise<AuthenticatedSession> {
  return authService.authenticate(internalSessionToken(request, config));
}

export async function requireInternalCsrf(
  request: FastifyRequest,
  authService: AuthService,
  config: AppConfig,
): Promise<AuthenticatedSession> {
  const session = await requireInternalSession(request, authService, config);
  const csrfHeader = request.headers["x-csrf-token"];
  authService.verifyCsrf(session.rawToken, typeof csrfHeader === "string" ? csrfHeader : undefined);
  return session;
}
