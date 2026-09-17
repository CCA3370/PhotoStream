import type { InternalMediaList } from "@photostream/contracts";
import { describe, expect, it } from "vitest";

import { reviewSyncRevision } from "./review-sync";

function media(overrides: Record<string, unknown> = {}): InternalMediaList {
  return {
    items: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        albumId: "22222222-2222-4222-8222-222222222222",
        uploaderId: "33333333-3333-4333-8333-333333333333",
        categoryId: null,
        ingestStatus: "uploading_source",
        publicationStatus: "hidden",
        width: 4000,
        height: 3000,
        totalBytes: 12_000_000,
        capturedAt: null,
        publishSequence: null,
        publishedAt: null,
        variants: [
          {
            kind: "photo_480",
            url: "https://example.test/signed-a",
            width: 480,
            height: 360,
            bytes: 42_000,
            contentType: "image/webp",
          },
        ],
        deletionTask: null,
        bib: null,
        createdAt: "2026-09-18T00:00:00.000Z",
        ...overrides,
      },
    ],
    nextCursor: null,
  } as InternalMediaList;
}

describe("reviewSyncRevision", () => {
  it("ignores refreshed signed URLs", () => {
    const first = media();
    const second = media({
      variants: [
        {
          kind: "photo_480",
          url: "https://example.test/signed-b",
          width: 480,
          height: 360,
          bytes: 42_000,
          contentType: "image/webp",
        },
      ],
    });

    expect(reviewSyncRevision(first, [])).toBe(reviewSyncRevision(second, []));
  });

  it("changes when upload or review state changes", () => {
    const base = reviewSyncRevision(media(), []);

    expect(reviewSyncRevision(media({ ingestStatus: "ready" }), [])).not.toBe(base);
    expect(reviewSyncRevision(media({ publicationStatus: "published" }), [])).not.toBe(base);
    expect(
      reviewSyncRevision(
        media({ categoryId: "44444444-4444-4444-8444-444444444444" }),
        [],
      ),
    ).not.toBe(base);
    expect(
      reviewSyncRevision(media(), ["11111111-1111-4111-8111-111111111111"]),
    ).not.toBe(base);
  });
});
