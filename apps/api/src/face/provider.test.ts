import { describe, expect, it } from "vitest";

import { loadConfig } from "../config.js";
import { AliyunFaceProvider, classifyDetectedFaces, selectQualifiedCluster } from "./provider.js";

describe("Aliyun face provider allowlist mapping", () => {
  it("classifies only count, quality, sharpness, and boundary size", () => {
    const supplierFaceWithExtraAttributes = {
      faceQuality: 0.95,
      sharpness: 0.9,
      boundary: { width: 300, height: 260 },
      age: 12,
      gender: "female",
      emotion: "happy",
    };
    expect(classifyDetectedFaces([], { quality: 0.8, sharpness: 0.6, faceEdge: 120 })).toBe(
      "no_face",
    );
    expect(
      classifyDetectedFaces(
        [supplierFaceWithExtraAttributes],
        { quality: 0.8, sharpness: 0.6, faceEdge: 120 },
      ),
    ).toBe("ok");
    expect(
      classifyDetectedFaces(
        [{ faceQuality: 0.95, sharpness: 0.9, boundary: { width: 80, height: 260 } }],
        { quality: 0.8, sharpness: 0.6, faceEdge: 120 },
      ),
    ).toBe("quality_low");
    expect(
      classifyDetectedFaces(
        [
          { faceQuality: 1, sharpness: 1, boundary: { width: 200, height: 200 } },
          { faceQuality: 1, sharpness: 1, boundary: { width: 200, height: 200 } },
        ],
        { quality: 0.8, sharpness: 0.6, faceEdge: 120 },
      ),
    ).toBe("multiple_faces");
  });

  it("selects only the strongest cluster above the fixed threshold", () => {
    expect(
      selectQualifiedCluster(
        [
          { clusterId: "below", similarity: 0.91 },
          { clusterId: "qualified", similarity: 0.95 },
          { clusterId: "strongest", similarity: 0.97 },
        ],
        0.92,
      ),
    ).toBe("strongest");
    expect(selectQualifiedCluster([{ clusterId: "below", similarity: 0.5 }], 0.92)).toBeNull();
  });

  it("constructs both generated SDK layers without making a cloud request", () => {
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
      FACE_SEARCH_GLOBAL_ENABLED: "true",
      FACE_SEARCH_THRESHOLD_VERSION: "qualified-v1",
      ALIYUN_FACE_ACCESS_KEY_ID: "test-id",
      ALIYUN_FACE_ACCESS_KEY_SECRET: "test-secret",
      ALIYUN_ACCOUNT_ID: "1",
      ALIYUN_IMM_PROJECT_NAME: "test-project",
      ALIYUN_OSS_MEDIA_BUCKET: "media-private",
      ALIYUN_OSS_FACE_REFERENCE_BUCKET: "face-private",
    });
    expect(() => new AliyunFaceProvider(config)).not.toThrow();
  });
});
