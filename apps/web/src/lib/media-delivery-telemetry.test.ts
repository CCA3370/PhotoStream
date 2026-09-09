import { describe, expect, it } from "vitest";

import { accumulateMediaDelivery, emptyMediaDeliverySnapshot } from "./media-delivery-telemetry";

describe("media delivery telemetry", () => {
  it("aggregates cache, network and failure metrics without media identifiers", () => {
    let snapshot = emptyMediaDeliverySnapshot();
    snapshot = accumulateMediaDelivery(snapshot, "memoryHit", 1_200);
    snapshot = accumulateMediaDelivery(snapshot, "diskHit", 2_400);
    snapshot = accumulateMediaDelivery(snapshot, "joined");
    snapshot = accumulateMediaDelivery(snapshot, "network");
    snapshot = accumulateMediaDelivery(snapshot, "networkBytes", 9_600);
    snapshot = accumulateMediaDelivery(snapshot, "readFailure");
    snapshot = accumulateMediaDelivery(snapshot, "directFallback");

    expect(snapshot).toEqual({
      memoryHits: 1,
      memoryBytes: 1_200,
      diskHits: 1,
      diskBytes: 2_400,
      joinedRequests: 1,
      networkRequests: 1,
      networkBytes: 9_600,
      readFailures: 1,
      writeFailures: 0,
      sizeMismatches: 0,
      refreshedUrls: 0,
      evictions: 0,
      directFallbacks: 1,
    });
  });

  it("ignores invalid byte counts while retaining the event", () => {
    const snapshot = accumulateMediaDelivery(emptyMediaDeliverySnapshot(), "diskHit", -5);
    expect(snapshot.diskHits).toBe(1);
    expect(snapshot.diskBytes).toBe(0);
  });
});
