import type { InternalMediaView } from "@photostream/contracts";
import { describe, expect, it } from "vitest";

import {
  fetchReviewRemoteWindow,
  isStandaloneLocalReviewPhoto,
  mergeRemote,
  ReviewRemoteRequests,
  reconcileRemotePage,
} from "./review-remote-state";

describe("standalone local review photos", () => {
  it("does not resurrect a completed upload omitted or deleted by the server", () => {
    const photo = { uploadState: "published" as const, mediaId: "remote-photo" };
    expect(isStandaloneLocalReviewPhoto(photo, new Set())).toBe(false);
    expect(isStandaloneLocalReviewPhoto(photo, new Set(["remote-photo"]))).toBe(false);
  });

  it("keeps local and failed photos while hiding uploads still in progress", () => {
    expect(isStandaloneLocalReviewPhoto({ uploadState: "local", mediaId: null }, new Set())).toBe(
      true,
    );
    expect(
      isStandaloneLocalReviewPhoto({ uploadState: "failed", mediaId: "unloaded" }, new Set()),
    ).toBe(true);
    expect(
      isStandaloneLocalReviewPhoto({ uploadState: "uploading", mediaId: null }, new Set()),
    ).toBe(false);
  });

  it("uses the server item instead of duplicating its linked local photo", () => {
    const remoteIds = new Set(["remote-photo"]);
    expect(
      isStandaloneLocalReviewPhoto({ uploadState: "local", mediaId: "remote-photo" }, remoteIds),
    ).toBe(false);
    expect(
      isStandaloneLocalReviewPhoto({ uploadState: "failed", mediaId: "remote-photo" }, remoteIds),
    ).toBe(false);
  });
});

function media(id: string, seconds: number, reviewedAt: string | null = null): InternalMediaView {
  return {
    id,
    albumId: "album",
    uploaderId: "uploader",
    categoryId: null,
    ingestStatus: "ready",
    publicationStatus: "hidden",
    width: 100,
    height: 100,
    totalBytes: 100,
    capturedAt: null,
    publishSequence: null,
    publishedAt: null,
    reviewedAt,
    variants: [],
    deletionTask: null,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString(),
  };
}

describe("review remote window", () => {
  it("refreshes through the loaded frontier after reviewed or reassigned items leave a page", async () => {
    const frontier = media("tail", 10);
    const cursors: (string | undefined)[] = [];
    const result = await fetchReviewRemoteWindow(
      async (cursor) => {
        cursors.push(cursor);
        return cursor === undefined
          ? { items: [media("new", 30), media("head", 20)], nextCursor: "second" }
          : { items: [frontier, media("older", 5)], nextCursor: "third" };
      },
      frontier,
      "newest",
    );

    expect(cursors).toEqual([undefined, "second"]);
    expect(result.items.map((item) => item.id)).toEqual(["new", "head", "tail", "older"]);
    expect(result.nextCursor).toBe("third");
  });

  it("drops stale loaded records missing from fresh results while preserving the active image", () => {
    const head = media("head", 30);
    const old = [head, media("reviewed-elsewhere", 20), media("active", 10)];
    const result = reconcileRemotePage(old, [head], new Set(["remote:active"]), new Map());
    expect(result.map((item) => item.id)).toEqual(["head", "active"]);
  });

  it("does not resurrect a successful review from an earlier list response", () => {
    const reviewedAt = "2026-01-01T00:01:00.000Z";
    const result = reconcileRemotePage(
      [media("photo", 1, reviewedAt)],
      [media("photo", 1)],
      new Set(),
      new Map([["photo", reviewedAt]]),
    );
    expect(result[0]?.reviewedAt).toBe(reviewedAt);
  });

  it("accepts an authoritative reset when the browser did not just complete that review", () => {
    const result = reconcileRemotePage(
      [media("photo", 1, "2026-01-01T00:01:00.000Z")],
      [media("photo", 1)],
      new Set(),
      new Map(),
    );
    expect(result[0]?.reviewedAt).toBeNull();
  });

  it("walks oldest pages through the timestamp bucket of a removed frontier", async () => {
    const cursors: (string | undefined)[] = [];
    const result = await fetchReviewRemoteWindow(
      async (cursor) => {
        cursors.push(cursor);
        return cursor === undefined
          ? { items: [media("a", 1), media("b", 2)], nextCursor: "second" }
          : { items: [media("d", 2), media("e", 3)], nextCursor: "third" };
      },
      media("c", 2),
      "oldest",
    );
    expect(cursors).toEqual([undefined, "second"]);
    expect(result.items.map((item) => item.id)).toEqual(["a", "b", "d", "e"]);
  });

  it.each(["newest", "oldest"] as const)(
    "keeps the loaded %s tail when PostgreSQL microseconds are masked by ISO milliseconds",
    async (sort) => {
      // PostgreSQL chronological order is 3 (.123001), 2 (.123002), 1 (.123900).
      // All three DTO timestamps round to .123Z; the UUID order cannot recover that order.
      const ids = sort === "newest" ? ["1", "2", "3"] : ["3", "2", "1"];
      const photos = ids.map((id) => ({
        ...media(id, 0),
        createdAt: "2026-01-01T00:00:00.123Z",
      }));
      const frontier = photos.at(-1);
      if (frontier === undefined) throw new Error("Missing frontier fixture");
      const cursors: (string | undefined)[] = [];
      const result = await fetchReviewRemoteWindow(
        async (cursor) => {
          cursors.push(cursor);
          return cursor === undefined
            ? { items: photos.slice(0, 1), nextCursor: "second" }
            : { items: photos.slice(1), nextCursor: "third" };
        },
        frontier,
        sort,
      );
      expect(cursors).toEqual([undefined, "second"]);
      expect(result.items.map((item) => item.id)).toEqual(ids);
      expect(result.nextCursor).toBe("third");
    },
  );

  it("retains thumbnail URLs for unchanged media and replaces them after an edit revision", () => {
    const variant = {
      kind: "photo_480" as const,
      bytes: 100,
      width: 100,
      height: 100,
      contentType: "image/webp" as const,
      url: "/fixture/old-preview",
    };
    const current = { ...media("photo", 1), variants: [variant] };
    const fresh = {
      ...current,
      variants: [{ ...variant, url: "/fixture/refreshed-preview" }],
    };
    const unchanged = reconcileRemotePage([current], [fresh], new Set(), new Map());
    expect(unchanged[0]?.variants[0]?.url).toBe("/fixture/old-preview");
    expect(unchanged[0]).toBe(current);
    const edited = reconcileRemotePage(
      [current],
      [
        {
          ...fresh,
          edit: {
            activeRevisionId: "revision",
            pendingRevisionId: null,
            generation: 1,
            pendingStatus: null,
          },
        },
      ],
      new Set(),
      new Map(),
    );
    expect(edited[0]?.variants[0]?.url).toBe("/fixture/refreshed-preview");
    const reviewedAt = "2026-01-01T00:01:00.000Z";
    expect(mergeRemote([], [fresh, fresh], new Map([["photo", reviewedAt]]))).toHaveLength(1);
    expect(mergeRemote([], [fresh], new Map([["photo", reviewedAt]]))[0]?.reviewedAt).toBe(
      reviewedAt,
    );
  });
});

describe("review remote request coordination", () => {
  it("retires a delayed old-filter response and starts the new filter without waiting", async () => {
    const requests = new ReviewRemoteRequests();
    const committed: string[] = [];
    let releaseOld = () => {};
    const oldResponse = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    requests.setScope("all");
    const old = requests.run("all", async ({ signal, isCurrent }) => {
      await oldResponse;
      expect(signal.aborted).toBe(true);
      if (isCurrent()) committed.push("all");
    });
    await Promise.resolve();
    requests.setScope("pending-mine");
    await requests.run("pending-mine", async ({ isCurrent }) => {
      if (isCurrent()) committed.push("pending-mine");
    });
    releaseOld();
    await old;
    expect(committed).toEqual(["pending-mine"]);
  });

  it("serializes refresh and append within the current filter", async () => {
    const requests = new ReviewRemoteRequests();
    const committed: string[] = [];
    let releaseRefresh = () => {};
    const response = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    requests.setScope("pending");
    const refresh = requests.run("pending", async () => {
      await response;
      committed.push("refresh");
    });
    const append = requests.run("pending", async () => {
      committed.push("append");
    });
    await Promise.resolve();
    expect(committed).toEqual([]);
    releaseRefresh();
    await Promise.all([refresh, append]);
    expect(committed).toEqual(["refresh", "append"]);
  });
});
