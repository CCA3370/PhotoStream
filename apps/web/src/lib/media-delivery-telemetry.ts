export type MediaDeliveryMetric =
  | "memoryHit"
  | "diskHit"
  | "joined"
  | "network"
  | "networkBytes"
  | "readFailure"
  | "writeFailure"
  | "sizeMismatch"
  | "refreshed"
  | "evicted"
  | "directFallback";

export interface MediaDeliverySnapshot {
  readonly memoryHits: number;
  readonly memoryBytes: number;
  readonly diskHits: number;
  readonly diskBytes: number;
  readonly joinedRequests: number;
  readonly networkRequests: number;
  readonly networkBytes: number;
  readonly readFailures: number;
  readonly writeFailures: number;
  readonly sizeMismatches: number;
  readonly refreshedUrls: number;
  readonly evictions: number;
  readonly directFallbacks: number;
}

interface PendingDelivery {
  readonly snapshot: MediaDeliverySnapshot;
  readonly events: number;
}

interface TelemetryToken {
  readonly token: string;
  readonly expiresAt: number;
}

const flushDelayMs = 10_000;
const flushEventThreshold = 24;
const tokenRefreshMarginMs = 30_000;
const pending = new Map<string, PendingDelivery>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const telemetryTokens = new Map<string, TelemetryToken>();
const tokenRequests = new Map<string, Promise<TelemetryToken>>();
let lifecycleInstalled = false;

export function emptyMediaDeliverySnapshot(): MediaDeliverySnapshot {
  return {
    memoryHits: 0,
    memoryBytes: 0,
    diskHits: 0,
    diskBytes: 0,
    joinedRequests: 0,
    networkRequests: 0,
    networkBytes: 0,
    readFailures: 0,
    writeFailures: 0,
    sizeMismatches: 0,
    refreshedUrls: 0,
    evictions: 0,
    directFallbacks: 0,
  };
}

function safeBytes(bytes: number): number {
  return Number.isFinite(bytes) && bytes > 0 ? Math.floor(bytes) : 0;
}

export function accumulateMediaDelivery(
  current: MediaDeliverySnapshot,
  metric: MediaDeliveryMetric,
  bytes = 0,
): MediaDeliverySnapshot {
  const size = safeBytes(bytes);
  switch (metric) {
    case "memoryHit":
      return {
        ...current,
        memoryHits: current.memoryHits + 1,
        memoryBytes: current.memoryBytes + size,
      };
    case "diskHit":
      return { ...current, diskHits: current.diskHits + 1, diskBytes: current.diskBytes + size };
    case "joined":
      return { ...current, joinedRequests: current.joinedRequests + 1 };
    case "network":
      return { ...current, networkRequests: current.networkRequests + 1 };
    case "networkBytes":
      return { ...current, networkBytes: current.networkBytes + size };
    case "readFailure":
      return { ...current, readFailures: current.readFailures + 1 };
    case "writeFailure":
      return { ...current, writeFailures: current.writeFailures + 1 };
    case "sizeMismatch":
      return { ...current, sizeMismatches: current.sizeMismatches + 1 };
    case "refreshed":
      return { ...current, refreshedUrls: current.refreshedUrls + 1 };
    case "evicted":
      return { ...current, evictions: current.evictions + 1 };
    case "directFallback":
      return { ...current, directFallbacks: current.directFallbacks + 1 };
  }
}

function mergeDelivery(
  left: MediaDeliverySnapshot,
  right: MediaDeliverySnapshot,
): MediaDeliverySnapshot {
  return {
    memoryHits: left.memoryHits + right.memoryHits,
    memoryBytes: left.memoryBytes + right.memoryBytes,
    diskHits: left.diskHits + right.diskHits,
    diskBytes: left.diskBytes + right.diskBytes,
    joinedRequests: left.joinedRequests + right.joinedRequests,
    networkRequests: left.networkRequests + right.networkRequests,
    networkBytes: left.networkBytes + right.networkBytes,
    readFailures: left.readFailures + right.readFailures,
    writeFailures: left.writeFailures + right.writeFailures,
    sizeMismatches: left.sizeMismatches + right.sizeMismatches,
    refreshedUrls: left.refreshedUrls + right.refreshedUrls,
    evictions: left.evictions + right.evictions,
    directFallbacks: left.directFallbacks + right.directFallbacks,
  };
}

function validScope(scope: string | undefined): scope is string {
  return (
    scope !== undefined && scope !== "public-media" && scope.length >= 12 && scope.length <= 32
  );
}

async function requestTelemetryToken(scope: string): Promise<TelemetryToken> {
  const response = await fetch(
    `/api/v1/public/albums/${encodeURIComponent(scope)}/analytics/media-delivery-token`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error(`telemetry token ${response.status}`);
  const body = (await response.json()) as { token?: unknown; expiresAt?: unknown };
  if (typeof body.token !== "string" || typeof body.expiresAt !== "string") {
    throw new Error("invalid telemetry token response");
  }
  const expiresAt = Date.parse(body.expiresAt);
  if (!Number.isFinite(expiresAt)) throw new Error("invalid telemetry token expiry");
  const token = { token: body.token, expiresAt };
  telemetryTokens.set(scope, token);
  return token;
}

async function ensureTelemetryToken(scope: string): Promise<TelemetryToken> {
  const cached = telemetryTokens.get(scope);
  if (cached !== undefined && cached.expiresAt - Date.now() > tokenRefreshMarginMs) return cached;
  const inFlight = tokenRequests.get(scope);
  if (inFlight !== undefined) return inFlight;
  const request = requestTelemetryToken(scope).finally(() => tokenRequests.delete(scope));
  tokenRequests.set(scope, request);
  return request;
}

function clearFlushTimer(scope: string): void {
  const timer = timers.get(scope);
  if (timer === undefined) return;
  clearTimeout(timer);
  timers.delete(scope);
}

function scheduleFlush(scope: string): void {
  if (timers.has(scope)) return;
  timers.set(
    scope,
    setTimeout(() => {
      timers.delete(scope);
      void flushMediaDelivery(scope, false);
    }, flushDelayMs),
  );
}

async function submitDelivery(
  scope: string,
  snapshot: MediaDeliverySnapshot,
  keepalive: boolean,
): Promise<void> {
  const telemetryToken = await ensureTelemetryToken(scope);
  const response = await fetch(
    `/api/v1/public/albums/${encodeURIComponent(scope)}/analytics/media-delivery`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telemetry-token": telemetryToken.token,
      },
      body: JSON.stringify(snapshot),
      cache: "no-store",
      keepalive,
    },
  );
  if (response.status === 403) telemetryTokens.delete(scope);
  if (!response.ok) throw new Error(`telemetry ${response.status}`);
}

async function flushMediaDelivery(scope: string, keepalive: boolean): Promise<void> {
  const current = pending.get(scope);
  if (current === undefined) return;
  pending.delete(scope);
  clearFlushTimer(scope);
  try {
    await submitDelivery(scope, current.snapshot, keepalive);
  } catch {
    const newer = pending.get(scope);
    pending.set(scope, {
      snapshot: mergeDelivery(current.snapshot, newer?.snapshot ?? emptyMediaDeliverySnapshot()),
      events: current.events + (newer?.events ?? 0),
    });
    if (!keepalive) scheduleFlush(scope);
  }
}

function installLifecycleFlush(): void {
  if (lifecycleInstalled || typeof window === "undefined") return;
  lifecycleInstalled = true;
  window.addEventListener("pagehide", () => {
    for (const scope of pending.keys()) void flushMediaDelivery(scope, true);
  });
}

export function recordMediaDeliveryMetric(
  scope: string | undefined,
  metric: MediaDeliveryMetric,
  bytes = 0,
): void {
  if (typeof window === "undefined" || !validScope(scope)) return;
  installLifecycleFlush();
  void ensureTelemetryToken(scope).catch(() => undefined);
  const current = pending.get(scope) ?? {
    snapshot: emptyMediaDeliverySnapshot(),
    events: 0,
  };
  const next = {
    snapshot: accumulateMediaDelivery(current.snapshot, metric, bytes),
    events: current.events + 1,
  };
  pending.set(scope, next);
  if (next.events >= flushEventThreshold) {
    void flushMediaDelivery(scope, false);
    return;
  }
  scheduleFlush(scope);
}
