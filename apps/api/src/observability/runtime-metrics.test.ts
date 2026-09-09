import { describe, expect, it } from "vitest";

import { RuntimeMetrics } from "./runtime-metrics.js";

function testClock() {
  let monotonic = 0;
  let now = new Date("2026-09-10T00:00:00.000Z");
  return {
    clock: {
      monotonicMs: () => monotonic,
      now: () => now,
      uptimeSeconds: () => 321,
      memoryUsage: () => ({
        rss: 100,
        heapTotal: 80,
        heapUsed: 40,
        external: 10,
        arrayBuffers: 5,
      }),
    },
    advance(milliseconds: number) {
      monotonic += milliseconds;
      now = new Date(now.getTime() + milliseconds);
    },
  };
}

describe("RuntimeMetrics", () => {
  it("tracks bounded request latency percentiles and status classes", () => {
    const time = testClock();
    const metrics = new RuntimeMetrics({
      pool: { totalCount: 3, idleCount: 2, waitingCount: 1 },
      broker: { subscriberCount: () => 4 },
      sampleLimit: 32,
      slowThresholdMs: 100,
      clock: time.clock,
      release: "registry/photostream-api:abc123",
      slot: "green",
    });

    for (let index = 1; index <= 40; index += 1) {
      const id = `request-${index}`;
      metrics.startRequest(id);
      time.advance(index * 10);
      metrics.finishRequest(id, index % 10 === 0 ? 500 : index % 4 === 0 ? 404 : 200);
    }

    const snapshot = metrics.snapshot();
    expect(snapshot.requests.total).toBe(40);
    expect(snapshot.requests.sampleSize).toBe(32);
    expect(snapshot.requests.slow).toBe(31);
    expect(snapshot.requests.status5xx).toBe(4);
    expect(snapshot.requests.status4xx).toBe(8);
    expect(snapshot.requests.status2xx).toBe(28);
    expect(snapshot.requests.p50Ms).toBe(250);
    expect(snapshot.requests.p95Ms).toBe(390);
    expect(snapshot.requests.p99Ms).toBe(400);
    expect(snapshot.database).toEqual({
      totalConnections: 3,
      idleConnections: 2,
      waitingRequests: 1,
    });
    expect(snapshot.live.subscribers).toBe(4);
    expect(snapshot.deployment).toMatchObject({
      release: "registry/photostream-api:abc123",
      slot: "green",
    });
  });

  it("prevents overlapping background jobs and records failure state", async () => {
    const time = testClock();
    const metrics = new RuntimeMetrics({
      pool: { totalCount: 1, idleCount: 1, waitingCount: 0 },
      broker: { subscriberCount: () => 0 },
      clock: time.clock,
    });

    let releaseFirst: (() => void) | undefined;
    const first = metrics.runJob(
      "deletion",
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
    );
    await metrics.runJob("deletion", async () => undefined);
    expect(metrics.snapshot().jobs.deletion.skippedRuns).toBe(1);

    time.advance(125);
    releaseFirst?.();
    await first;
    expect(metrics.snapshot().jobs.deletion).toMatchObject({
      running: false,
      runs: 1,
      failures: 0,
      skippedRuns: 1,
      lastDurationMs: 125,
    });

    time.advance(10);
    await expect(
      metrics.runJob("deletion", async () => {
        time.advance(20);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(metrics.snapshot().jobs.deletion).toMatchObject({
      running: false,
      runs: 2,
      failures: 1,
      skippedRuns: 1,
      lastDurationMs: 20,
    });
  });
});
