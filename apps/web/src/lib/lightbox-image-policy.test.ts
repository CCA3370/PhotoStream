import { describe, expect, it } from "vitest";

import {
  effectiveLightboxDpr,
  renderedLightboxWidth,
  selectLightboxVariantKind,
} from "./lightbox-image-policy";

describe("lightbox image policy", () => {
  it("keeps phones on 960 when the fitted image does not need 1920 pixels", () => {
    expect(
      selectLightboxVariantKind({
        mediaWidth: 6_000,
        mediaHeight: 4_000,
        viewportWidth: 393,
        viewportHeight: 852,
        devicePixelRatio: 3,
        effectiveType: "4g",
        has960: true,
        has1920: true,
      }),
    ).toBe("photo_960");
  });

  it("uses 1920 on larger high-density displays when it is materially useful", () => {
    expect(
      selectLightboxVariantKind({
        mediaWidth: 6_000,
        mediaHeight: 4_000,
        viewportWidth: 820,
        viewportHeight: 1_180,
        devicePixelRatio: 2,
        effectiveType: "4g",
        has960: true,
        has1920: true,
      }),
    ).toBe("photo_1920");
  });

  it("honors data saver and slow connections", () => {
    expect(effectiveLightboxDpr({ devicePixelRatio: 3, saveData: true, effectiveType: "4g" })).toBe(
      1,
    );
    expect(effectiveLightboxDpr({ devicePixelRatio: 3, effectiveType: "2g" })).toBe(1);
    expect(effectiveLightboxDpr({ devicePixelRatio: 3, effectiveType: "3g" })).toBe(1.5);
  });

  it("fits portrait media by viewport height instead of viewport width", () => {
    expect(
      renderedLightboxWidth({
        mediaWidth: 3_000,
        mediaHeight: 4_000,
        viewportWidth: 1_440,
        viewportHeight: 900,
      }),
    ).toBe(675);
  });

  it("falls back to whichever derivative exists and defaults to 960 before measurement", () => {
    expect(
      selectLightboxVariantKind({
        mediaWidth: 6_000,
        mediaHeight: 4_000,
        viewportWidth: 0,
        viewportHeight: 0,
        devicePixelRatio: 2,
        has960: true,
        has1920: true,
      }),
    ).toBe("photo_960");
    expect(
      selectLightboxVariantKind({
        mediaWidth: 6_000,
        mediaHeight: 4_000,
        viewportWidth: 400,
        viewportHeight: 800,
        devicePixelRatio: 2,
        has960: false,
        has1920: true,
      }),
    ).toBe("photo_1920");
  });
});
