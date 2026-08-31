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
  USER_PASSWORD_GENERATION_SECRET: "w".repeat(32),
  ANALYTICS_HMAC_SECRET: "n".repeat(32),
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

  it("requires bib encryption and search keys as one independent pair", () => {
    expect(() =>
      loadConfig({
        ...validEnvironment,
        BIB_DATA_KEY: Buffer.alloc(32, 1).toString("base64url"),
      }),
    ).toThrowError(expect.objectContaining({ fields: ["BIB_SEARCH_KEY"] }));
    expect(
      loadConfig({
        ...validEnvironment,
        BIB_DATA_KEY: Buffer.alloc(32, 1).toString("base64url"),
        BIB_SEARCH_KEY: "b".repeat(32),
      }),
    ).toMatchObject({ BIB_KEY_VERSION: "v1", BIB_OCR_AUTOMATION_STATUS: "experimental" });
    expect(() =>
      loadConfig({ ...validEnvironment, BIB_OCR_AUTOMATION_STATUS: "unverified" }),
    ).toThrowError(expect.objectContaining({ fields: ["BIB_OCR_AUTOMATION_STATUS"] }));
  });

  it("requires a complete, distinct previous bib key set during rotation", () => {
    const current = {
      ...validEnvironment,
      BIB_DATA_KEY: Buffer.alloc(32, 1).toString("base64url"),
      BIB_SEARCH_KEY: "b".repeat(32),
      BIB_KEY_VERSION: "v2",
    };
    expect(() =>
      loadConfig({
        ...current,
        BIB_DATA_KEY_PREVIOUS: Buffer.alloc(32, 2).toString("base64url"),
      }),
    ).toThrowError(expect.objectContaining({ fields: ["BIB_SEARCH_KEY_PREVIOUS"] }));
    expect(() =>
      loadConfig({
        ...current,
        BIB_DATA_KEY_PREVIOUS: Buffer.alloc(32, 2).toString("base64url"),
        BIB_SEARCH_KEY_PREVIOUS: "p".repeat(32),
        BIB_KEY_VERSION_PREVIOUS: "v2",
      }),
    ).toThrowError(expect.objectContaining({ fields: ["BIB_KEY_VERSION_PREVIOUS"] }));
    expect(
      loadConfig({
        ...current,
        BIB_DATA_KEY_PREVIOUS: Buffer.alloc(32, 2).toString("base64url"),
        BIB_SEARCH_KEY_PREVIOUS: "p".repeat(32),
        BIB_KEY_VERSION_PREVIOUS: "v1",
      }),
    ).toMatchObject({ BIB_KEY_VERSION: "v2", BIB_KEY_VERSION_PREVIOUS: "v1" });
  });
});
