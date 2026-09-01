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

  it("requires the Aliyun OSS/CDN data plane in production", () => {
    expect(() =>
      loadConfig({
        ...validEnvironment,
        NODE_ENV: "production",
        APP_ORIGIN: "https://photos.test",
      }),
    ).toThrowError(expect.objectContaining({ fields: ["OBJECT_STORAGE_DRIVER"] }));

    expect(
      loadConfig({
        ...validEnvironment,
        NODE_ENV: "production",
        APP_ORIGIN: "https://photos.test",
        OBJECT_STORAGE_DRIVER: "aliyun",
        LOCAL_OBJECT_SECRET: "",
        ALIYUN_ACCESS_KEY_ID: "deployment-access-key",
        ALIYUN_ACCESS_KEY_SECRET: "deployment-access-secret",
        ALIYUN_OSS_MEDIA_BUCKET: "photostream-private-media",
        ALIYUN_CDN_AUTH_KEY_CURRENT: "c".repeat(32),
      }),
    ).toMatchObject({
      NODE_ENV: "production",
      OBJECT_STORAGE_DRIVER: "aliyun",
      LOCAL_OBJECT_SECRET: undefined,
    });
  });

  it("keeps face search off by default and requires isolated qualified cloud resources", () => {
    expect(loadConfig(validEnvironment)).toMatchObject({
      FACE_SEARCH_GLOBAL_ENABLED: false,
      FACE_SEARCH_THRESHOLD_VERSION: "unqualified",
    });
    expect(() =>
      loadConfig({ ...validEnvironment, FACE_SEARCH_GLOBAL_ENABLED: "true" }),
    ).toThrowError(
      expect.objectContaining({
        fields: expect.arrayContaining([
          "ALIYUN_FACE_ACCESS_KEY_ID",
          "ALIYUN_OSS_FACE_REFERENCE_BUCKET",
          "FACE_SEARCH_THRESHOLD_VERSION",
        ]),
      }),
    );
    expect(
      loadConfig({
        ...validEnvironment,
        FACE_SEARCH_GLOBAL_ENABLED: "true",
        FACE_SEARCH_THRESHOLD_VERSION: "face-threshold-2026-09",
        ALIYUN_FACE_ACCESS_KEY_ID: "test-access-key",
        ALIYUN_FACE_ACCESS_KEY_SECRET: "test-access-secret",
        ALIYUN_ACCOUNT_ID: "123456789",
        ALIYUN_IMM_PROJECT_NAME: "face-test-project",
        ALIYUN_OSS_MEDIA_BUCKET: "media-private-bucket",
        ALIYUN_OSS_FACE_REFERENCE_BUCKET: "face-reference-private-bucket",
      }),
    ).toMatchObject({ FACE_SEARCH_GLOBAL_ENABLED: true });
    expect(() =>
      loadConfig({
        ...validEnvironment,
        FACE_SEARCH_GLOBAL_ENABLED: "true",
        FACE_SEARCH_THRESHOLD_VERSION: "face-threshold-2026-09",
        ALIYUN_FACE_ACCESS_KEY_ID: "test-access-key",
        ALIYUN_FACE_ACCESS_KEY_SECRET: "test-access-secret",
        ALIYUN_ACCOUNT_ID: "123456789",
        ALIYUN_IMM_PROJECT_NAME: "face-test-project",
        ALIYUN_OSS_MEDIA_BUCKET: "shared-bucket",
        ALIYUN_OSS_FACE_REFERENCE_BUCKET: "shared-bucket",
      }),
    ).toThrowError(expect.objectContaining({ fields: ["ALIYUN_OSS_FACE_REFERENCE_BUCKET"] }));
  });
});
