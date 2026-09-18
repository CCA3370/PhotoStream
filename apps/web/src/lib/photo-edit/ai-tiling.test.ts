import { describe, expect, it } from "vitest";

import { createPhotoEditTiles, photoEditFeatherWeight, reflectPhotoEditIndex } from "./ai-tiling";

describe("photo edit AI tiling", () => {
  it("covers a large image with bounded overlapping tiles", () => {
    const tiles = createPhotoEditTiles({
      width: 1_000,
      height: 700,
      tileSize: 256,
      overlap: 32,
    });
    expect(tiles.length).toBeGreaterThan(1);
    expect(tiles[0]).toMatchObject({
      contributionX: 0,
      contributionY: 0,
      inputX: -16,
      inputY: -16,
      inputSize: 256,
      cropOffset: 16,
    });
    const last = tiles.at(-1);
    expect(last).toBeDefined();
    expect((last?.contributionX ?? 0) + (last?.contributionWidth ?? 0)).toBe(1_000);
    expect((last?.contributionY ?? 0) + (last?.contributionHeight ?? 0)).toBe(700);
  });

  it("reflects coordinates at both edges", () => {
    expect(reflectPhotoEditIndex(-1, 4)).toBe(0);
    expect(reflectPhotoEditIndex(-2, 4)).toBe(1);
    expect(reflectPhotoEditIndex(4, 4)).toBe(3);
    expect(reflectPhotoEditIndex(5, 4)).toBe(2);
  });

  it("feathers only internal overlap edges", () => {
    expect(photoEditFeatherWeight({ local: 0, start: 0, size: 224, total: 500, overlap: 32 })).toBe(
      1,
    );
    const internalLeft = photoEditFeatherWeight({
      local: 0,
      start: 192,
      size: 224,
      total: 500,
      overlap: 32,
    });
    expect(internalLeft).toBeLessThan(0.01);
    expect(
      photoEditFeatherWeight({
        local: 100,
        start: 192,
        size: 224,
        total: 500,
        overlap: 32,
      }),
    ).toBe(1);
  });
});
