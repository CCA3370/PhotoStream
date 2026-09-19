import { describe, expect, it } from "vitest";

import { internalImageKey, internalImageSourceIdentity } from "./internal-media-url";

describe("internal media URL identity", () => {
  it("ignores only the rotating CDN authorization token", () => {
    expect(
      internalImageKey(
        "https://cdn.example.test/photo.webp?x-oss-process=image%2Fresize%2Cw_1920&auth_key=old#fragment",
      ),
    ).toBe("https://cdn.example.test/photo.webp?x-oss-process=image%2Fresize%2Cw_1920");
    expect(
      internalImageSourceIdentity(
        "https://cdn.example.test/photo.webp?x-oss-process=image%2Fresize%2Cw_1920&auth_key=new",
      ),
    ).toBe("https://cdn.example.test/photo.webp?x-oss-process=image%2Fresize%2Cw_1920");
  });

  it("keeps local object URLs exact", () => {
    const source = "blob:https://photos.example.test/11111111-1111-4111-8111-111111111111";
    expect(internalImageSourceIdentity(source)).toBe(source);
    expect(internalImageSourceIdentity(null)).toBeNull();
  });

  it("keeps functional query changes distinct", () => {
    expect(
      internalImageKey("https://cdn.example.test/photo.webp?width=960&auth_key=one"),
    ).not.toBe(internalImageKey("https://cdn.example.test/photo.webp?width=1920&auth_key=two"));
  });
});
