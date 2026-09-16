import { describe, expect, it } from "vitest";

import { dashboardResponseSchema } from "./dashboard.js";

describe("dashboard response schema", () => {
  it("accepts browser delivery aggregates above per-report ingestion limits", () => {
    const parsed = dashboardResponseSchema.safeParse({
      from: "2026-08-17T00:00:00.000Z",
      to: "2026-09-16T00:00:00.000Z",
      bucket: "1d",
      maxRangeDays: 30,
      mediaCount: 100,
      logicalBytes: 10_000,
      opens: 10,
      sessions: 8,
      downloads: 5,
      uniqueVisitors: 6,
      points: [],
      searchUsage: {
        number: 0,
        attributes: 0,
        face: 0,
        points: [],
      },
      cdn: {
        status: "ok",
        domain: "photos.example.com",
        intervalSeconds: 300,
        dataDelaySeconds: 60,
        trafficBytes: 0,
        originTrafficBytes: 0,
        peakBandwidthBps: 0,
        averageByteHitRate: null,
        averageRequestHitRate: null,
        requests: 0,
        errorRequests: 0,
        points: [],
        message: null,
        browser: {
          memoryHits: 512,
          memoryBytes: 1024 * 1024 * 1024,
          diskHits: 256,
          diskBytes: 1024 * 1024 * 1024,
          joinedRequests: 200,
          networkRequests: 300,
          networkBytes: 1024 * 1024 * 1024,
          readFailures: 130,
          writeFailures: 129,
          sizeMismatches: 140,
          refreshedUrls: 150,
          evictions: 160,
          directFallbacks: 170,
          cacheHitRate: 72.5,
        },
      },
      topPhotos: [],
      topLikedPhotos: [],
    });

    expect(parsed.success).toBe(true);
  });
});
