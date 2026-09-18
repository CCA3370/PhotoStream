import { describe, expect, it } from "vitest";

import {
  localPhotoEditDraftConflictsWithRemote,
  photoEditSourceFingerprint,
} from "./local-drafts";

describe("local photo edit drafts", () => {
  it("uses source identity fields that remain stable across edit retries", () => {
    expect(
      photoEditSourceFingerprint({
        bytes: 12_345_678,
        width: 6_000,
        height: 4_000,
        contentType: "image/jpeg",
      }),
    ).toBe("12345678:6000x4000:image/jpeg");
  });

  it("changes when the underlying local source changes", () => {
    const first = photoEditSourceFingerprint({
      bytes: 1_000,
      width: 1_920,
      height: 1_080,
      contentType: "image/jpeg",
    });
    const second = photoEditSourceFingerprint({
      bytes: 1_001,
      width: 1_920,
      height: 1_080,
      contentType: "image/jpeg",
    });
    expect(second).not.toBe(first);
  });
});

describe("local photo edit conflict detection", () => {
  it("treats legacy drafts without a generation as unbound", () => {
    expect(
      localPhotoEditDraftConflictsWithRemote(
        {},
        { generation: 4, activeRevisionId: "11111111-1111-4111-8111-111111111111" },
      ),
    ).toBe(false);
  });

  it("accepts the exact generation and active revision it was based on", () => {
    expect(
      localPhotoEditDraftConflictsWithRemote(
        {
          basedOnGeneration: 4,
          basedOnRevisionId: "11111111-1111-4111-8111-111111111111",
        },
        { generation: 4, activeRevisionId: "11111111-1111-4111-8111-111111111111" },
      ),
    ).toBe(false);
  });

  it("rejects a silent rebase after another device updates the media", () => {
    expect(
      localPhotoEditDraftConflictsWithRemote(
        {
          basedOnGeneration: 4,
          basedOnRevisionId: "11111111-1111-4111-8111-111111111111",
        },
        { generation: 5, activeRevisionId: "22222222-2222-4222-8222-222222222222" },
      ),
    ).toBe(true);
  });
});
