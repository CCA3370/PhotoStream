import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import { loadConfig } from "../config.js";
import { assertRequestOrigin } from "./security.js";

const config = loadConfig({
  NODE_ENV: "test",
  APP_ORIGIN: "https://example.test",
  MEDIA_BASE_URL: "https://media.example.test",
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

function request(url: string, origin?: string): FastifyRequest {
  return {
    method: "POST",
    url,
    headers: { host: "example.test", ...(origin === undefined ? {} : { origin }) },
  } as FastifyRequest;
}

describe("request origin boundary", () => {
  it("permits only the exact signed EventBridge callback without an Origin header", () => {
    expect(() =>
      assertRequestOrigin(request("/api/v1/integrations/aliyun/eventbridge"), config),
    ).not.toThrow();
    expect(() =>
      assertRequestOrigin(request("/api/v1/integrations/aliyun/eventbridge/extra"), config),
    ).toThrowError(expect.objectContaining({ code: "AUTH_ORIGIN_INVALID" }));
    expect(() =>
      assertRequestOrigin(request("/api/v1/albums", config.APP_ORIGIN), config),
    ).not.toThrow();
  });
});
