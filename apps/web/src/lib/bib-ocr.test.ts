import { describe, expect, it } from "vitest";

import { BIB_OCR_ASSET_VERSION, normalizeOcrItems } from "./bib-ocr";

describe("normalizeOcrItems", () => {
  it("normalizes exactly four image-space points into the zero-to-one range", () => {
    expect(
      normalizeOcrItems({
        image: { width: 200, height: 100 },
        items: [
          {
            text: "101999",
            score: 1.2,
            poly: [
              [20, 10],
              [80, 10],
              [80, 30],
              [20, 30],
            ],
          },
        ],
      }),
    ).toEqual([
      {
        text: "101999",
        confidence: 1,
        quadrilateral: [
          { x: 0.1, y: 0.1 },
          { x: 0.4, y: 0.1 },
          { x: 0.4, y: 0.3 },
          { x: 0.1, y: 0.3 },
        ],
        modelVersion: BIB_OCR_ASSET_VERSION,
      },
    ]);
  });

  it("drops malformed polygons without guessing a box", () => {
    expect(
      normalizeOcrItems({
        image: { width: 200, height: 100 },
        items: [{ text: "101999", score: 0.9, poly: [[1, 1]] }],
      }),
    ).toEqual([]);
  });
});
