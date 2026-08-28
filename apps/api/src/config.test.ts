import { describe, expect, it } from "vitest";

import { ConfigurationError, loadConfig, trustedHosts } from "./config.js";

const validEnvironment = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: "3001",
  APP_ORIGIN: "http://localhost:3000",
  MEDIA_BASE_URL: "https://cdn.cloverta.top",
  DATABASE_URL: "postgresql://user:password@localhost:5432/photostream",
  SESSION_SECRET_CURRENT: "s".repeat(32),
  CSRF_SECRET: "c".repeat(32),
  CURSOR_SIGNING_SECRET: "u".repeat(32),
  VISITOR_SESSION_SECRET: "v".repeat(32),
  ALBUM_PASSWORD_GENERATION_SECRET: "a".repeat(32),
  LOCAL_OBJECT_SECRET: "o".repeat(32),
  LOCAL_OBJECT_BASE_URL: "http://127.0.0.1:3002",
  LOG_LEVEL: "info",
} satisfies NodeJS.ProcessEnv;

describe("configuration", () => {
  it("fails fast with field names but without secret values", () => {
    const invalid = { ...validEnvironment, CSRF_SECRET: "exposed-short-value" };

    expect(() => loadConfig(invalid)).toThrow(ConfigurationError);
    try {
      loadConfig(invalid);
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as Error).message).toContain("CSRF_SECRET");
      expect((error as Error).message).not.toContain("exposed-short-value");
    }
  });

  it("derives only expected development hosts", () => {
    const config = loadConfig(validEnvironment);
    expect(trustedHosts(config)).toEqual(
      new Set(["localhost:3000", "localhost:3001", "127.0.0.1:3001"]),
    );
  });
});
