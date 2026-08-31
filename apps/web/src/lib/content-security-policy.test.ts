import { describe, expect, it } from "vitest";

import { contentSecurityPolicy } from "./content-security-policy";

describe("contentSecurityPolicy", () => {
  it("uses a nonce for scripts and denies executable media surfaces in production", () => {
    const policy = contentSecurityPolicy({
      nonce: "c3RyaWN0LWNzcC1ub25jZQ==",
      mediaBaseUrl: "https://cdn.cloverta.top/media/ignored",
      uploadBaseUrl: "https://school-media.oss-cn-hangzhou.aliyuncs.com/path",
      nodeEnvironment: "production",
    });

    expect(policy).toContain("script-src 'self' 'nonce-c3RyaWN0LWNzcC1ub25jZQ==' 'strict-dynamic'");
    expect(policy.match(/script-src [^;]+/u)?.[0]).not.toContain("'unsafe-inline'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).toContain("img-src 'self' data: blob: https://cdn.cloverta.top");
    expect(policy).toContain(
      "connect-src 'self' https://cdn.cloverta.top https://school-media.oss-cn-hangzhou.aliyuncs.com",
    );
    expect(policy).toContain("media-src 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("upgrade-insecure-requests");
  });

  it("allows only the exact local data plane and HMR sockets in development", () => {
    const policy = contentSecurityPolicy({
      nonce: "c3RyaWN0LWRldi1ub25jZQ==",
      mediaBaseUrl: "http://127.0.0.1:3002/objects",
      nodeEnvironment: "development",
    });

    expect(policy).toContain("img-src 'self' data: blob: http://127.0.0.1:3002");
    expect(policy).toContain("connect-src 'self' http://127.0.0.1:3002");
    expect(policy).toContain("'unsafe-eval'");
    expect(policy).not.toContain("upgrade-insecure-requests");
  });

  it("fails closed for invalid nonces and insecure production media origins", () => {
    expect(() =>
      contentSecurityPolicy({
        nonce: "short",
        nodeEnvironment: "production",
      }),
    ).toThrow("CSP nonce is invalid");
    expect(() =>
      contentSecurityPolicy({
        nonce: "c3RyaWN0LWNzcC1ub25jZQ==",
        mediaBaseUrl: "http://cdn.cloverta.top",
        nodeEnvironment: "production",
      }),
    ).toThrow("MEDIA_BASE_URL must use HTTPS outside development");
    expect(() =>
      contentSecurityPolicy({
        nonce: "c3RyaWN0LWNzcC1ub25jZQ==",
        uploadBaseUrl: "http://school-media.oss-cn-hangzhou.aliyuncs.com",
        nodeEnvironment: "production",
      }),
    ).toThrow("PHOTO_UPLOAD_BASE_URL must use HTTPS outside development");
  });
});
