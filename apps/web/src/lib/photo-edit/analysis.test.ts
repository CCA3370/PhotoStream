import { describe, expect, it } from "vitest";

import { analyzePhotoPixels, automaticPhotoEditRecipe } from "./analysis";
import { normalizePhotoEditRecipe, photoEditRecipeIsIdentity } from "./recipe";

function solid(value: number, width = 32, height = 32) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  }
  return { data, width, height };
}

describe("photo edit analysis", () => {
  it("brightens a dark neutral image conservatively", () => {
    const analysis = analyzePhotoPixels(solid(45));
    const recipe = automaticPhotoEditRecipe(analysis);
    expect(recipe.exposureEv).toBeGreaterThan(0);
    expect(recipe.exposureEv).toBeLessThanOrEqual(1.2);
    expect(recipe.shadows).toBeGreaterThan(0);
    expect(recipe.shadows).toBeLessThanOrEqual(22);
  });

  it("preserves deep natural shadows when the overall scene is already bright", () => {
    const width = 100;
    const height = 100;
    const buffer = solid(145, width, height);
    const darkPixels = Math.ceil(width * height * 0.08);
    for (let pixel = 0; pixel < darkPixels; pixel += 1) {
      const offset = pixel * 4;
      buffer.data[offset] = 12;
      buffer.data[offset + 1] = 12;
      buffer.data[offset + 2] = 12;
    }
    const recipe = automaticPhotoEditRecipe(analyzePhotoPixels(buffer));
    expect(recipe.shadows).toBeLessThanOrEqual(2);
  });

  it("does not increase exposure when highlights are clipped", () => {
    const buffer = solid(245);
    for (let offset = 0; offset < buffer.data.length; offset += 16) {
      buffer.data[offset] = 255;
      buffer.data[offset + 1] = 255;
      buffer.data[offset + 2] = 255;
    }
    const recipe = automaticPhotoEditRecipe(analyzePhotoPixels(buffer));
    expect(recipe.exposureEv).toBeLessThanOrEqual(0.15);
    expect(recipe.highlights).toBeLessThanOrEqual(0);
  });
});

describe("photo edit recipe", () => {
  it("clamps persisted recipe values", () => {
    const recipe = normalizePhotoEditRecipe({
      exposureEv: 20,
      temperature: -5,
      shadows: 400,
      sharpen: -10,
    });
    expect(recipe.exposureEv).toBe(2);
    expect(recipe.temperature).toBe(-1);
    expect(recipe.shadows).toBe(100);
    expect(recipe.sharpen).toBe(0);
  });

  it("recognizes the identity recipe", () => {
    expect(photoEditRecipeIsIdentity(normalizePhotoEditRecipe({}))).toBe(true);
  });
});
