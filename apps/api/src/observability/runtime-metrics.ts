import type { Pool } from "pg";

import type { LiveEventBroker } from "../media/live-event-broker.js";

export const runtimeJobNames = [
  "deletion",
  "analyticsCleanup",
  "bibMaintenance",
  "faceMaintenance",
  "bibCleanup",
] as const;

export type RuntimeJobName = (typeof runtimeJobNames)[number];

interface RuntimeClock {
  readonly monotonicMs: () => number;
  readonly now: () => Date;
  readonly uptimeSeconds: () => number;
  readonly memoryUsage: () => NodeJS.MemoryUsage;
}

interface JobState {
  running: boolean;
  runs: number;
  failures: number;
  skippedRuns: number;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastErrorAt: string | null;
  lastDurationMs: number | null;
}

export interface RuntimeMetricsSnapshot {
  readonly generatedAt: string;
  readonly uptimeSeconds: number;
  readonly deployment: {
    readonly release: string | null;
    readonly slot: string | null;
    readonly nodeVersion: string;
  };
  readonly requests: {
    readonly total: number;
    readonly inFlight: number;
    readonly slow: number;
    readonly status2xx: number;
    readonly status3xx: number;
    readonly status4xx: number;
    readonly status5xx: number;
    readonly sampleSize: number;
    readonly p50Ms: number | null;
    readonly p95Ms: number | null;
    readonly p99Ms: number | null;
  };
  readonly process: {
    readonly rssBytes: number;
    readonly heapUsedBytes: number;
    readonly heapTotalBytes: number;
    readonly externalBytes: number;
    readonly arrayBuffersBytes: number;
  };
  readonly database: {
    readonly totalConnections: number;
    readonly idleConnections: number;
    readonly waitingRequests: number;
  };
  readonly live: {
    readonly subscribers: number;
  };
  readonly jobs: Readonly<Record<RuntimeJobName, Readonly<JobState>>>;
}

const defaultClock: RuntimeClock = {
  monotonicMs: () => performance.now(),
  now: () => new Date(),
  uptimeSeconds: () => process.uptime(),
  memoryUsage: () => process.memoryUsage(),
};

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}

function percentile(values: readonly number[], percentileValue: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(percentileValue * sorted.length) - 1));
  return rounded(sorted[index] ?? 0);
}

function createJobState(): JobState {
  return {
    running: false,
    runs: 0,
    failures: 0,
    skippedRuns: 0,
    lastStartedAt: null,
    lastCompletedAt: null,
    lastErrorAt: null,
    lastDurationMs: null,
  };
}

export class RuntimeMetrics {
  readonly #pool: Pick<Pool, "totalCount" | "idleCount" | "waitingCount">;
  readonly #broker: Pick<LiveEventBroker, "subscriberCount">;
  readonly #release: string | null;
  readonly #slot: string | null;
  readonly #sampleLimit: number;
  readonly #slowThresholdMs: number;
  readonly #clock: RuntimeClock;
  readonly #requestStarts = new Map<string, number>();
  readonly #durations: number[] = [];
  readonly #jobs = new Map<RuntimeJobName, JobState>();
  #totalRequests = 0;
  #slowRequests = 0;
  #status2xx = 0;
  #status3xx = 0;
  #status4xx = 0;
  #status5xx = 0;

  constructor(options: {
    readonly pool: Pick<Pool, "totalCount" | "idleCount" | "waitingCount">;
    readonly broker: Pick<LiveEventBroker, "subscriberCount">;
    readonly release?: string;
    readonly slot?: string;
    readonly sampleLimit?: number;
    readonly slowThresholdMs?: number;
    readonly clock?: RuntimeClock;
  }) {
    this.#pool = options.pool;
    this.#broker = options.broker;
    this.#release = options.release ?? null;
    this.#slot = options.slot ?? null;
    this.#sampleLimit = Math.max(32, options.sampleLimit ?? 2_048);
    this.#slowThresholdMs = Math.max(1, options.slowThresholdMs ?? 1_000);
    this.#clock = options.clock ?? defaultClock;
    for (const name of runtimeJobNames) this.#jobs.set(name, createJobState());
  }

  startRequest(requestId: string): void {
    this.#requestStarts.set(requestId, this.#clock.monotonicMs());
  }

  finishRequest(requestId: string, statusCode: number): number | undefined {
    const startedAt = this.#requestStarts.get(requestId);
    if (startedAt === undefined) return undefined;
    this.#requestStarts.delete(requestId);
    const durationMs = Math.max(0, this.#clock.monotonicMs() - startedAt);
    this.#totalRequests += 1;
    if (durationMs >= this.#slowThresholdMs) this.#slowRequests += 1;
    if (statusCode >= 500) this.#status5xx += 1;
    else if (statusCode >= 400) this.#status4xx += 1;
    else if (statusCode >= 300) this.#status3xx += 1;
    else if (statusCode >= 200) this.#status2xx += 1;
    this.#durations.push(durationMs);
    if (this.#durations.length > this.#sampleLimit) {
      this.#durations.splice(0, this.#durations.length - this.#sampleLimit);
    }
    return rounded(durationMs);
  }

  async runJob(name: RuntimeJobName, task: () => Promise<void>): Promise<void> {
    const state = this.#jobs.get(name);
    if (state === undefined) throw new Error(`Unknown runtime job: ${name}`);
    if (state.running) {
      state.skippedRuns += 1;
      return;
    }

    state.running = true;
    state.runs += 1;
    state.lastStartedAt = this.#clock.now().toISOString();
    const startedAt = this.#clock.monotonicMs();
    try {
      await task();
      state.lastCompletedAt = this.#clock.now().toISOString();
    } catch (error) {
      state.failures += 1;
      state.lastErrorAt = this.#clock.now().toISOString();
      throw error;
    } finally {
      state.lastDurationMs = rounded(Math.max(0, this.#clock.monotonicMs() - startedAt));
      state.running = false;
    }
  }

  snapshot(): RuntimeMetricsSnapshot {
    const memory = this.#clock.memoryUsage();
    const jobs = Object.fromEntries(
      runtimeJobNames.map((name) => {
        const state = this.#jobs.get(name);
        if (state === undefined) throw new Error(`Missing runtime job state: ${name}`);
        return [name, { ...state }];
      }),
    ) as Record<RuntimeJobName, JobState>;

    return {
      generatedAt: this.#clock.now().toISOString(),
      uptimeSeconds: Math.max(0, Math.floor(this.#clock.uptimeSeconds())),
      deployment: {
        release: this.#release,
        slot: this.#slot,
        nodeVersion: process.version,
      },
      requests: {
        total: this.#totalRequests,
        inFlight: this.#requestStarts.size,
        slow: this.#slowRequests,
        status2xx: this.#status2xx,
        status3xx: this.#status3xx,
        status4xx: this.#status4xx,
        status5xx: this.#status5xx,
        sampleSize: this.#durations.length,
        p50Ms: percentile(this.#durations, 0.5),
        p95Ms: percentile(this.#durations, 0.95),
        p99Ms: percentile(this.#durations, 0.99),
      },
      process: {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
        externalBytes: memory.external,
        arrayBuffersBytes: memory.arrayBuffers,
      },
      database: {
        totalConnections: this.#pool.totalCount,
        idleConnections: this.#pool.idleCount,
        waitingRequests: this.#pool.waitingCount,
      },
      live: {
        subscribers: this.#broker.subscriberCount(),
      },
      jobs,
    };
  }
}
