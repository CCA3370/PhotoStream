import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const cachedImagePath = fileURLToPath(
  new URL("../components/gallery/cached-photo-image.tsx", import.meta.url),
);
const mediaGridPath = fileURLToPath(
  new URL("../components/gallery/media-grid.tsx", import.meta.url),
);

const policyPath = fileURLToPath(new URL("./grid-thumbnail-policy.ts", import.meta.url));

describe("public gallery thumbnail stability", () => {
  it("uses a wide 240px micro-preview overscan without widening the 480px upgrade margin", () => {
    const grid = readFileSync(mediaGridPath, "utf8");
    const policy = readFileSync(policyPath, "utf8");

    expect(grid).toContain("overscan: gridMicroPreviewOverscanRows");
    expect(policy).toContain("gridMicroPreviewOverscanRows = 12");
    expect(policy).toContain('gridThumbnailRootMargin = "80px 0px"');
  });

  it("does not stack native lazy loading on top of the viewport cache gate", () => {
    const source = readFileSync(cachedImagePath, "utf8");

    expect(source).toContain('loading="eager"');
    expect(source).not.toContain("setActive(false)");
    expect(source).toContain("observer.disconnect()");
  });

  it("keeps the micro preview until the mounted full thumbnail has painted", () => {
    const source = readFileSync(cachedImagePath, "utf8");

    expect(source).toContain("painted?.identity === identity && painted.url === displayUrl");
    expect(source).toContain("microPreviewEnabled && !displayPainted");
    expect(source).toContain("setPainted({ identity, url: displayUrl })");
  });

  it("does not flash an opacity skeleton when a grid tile enters the viewport", () => {
    const source = readFileSync(mediaGridPath, "utf8");

    expect(source).not.toContain("imageLoaded");
    expect(source).not.toContain("animate-pulse opacity-100");
    expect(source).not.toContain("opacity-0 blur-[3px]");
  });
});
