import { generateKeyPairSync, sign } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { loadConfig } from "../config.js";
import { EventBridgeVerifier, eventBridgeStringToSign } from "./eventbridge-verifier.js";

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
  EVENTBRIDGE_SIGNATURE_TOKEN: "t".repeat(32),
});

function headers(timestamp = Date.now()) {
  return {
    "x-eventbridge-signature-timestamp": String(timestamp),
    "x-eventbridge-hash-method": "SHA256",
    "x-eventbridge-signature-version": "1.0",
    "x-eventbridge-signature-url":
      "https://cn-beijing-eventbridge.oss-accelerate.aliyuncs.com/x509_public_certificate_test.pem",
    "x-eventbridge-signature-token": "t".repeat(32),
  };
}

describe("EventBridgeVerifier", () => {
  it("verifies the documented V2 canonical form and caches the certificate", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const certificateLoader = vi.fn(async () =>
      publicKey.export({ type: "spki", format: "pem" }).toString(),
    );
    const verifier = new EventBridgeVerifier(config, { certificateLoader });
    const body = Buffer.from('{"id":"evt-1"}', "utf8");
    const unsigned = headers();
    const canonical = Buffer.from(
      `https://example.test/api/v1/integrations/aliyun/eventbridge\n` +
        `x-eventbridge-signature-timestamp: ${unsigned["x-eventbridge-signature-timestamp"]}\n` +
        "x-eventbridge-hash-method: SHA256\n" +
        "x-eventbridge-signature-version: 1.0\n" +
        `x-eventbridge-signature-url: ${unsigned["x-eventbridge-signature-url"]}\n` +
        `x-eventbridge-signature-token: ${unsigned["x-eventbridge-signature-token"]}\n` +
        '{"id":"evt-1"}',
      "utf8",
    );
    expect(
      eventBridgeStringToSign(
        "https://example.test/api/v1/integrations/aliyun/eventbridge",
        unsigned,
        body,
      ),
    ).toEqual(canonical);
    const signature = sign("RSA-SHA256", canonical, privateKey).toString("base64");
    const signed = { ...unsigned, "x-eventbridge-signature-v2": signature };

    await verifier.verify(signed, body);
    await verifier.verify(signed, body);
    expect(certificateLoader).toHaveBeenCalledTimes(1);
  });

  it("accepts certificate paths and query parameters on the configured official host", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const certificateLoader = vi.fn(async () =>
      publicKey.export({ type: "spki", format: "pem" }).toString(),
    );
    const verifier = new EventBridgeVerifier(config, { certificateLoader });
    const body = Buffer.from('{"id":"evt-2"}', "utf8");
    const unsigned = {
      ...headers(),
      "x-eventbridge-signature-url":
        "https://cn-beijing-eventbridge.oss-accelerate.aliyuncs.com/certificates/current?version=2",
    };
    const signature = sign(
      "RSA-SHA256",
      eventBridgeStringToSign(
        "https://example.test/api/v1/integrations/aliyun/eventbridge",
        unsigned,
        body,
      ),
      privateKey,
    ).toString("base64");

    await verifier.verify({ ...unsigned, "x-eventbridge-signature-v2": signature }, body);
    expect(certificateLoader).toHaveBeenCalledTimes(1);
    expect(certificateLoader.mock.calls[0]?.[0].hostname).toBe(
      "cn-beijing-eventbridge.oss-accelerate.aliyuncs.com",
    );
  });

  it("reports timestamp, token, and certificate hostname stages without exposing secrets", async () => {
    const certificateLoader = vi.fn(async () => "unused");
    const verifier = new EventBridgeVerifier(config, { certificateLoader });
    await expect(
      verifier.verify(
        { ...headers(Date.now() - 60_001), "x-eventbridge-signature-v2": "AA==" },
        Buffer.from("{}"),
      ),
    ).rejects.toMatchObject({
      code: "FACE_EVENT_SIGNATURE_INVALID",
      stage: "timestamp",
    });
    await expect(
      verifier.verify(
        {
          ...headers(),
          "x-eventbridge-signature-token": "wrong-token-value",
          "x-eventbridge-signature-v2": "AA==",
        },
        Buffer.from("{}"),
      ),
    ).rejects.toMatchObject({
      code: "FACE_EVENT_SIGNATURE_INVALID",
      stage: "token",
    });
    await expect(
      verifier.verify(
        {
          ...headers(),
          "x-eventbridge-signature-url": "https://evil.example/x509_public_certificate_test.pem",
          "x-eventbridge-signature-v2": "AA==",
        },
        Buffer.from("{}"),
      ),
    ).rejects.toMatchObject({
      code: "FACE_EVENT_SIGNATURE_INVALID",
      stage: "certificate_url_hostname",
      context: {
        expectedCertificateHost: "cn-beijing-eventbridge.oss-accelerate.aliyuncs.com",
        actualCertificateHost: "evil.example",
      },
    });
    expect(certificateLoader).not.toHaveBeenCalled();
  });

  it("distinguishes certificate URL scheme, port, and credential failures", async () => {
    const certificateLoader = vi.fn(async () => "unused");
    const verifier = new EventBridgeVerifier(config, { certificateLoader });
    const signature = "AA==";

    await expect(
      verifier.verify(
        {
          ...headers(),
          "x-eventbridge-signature-url":
            "http://cn-beijing-eventbridge.oss-accelerate.aliyuncs.com/cert.pem",
          "x-eventbridge-signature-v2": signature,
        },
        Buffer.from("{}"),
      ),
    ).rejects.toMatchObject({ stage: "certificate_url_scheme" });

    await expect(
      verifier.verify(
        {
          ...headers(),
          "x-eventbridge-signature-url":
            "https://cn-beijing-eventbridge.oss-accelerate.aliyuncs.com:8443/cert.pem",
          "x-eventbridge-signature-v2": signature,
        },
        Buffer.from("{}"),
      ),
    ).rejects.toMatchObject({ stage: "certificate_url_port" });

    await expect(
      verifier.verify(
        {
          ...headers(),
          "x-eventbridge-signature-url":
            "https://user:pass@cn-beijing-eventbridge.oss-accelerate.aliyuncs.com/cert.pem",
          "x-eventbridge-signature-v2": signature,
        },
        Buffer.from("{}"),
      ),
    ).rejects.toMatchObject({ stage: "certificate_url_credentials" });

    expect(certificateLoader).not.toHaveBeenCalled();
  });
});
