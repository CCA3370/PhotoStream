import { describe, expect, it } from "vitest";

import {
  createPhotoUploadRequestSchema,
  downloadKindSchema,
  hasPermission,
  loginRequestSchema,
  mediaBatchRequestSchema,
  normalizeUsername,
  permissionsFor,
  updateAlbumRequestSchema,
} from "./index.js";

describe("permission matrix", () => {
  it("grants administrators the complete permission set", () => {
    expect(permissionsFor("admin")).toHaveLength(10);
    expect(hasPermission("admin", "user:manage")).toBe(true);
    expect(hasPermission("admin", "media:upload")).toBe(true);
  });

  it("keeps reviewer and uploader capabilities separated", () => {
    expect(hasPermission("reviewer", "media:review")).toBe(true);
    expect(hasPermission("reviewer", "media:upload")).toBe(false);
    expect(hasPermission("uploader", "media:upload")).toBe(true);
    expect(hasPermission("uploader", "media:review")).toBe(false);
    expect(hasPermission("uploader", "user:manage")).toBe(false);
  });
});

describe("shared validation", () => {
  it("normalizes usernames deterministically", () => {
    expect(normalizeUsername("  Photo.Admin  ")).toBe("photo.admin");
  });

  it("rejects unknown login fields", () => {
    const result = loginRequestSchema.safeParse({
      username: "admin",
      password: "a password",
      role: "admin",
    });

    expect(result.success).toBe(false);
  });
});

describe("photo upload contract", () => {
  const validRequest = {
    albumId: "019d0000-0000-7000-8000-000000000010",
    categoryId: null,
    width: 4_000,
    height: 3_000,
    totalBytes: 4_000_000,
    capturedAt: null,
    variants: [
      {
        kind: "photo_480",
        format: "webp",
        contentType: "image/webp",
        width: 480,
        height: 360,
        bytes: 30_000,
      },
      {
        kind: "photo_960",
        format: "webp",
        contentType: "image/webp",
        width: 960,
        height: 720,
        bytes: 100_000,
      },
      {
        kind: "photo_1920",
        format: "webp",
        contentType: "image/webp",
        width: 1_920,
        height: 1_440,
        bytes: 400_000,
      },
      {
        kind: "photo_original",
        format: "jpeg",
        contentType: "image/jpeg",
        width: 4_000,
        height: 3_000,
        bytes: 4_000_000,
      },
    ],
  } as const;

  it("accepts the exact four-variant photo contract", () => {
    expect(createPhotoUploadRequestSchema.safeParse(validRequest).success).toBe(true);
  });

  it("rejects duplicate roles or mixed derived formats", () => {
    const duplicate = {
      ...validRequest,
      variants: validRequest.variants.map((variant, index) =>
        index === 2 ? { ...variant, kind: "photo_960" } : variant,
      ),
    };
    expect(createPhotoUploadRequestSchema.safeParse(duplicate).success).toBe(false);

    const mixed = {
      ...validRequest,
      variants: validRequest.variants.map((variant, index) =>
        index === 1 ? { ...variant, format: "jpeg", contentType: "image/jpeg" } : variant,
      ),
    };
    expect(createPhotoUploadRequestSchema.safeParse(mixed).success).toBe(false);
  });

  it("rejects photos above the 100MP boundary", () => {
    expect(
      createPhotoUploadRequestSchema.safeParse({
        ...validRequest,
        width: 20_000,
        height: 10_000,
      }).success,
    ).toBe(false);
  });

  it("rejects forged original sizes and non-canonical derivative dimensions", () => {
    expect(
      createPhotoUploadRequestSchema.safeParse({
        ...validRequest,
        totalBytes: validRequest.totalBytes + 1,
      }).success,
    ).toBe(false);
    expect(
      createPhotoUploadRequestSchema.safeParse({
        ...validRequest,
        variants: validRequest.variants.map((variant, index) =>
          index === 0 ? { ...variant, width: 481 } : variant,
        ),
      }).success,
    ).toBe(false);
  });
});

describe("operations contracts", () => {
  const first = "019d0000-0000-7000-8000-000000000101";
  const second = "019d0000-0000-7000-8000-000000000102";

  it("requires a non-empty album settings patch", () => {
    expect(updateAlbumRequestSchema.safeParse({}).success).toBe(false);
    expect(
      updateAlbumRequestSchema.safeParse({
        previewDownloadEnabled: true,
        privacyNotice: "仅用于校内活动记录",
      }).success,
    ).toBe(true);
  });

  it("keeps the download contract photo-only", () => {
    expect(downloadKindSchema.options).toEqual(["preview", "original"]);
  });

  it("keeps batch IDs unique and category fields action-specific", () => {
    expect(
      mediaBatchRequestSchema.safeParse({ action: "publish", mediaIds: [first, second] }).success,
    ).toBe(true);
    expect(
      mediaBatchRequestSchema.safeParse({ action: "publish", mediaIds: [first, first] }).success,
    ).toBe(false);
    expect(
      mediaBatchRequestSchema.safeParse({ action: "change_category", mediaIds: [first] }).success,
    ).toBe(false);
    expect(
      mediaBatchRequestSchema.safeParse({
        action: "change_category",
        mediaIds: [first],
        categoryId: null,
      }).success,
    ).toBe(true);
  });
});
