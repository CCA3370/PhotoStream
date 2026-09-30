import { describe, expect, it } from "vitest";

import { reviewLightboxQueue } from "./review-lightbox-queue";

describe("review lightbox queue", () => {
  const first = { key: "first", publicationStatus: "published", categoryId: "changed" };
  const next = { key: "next", publicationStatus: "hidden", categoryId: "original" };
  const other = { key: "other", publicationStatus: "published", categoryId: "changed" };
  const hidden = (item: typeof first) => item.publicationStatus === "hidden";

  it("keeps the photo made visible open and the next hidden photo available", () => {
    expect(
      reviewLightboxQueue([first, next, other], ["first", "next", "other"], "first", hidden),
    ).toEqual([first, next]);
  });

  it("drops the previous photo once navigation advances to a matching photo", () => {
    expect(reviewLightboxQueue([first, next], ["first", "next"], "next", hidden)).toEqual([next]);
  });

  it("keeps current details through category changes and local-to-remote key replacement", () => {
    expect(
      reviewLightboxQueue(
        [first, next],
        ["old-local", "next"],
        "first",
        (item) => item.categoryId === "original",
      ),
    ).toEqual([next, first]);
  });

  it("does not resurrect removed photos or duplicate queue entries", () => {
    expect(reviewLightboxQueue([next], ["first", "next", "next"], "first", hidden)).toEqual([next]);
    expect(reviewLightboxQueue([next], ["next"], null, hidden)).toEqual([]);
  });
});
