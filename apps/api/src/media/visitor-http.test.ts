import type { FastifyReply, FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { loadConfig } from "../config.js";
import { anonymousVisitorId } from "./visitor-http.js";

const config = loadConfig({
  NODE_ENV: "test",
  APP_ORIGIN: "http://localhost:3000",
  MEDIA_BASE_URL: "http://127.0.0.1:3002",
  DATABASE_URL: "postgresql://user:password@localhost:5432/photostream",
  SESSION_SECRET_CURRENT: "s".repeat(32),
  CSRF_SECRET: "c".repeat(32),
  CURSOR_SIGNING_SECRET: "u".repeat(32),
  VISITOR_SESSION_SECRET: "v".repeat(32),
  ALBUM_PASSWORD_GENERATION_SECRET: "a".repeat(32),
  USER_PASSWORD_GENERATION_SECRET: "w".repeat(32),
  ANALYTICS_HMAC_SECRET: "n".repeat(32),
  LOCAL_OBJECT_SECRET: "o".repeat(32),
});

describe("anonymousVisitorId", () => {
  it("expires the anonymous identifier at the next UTC day boundary", () => {
    const setCookie = vi.fn();
    const request = { cookies: {} } as FastifyRequest;
    const reply = { setCookie } as unknown as FastifyReply;
    const visitorId = anonymousVisitorId(
      request,
      reply,
      config,
      new Date("2026-08-29T15:30:00.000Z"),
    );

    expect(visitorId).toMatch(/^[A-Za-z0-9_-]{32,128}$/u);
    expect(setCookie).toHaveBeenCalledWith(
      "photostream_visitor",
      visitorId,
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        expires: new Date("2026-08-30T00:00:00.000Z"),
      }),
    );
    expect(setCookie.mock.calls[0]?.[2]).not.toHaveProperty("maxAge");
  });
});
