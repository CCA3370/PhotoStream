import { describe, expect, it } from "vitest";

import { normalizePhotoEditRecipe } from "./recipe";
import { applyPhotoEditRecipeToPixels } from "./renderer";

describe("photo edit renderer", () => {
  it("increases luminance when exposure is raised", () => {
    const data = new Uint8ClampedArray([
      64, 64, 64, 255, 64, 64, 64, 255, 64, 64, 64, 255, 64, 64, 64, 255,
    ]);
    applyPhotoEditRecipeToPixels(
      { data, width: 2, height: 2 },
      normalizePhotoEditRecipe({ exposureEv: 1 }),
    );
    expect(data[0]).toBeGreaterThan(64);
    expect(data[1]).toBeGreaterThan(64);
    expect(data[2]).toBeGreaterThan(64);
  });

  it("preserves alpha", () => {
    const data = new Uint8ClampedArray([80, 100, 120, 77]);
    applyPhotoEditRecipeToPixels(
      { data, width: 1, height: 1 },
      normalizePhotoEditRecipe({ exposureEv: 0.5, saturation: 20 }),
    );
    expect(data[3]).toBe(77);
  });
});
