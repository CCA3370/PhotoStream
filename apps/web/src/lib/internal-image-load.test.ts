import { describe, expect, it } from "vitest";

import { notifyCurrentInternalImageLoad } from "./internal-image-load";

describe("internal image load notifications", () => {
  it("does not notify the newly selected photo when the previous bitmap completes", () => {
    const reviewed: string[] = [];
    notifyCurrentInternalImageLoad(
      {
        resolvedStrategy: "previous-photo",
        currentStrategy: "selected-photo",
        displayedSource: "/fixture/previous-photo",
        requestedSource: "/fixture/previous-photo",
      },
      () => reviewed.push("selected-photo"),
    );
    expect(reviewed).toEqual([]);
  });

  it("only notifies once the selected image source has completed loading", () => {
    const reviewed: string[] = [];
    const image = {
      resolvedStrategy: "selected-photo",
      currentStrategy: "selected-photo",
      displayedSource: "/fixture/previous-photo",
      requestedSource: "/fixture/selected-photo",
    };
    notifyCurrentInternalImageLoad(image, () => reviewed.push("selected-photo"));
    expect(reviewed).toEqual([]);
    notifyCurrentInternalImageLoad({ ...image, displayedSource: "/fixture/selected-photo" }, () =>
      reviewed.push("selected-photo"),
    );
    expect(reviewed).toEqual(["selected-photo"]);
  });
});
