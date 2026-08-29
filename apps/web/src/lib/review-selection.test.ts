import { describe, expect, it } from "vitest";

import { selectMediaRange } from "./review-selection";

describe("selectMediaRange", () => {
  it("adds the inclusive range in either direction without dropping prior selections", () => {
    const ordered = ["one", "two", "three", "four"];
    expect([...selectMediaRange(ordered, new Set(["four"]), "three", "one")].sort()).toEqual([
      "four",
      "one",
      "three",
      "two",
    ]);
  });

  it("leaves selection unchanged when the anchor or target is no longer loaded", () => {
    expect([...selectMediaRange(["one"], new Set(["one"]), "missing", "one")]).toEqual(["one"]);
  });
});
