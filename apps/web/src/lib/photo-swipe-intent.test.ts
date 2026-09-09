import { describe, expect, it } from "vitest";

import { swipeIntentDirection } from "./photo-swipe-intent";

describe("swipe intent", () => {
  it("ignores touch jitter and vertical or diagonal gestures", () => {
    for (const [x, y] of [
      [0, 0],
      [15, 0],
      [80, 100],
      [30, 20],
    ]) {
      expect(swipeIntentDirection(x ?? 0, y ?? 0)).toBeNull();
    }
  });
  it("loads only the destination direction before the 52px commit threshold", () => {
    expect(swipeIntentDirection(-16, 2)).toBe(1);
    expect(swipeIntentDirection(16, 2)).toBe(-1);
  });
});
