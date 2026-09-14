import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const mediaGridPath = fileURLToPath(
  new URL("../components/gallery/media-grid.tsx", import.meta.url),
);
const photoShareButtonPath = fileURLToPath(
  new URL("../components/gallery/photo-share-button.tsx", import.meta.url),
);

describe("gallery lightbox URL isolation", () => {
  it("keeps in-gallery lightbox browsing on the current address", () => {
    const source = readFileSync(mediaGridPath, "utf8");

    expect(source).not.toContain('searchParams.set("photo"');
    expect(source).not.toContain("window.location.assign");
    expect(source).toMatch(
      /window\.history\.pushState\(\s*withLightboxHistoryState\(mediaId\),\s*""\s*\)/u,
    );
    expect(source).toMatch(
      /window\.history\.replaceState\(\s*withLightboxHistoryState\(mediaId\),\s*""\s*\)/u,
    );
  });

  it("keeps photo deep links confined to the explicit share action", () => {
    const source = readFileSync(photoShareButtonPath, "utf8");

    expect(source).toContain('url.searchParams.set("photo", mediaId);');
  });
});