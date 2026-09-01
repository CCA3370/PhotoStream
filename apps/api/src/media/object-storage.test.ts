import { describe, expect, it } from "vitest";

import { signAliyunCdnUrl } from "./object-storage.js";

describe("Aliyun CDN Type A signing", () => {
  it("matches the documented Type A signature example", () => {
    expect(
      signAliyunCdnUrl({
        authKey: "aliyuncdnexp1234",
        authValiditySeconds: 7_200,
        baseUrl: "https://domain.example.com",
        expiresAt: new Date((1_444_435_200 + 7_200) * 1_000),
        key: "video/standard/test.mp4",
        nonce: "0",
      }),
    ).toBe(
      "https://domain.example.com/video/standard/test.mp4?auth_key=1444435200-0-0-23bf85053008f5c0e791667a313e28ce",
    );
  });

  it("encodes every object-key segment without changing the CDN origin", () => {
    const signed = new URL(
      signAliyunCdnUrl({
        authKey: "a".repeat(32),
        authValiditySeconds: 7_200,
        baseUrl: "https://cdn.example.com/ignored?stale=true",
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
        key: "albums/中文 photo.webp",
        nonce: "abc123",
      }),
    );

    expect(signed.origin).toBe("https://cdn.example.com");
    expect(signed.pathname).toBe("/albums/%E4%B8%AD%E6%96%87%20photo.webp");
    expect([...signed.searchParams.keys()]).toEqual(["auth_key"]);
  });

  it("rejects insecure origins and ambiguous object paths", () => {
    const common = {
      authKey: "a".repeat(32),
      authValiditySeconds: 7_200,
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      nonce: "abc123",
    } as const;

    expect(() =>
      signAliyunCdnUrl({ ...common, baseUrl: "http://cdn.example.com", key: "safe/file.webp" }),
    ).toThrow("HTTPS");
    expect(() =>
      signAliyunCdnUrl({ ...common, baseUrl: "https://cdn.example.com", key: "../file.webp" }),
    ).toThrow("Invalid object key");
  });
});
