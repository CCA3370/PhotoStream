import type { FastifyReply, FastifyRequest } from "fastify";

import { createSessionToken } from "../auth/crypto.js";
import type { AppConfig } from "../config.js";

export function visitorSessionCookieName(config: AppConfig, slug: string): string {
  const prefix = config.NODE_ENV === "production" ? "__Host-" : "";
  return `${prefix}photostream_album_${slug}`;
}

export function visitorSessionToken(
  request: FastifyRequest,
  config: AppConfig,
  slug: string,
): string | undefined {
  return request.cookies[visitorSessionCookieName(config, slug)];
}

function anonymousCookieName(config: AppConfig): string {
  return config.NODE_ENV === "production" ? "__Host-photostream_visitor" : "photostream_visitor";
}

function likeSessionCookieName(config: AppConfig): string {
  return config.NODE_ENV === "production"
    ? "__Host-photostream_like_session"
    : "photostream_like_session";
}

function validVisitorId(value: string | undefined): value is string {
  return value !== undefined && /^[A-Za-z0-9_-]{32,128}$/u.test(value);
}

export function likeVisitorId(
  request: FastifyRequest,
  reply: FastifyReply,
  config: AppConfig,
): string {
  const name = likeSessionCookieName(config);
  const existing = request.cookies[name];
  if (validVisitorId(existing)) return existing;

  const created = createSessionToken();
  reply.setCookie(name, created, {
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
  return created;
}

export function anonymousVisitorId(
  request: FastifyRequest,
  reply: FastifyReply,
  config: AppConfig,
  now = new Date(),
): string {
  const name = anonymousCookieName(config);
  const existing = request.cookies[name];
  if (validVisitorId(existing)) return existing;
  const created = createSessionToken();
  const expires = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  reply.setCookie(name, created, {
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
  return created;
}
