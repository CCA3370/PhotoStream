import { describe, expect, it } from "vitest";

import {
  gridMicroPreviewOverscanRows,
  gridThumbnailRootMargin,
  gridThumbnailUpgradeDelayMs,
} from "./grid-thumbnail-policy";

describe("grid thumbnail policy", () => {
  it("preloads 240px micro previews well ahead of the viewport", () => {
    expect(gridMicroPreviewOverscanRows).toBe(12);
  });

  it("keeps the 480px upgrade deliberately conservative", () => {
    expect(gridThumbnailUpgradeDelayMs).toBe(150);
    expect(gridThumbnailRootMargin).toBe("80px 0px");
  });
});
