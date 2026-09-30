import { describe, expect, it } from "vitest";

import {
  canActOnReviewImage,
  notifyCurrentReviewImageLoad,
  requestReviewImage,
} from "./review-image-state";

describe("review image loading state", () => {
  const photo = { key: "remote:one", visualRevision: null, src: "/fixture/one-preview" };

  it("blocks actions after navigation until the newly selected photo is loaded", () => {
    const loaded = requestReviewImage(null, photo);
    const next = requestReviewImage(loaded, {
      ...photo,
      key: "remote:two",
      src: "/fixture/two-preview",
    });
    expect(canActOnReviewImage(loaded, null, false)).toBe(false);
    expect(canActOnReviewImage(loaded, loaded, false)).toBe(true);
    expect(canActOnReviewImage(next, loaded, false)).toBe(false);
    expect(canActOnReviewImage(next, next, false)).toBe(true);
    const returned = requestReviewImage(next, photo);
    expect(canActOnReviewImage(returned, loaded, false)).toBe(false);
    expect(canActOnReviewImage(returned, returned, false)).toBe(true);
  });

  it("requires the updated visual revision to load and blocks failed images", () => {
    const loaded = requestReviewImage(null, photo);
    const edited = requestReviewImage(loaded, { ...photo, visualRevision: "edit-revision" });
    expect(canActOnReviewImage(edited, loaded, false)).toBe(false);
    expect(canActOnReviewImage(edited, edited, true)).toBe(false);
    expect(canActOnReviewImage(requestReviewImage(loaded, null), loaded, false)).toBe(false);
  });

  it("retains approval when authorization rotates without changing the selected image", () => {
    const image = { ...photo, src: "https://example.test/fixture/preview?auth_key=old" };
    const loaded = requestReviewImage(null, image);
    const renewed = requestReviewImage(loaded, {
      ...image,
      src: "https://example.test/fixture/preview?auth_key=new",
    });
    expect(renewed).toBe(loaded);
    expect(canActOnReviewImage(renewed, loaded, false)).toBe(true);
  });

  it("keeps the same-photo approval when original source metadata changes", () => {
    const selected = { ...photo, originalSrc: "/fixture/local-original", localPreferred: true };
    const loaded = requestReviewImage(null, selected);
    const selectedWithRemoteOriginal = {
      ...selected,
      originalSrc: "/fixture/remote-original",
      localPreferred: false,
    };
    const remoteOriginal = requestReviewImage(loaded, selectedWithRemoteOriginal);
    expect(canActOnReviewImage(remoteOriginal, loaded, false)).toBe(true);
  });

  it("ignores a delayed previous-photo callback and accepts the current cached image", () => {
    const first = requestReviewImage(null, photo);
    const second = requestReviewImage(first, {
      ...photo,
      key: "remote:two",
      src: "/fixture/two-preview",
    });
    const reviewed: string[] = [];
    notifyCurrentReviewImageLoad(second, first, () => reviewed.push("one"));
    expect(reviewed).toEqual([]);
    notifyCurrentReviewImageLoad(second, second, () => reviewed.push("two"));
    expect(reviewed).toEqual(["two"]);
  });
});
