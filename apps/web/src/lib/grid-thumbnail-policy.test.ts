import { describe, expect, it } from "vitest";

import {
  gridThumbnailRootMargin,
  gridThumbnailUpgradeDelayMs,
} from "./grid-thumbnail-policy";

describe("grid thumbnail policy", () => {
  it("keeps the 480px upgrade deliberately conservative", () => {
    expect(gridThumbnailUpgradeDelayMs).toBe(150);
    expect(gridThumbnailRootMargin).toBe("80px 0px");
  });
});
