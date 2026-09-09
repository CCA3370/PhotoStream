import {
  type MediaDeliveryMetric,
  recordMediaDeliveryMetric,
} from "./media-delivery-telemetry";

// Content is keyed by immutable object identity, never by a temporary signature.
// Callers must obtain current media/download authorization before consuming it.
export interface MediaBlobIdentity {
  readonly cacheName: string;
  readonly key: string;
  readonly expectedBytes: number | null;
  readonly telemetryScope?: string;
}

export interface MediaBlobRequest extends MediaBlobIdentity {
  readonly sourceUrl: string;
  readonly refreshUrl?: () => Promise<string>;
}

export class ImageFetchError extends Error {
  constructor(readonly status: number) {
    super(`图片加载失败（${status}）`);
    this.name = "ImageFetchError";
  }
}

type Diagnostic = MediaDeliveryMetric;
const diagnostics: Partial<Record<Diagnostic, number>> = {};
let diagnosticsEnabled = false;
let diagnosticsInitialized = false;
declare global {
  interface Window {
    photostreamMediaCache?: {
      snapshot: typeof getMediaCacheDiagnostics;
      reset: () => void;
    };
  }
}
function initializeDiagnostics(): void {
  if (diagnosticsInitialized || typeof window === "undefined") return;
  diagnosticsInitialized = true;
  try {
    if (window.localStorage?.getItem("photostream:media-cache-debug") !== "1") return;
    diagnosticsEnabled = true;
    window.photostreamMediaCache = {
      snapshot: getMediaCacheDiagnostics,
      reset: () => {
        for (const key of Object.keys(diagnostics) as Diagnostic[]) delete diagnostics[key];
      },
    };
  } catch {
    /* Diagnostics never affect image availability. */
  }
}
export function setMediaCacheDiagnostics(enabled: boolean): void {
  diagnosticsEnabled = enabled;
}
export function getMediaCacheDiagnostics(): Readonly<Partial<Record<Diagnostic, number>>> {
  return { ...diagnostics };
}
export function recordMediaCacheDiagnostic(
  event: Diagnostic,
  telemetryScope?: string,
  bytes = 0,
): void {
  if (diagnosticsEnabled) {
    const increment = event === "networkBytes" ? Math.max(0, Math.floor(bytes)) : 1;
    diagnostics[event] = (diagnostics[event] ?? 0) + increment;
  }
  recordMediaDeliveryMetric(telemetryScope, event, bytes);
}

const inFlight = new Map<string, Promise<Blob>>();
const memory = new Map<string, { blob: Blob; cacheName: string }>();
const writes = new Map<string, Promise<void>>();
const mib = 1024 * 1024;
const memoryBudget = 64 * mib;
const diskBudgets = new Map<string, number>();
const fallbackDiskBudget = (name: string) => (name.includes("original") ? 128 : 64) * mib;

function identity(request: MediaBlobIdentity): string {
  return `${request.cacheName}\u0000${request.key}\u0000${request.expectedBytes}`;
}

function remember(request: MediaBlobIdentity, blob: Blob): void {
  const key = identity(request);
  memory.delete(key);
  if (blob.size > memoryBudget) return;
  memory.set(key, { blob, cacheName: request.cacheName });
  let total = [...memory.values()].reduce((sum, entry) => sum + entry.blob.size, 0);
  while (total > memoryBudget || memory.size > 256) {
    const oldest = memory.entries().next().value;
    if (oldest === undefined) break;
    total -= oldest[1].blob.size;
    memory.delete(oldest[0]);
  }
}

function cacheSupported(): boolean {
  return typeof window !== "undefined" && "caches" in window;
}

async function diskBudget(name: string): Promise<number> {
  const known = diskBudgets.get(name);
  if (known !== undefined) return known;
  let budget = fallbackDiskBudget(name);
  try {
    const quota = (await navigator.storage?.estimate())?.quota;
    if (quota !== undefined && quota > 0) budget = Math.min(budget, Math.floor(quota * 0.05));
  } catch {
    /* Storage estimation is optional. */
  }
  diskBudgets.set(name, budget);
  return budget;
}

export async function readMediaBlob(request: MediaBlobIdentity): Promise<Blob | null> {
  initializeDiagnostics();
  const existing = memory.get(identity(request));
  if (existing !== undefined) {
    remember(request, existing.blob);
    recentReads.set(request.key, Date.now());
    recordMediaCacheDiagnostic("memoryHit", request.telemetryScope, existing.blob.size);
    return existing.blob;
  }
  if (!cacheSupported()) return null;
  try {
    const cache = await caches.open(request.cacheName);
    const response = await cache.match(request.key);
    if (response === undefined) return null;
    const blob = await response.blob();
    if (
      blob.size === 0 ||
      (request.expectedBytes !== null && blob.size !== request.expectedBytes)
    ) {
      recordMediaCacheDiagnostic("sizeMismatch", request.telemetryScope);
      await cache.delete(request.key);
      return null;
    }
    remember(request, blob);
    recentReads.set(request.key, Date.now());
    recordMediaCacheDiagnostic("diskHit", request.telemetryScope, blob.size);
    return blob;
  } catch {
    recordMediaCacheDiagnostic("readFailure", request.telemetryScope);
    return null;
  }
}

interface DiskEntry {
  size: number;
  at: number;
}
const diskIndexes = new Map<string, Promise<Map<string, DiskEntry>>>();
const recentReads = new Map<string, number>();

async function diskIndex(cache: Cache, name: string): Promise<Map<string, DiskEntry>> {
  const existing = diskIndexes.get(name);
  if (existing !== undefined) return existing;
  const task = (async () => {
    const index = new Map<string, DiskEntry>();
    const keys = await cache.keys();
    // Read metadata once per session, with bounded I/O rather than rescanning on every photo.
    for (let offset = 0; offset < keys.length; offset += 16) {
      await Promise.all(
        keys.slice(offset, offset + 16).map(async (request) => {
          const response = await cache.match(request);
          if (response === undefined) return;
          const sizeHeader = response.headers.get("content-length");
          const size = sizeHeader === null ? (await response.blob()).size : Number(sizeHeader);
          index.set(request.url, {
            size: Number.isFinite(size) ? size : 0,
            at: Number(response.headers.get("x-photostream-cached-at") ?? 0),
          });
        }),
      );
    }
    return index;
  })();
  diskIndexes.set(name, task);
  try {
    return await task;
  } catch (error) {
    diskIndexes.delete(name);
    throw error;
  }
}

async function trimDisk(
  cache: Cache,
  name: string,
  budget: number,
  incoming: number,
  key: string,
  telemetryScope: string | undefined,
  forceOne = false,
): Promise<void> {
  const index = await diskIndex(cache, name);
  let total = incoming;
  for (const [url, entry] of index) if (url !== key) total += entry.size;
  if (total <= budget && !forceOne) return;
  const entries = [...index].sort(
    ([urlA, a], [urlB, b]) => (recentReads.get(urlA) ?? a.at) - (recentReads.get(urlB) ?? b.at),
  );
  for (const [url, entry] of entries) {
    if (total <= budget && !forceOne) break;
    if (url === key) continue;
    await cache.delete(url);
    index.delete(url);
    recentReads.delete(url);
    total -= entry.size;
    forceOne = false;
    recordMediaCacheDiagnostic("evicted", telemetryScope);
  }
}

export async function writeMediaBlob(request: MediaBlobIdentity, blob: Blob): Promise<void> {
  if (blob.size === 0 || (request.expectedBytes !== null && blob.size !== request.expectedBytes)) {
    recordMediaCacheDiagnostic("sizeMismatch", request.telemetryScope);
    return;
  }
  remember(request, blob);
  if (!cacheSupported()) return;
  // Serialize mutations per cache so two writes cannot both overrun the budget.
  const previous = writes.get(request.cacheName) ?? Promise.resolve();
  const task = previous.then(async () => {
    try {
      const budget = await diskBudget(request.cacheName);
      if (blob.size > budget) return;
      const cache = await caches.open(request.cacheName);
      await trimDisk(
        cache,
        request.cacheName,
        budget,
        blob.size,
        request.key,
        request.telemetryScope,
      );
      const headers = new Headers({
        "Content-Length": String(blob.size),
        "x-photostream-cached-at": String(Date.now()),
      });
      if (blob.type !== "") headers.set("Content-Type", blob.type);
      try {
        await cache.put(request.key, new Response(blob, { headers }));
      } catch (error) {
        if (!(error instanceof DOMException) || error.name !== "QuotaExceededError") throw error;
        recordMediaCacheDiagnostic("writeFailure", request.telemetryScope);
        // Evict only this media cache, then retry once; never clear shell or user data.
        await trimDisk(
          cache,
          request.cacheName,
          Math.max(blob.size, Math.floor(budget / 2)),
          blob.size,
          request.key,
          request.telemetryScope,
          true,
        );
        await cache.put(request.key, new Response(blob, { headers }));
      }
      (await diskIndex(cache, request.cacheName)).set(request.key, {
        size: blob.size,
        at: Date.now(),
      });
    } catch {
      recordMediaCacheDiagnostic("writeFailure", request.telemetryScope);
    }
  });
  writes.set(request.cacheName, task);
  await task;
  if (writes.get(request.cacheName) === task) writes.delete(request.cacheName);
}

export async function loadMediaBlob(request: MediaBlobRequest): Promise<Blob> {
  const key = identity(request);
  const pendingRequest = inFlight.get(key);
  if (pendingRequest !== undefined) {
    recordMediaCacheDiagnostic("joined", request.telemetryScope);
    return pendingRequest;
  }
  const task = (async () => {
    const cached = await readMediaBlob(request);
    if (cached !== null) return cached;
    const get = (url: string) => {
      recordMediaCacheDiagnostic("network", request.telemetryScope);
      return fetch(url, { cache: "default", credentials: "omit", mode: "cors" });
    };
    let response = await get(request.sourceUrl);
    if ((response.status === 401 || response.status === 403) && request.refreshUrl !== undefined) {
      await response.body?.cancel();
      const freshUrl = await request.refreshUrl();
      recordMediaCacheDiagnostic("refreshed", request.telemetryScope);
      response = await get(freshUrl);
    }
    if (!response.ok) throw new ImageFetchError(response.status);
    const blob = await response.blob();
    recordMediaCacheDiagnostic("networkBytes", request.telemetryScope, blob.size);
    if (blob.size === 0) throw new Error("图片内容为空，请稍后重试。");
    if (request.expectedBytes !== null && blob.size !== request.expectedBytes) {
      recordMediaCacheDiagnostic("sizeMismatch", request.telemetryScope);
      throw new Error("图片大小与记录不一致，请刷新相册后重试。");
    }
    // Persist before settling the shared task so a second consumer never races a write.
    await writeMediaBlob(request, blob);
    return blob;
  })();
  inFlight.set(key, task);
  try {
    return await task;
  } finally {
    if (inFlight.get(key) === task) inFlight.delete(key);
  }
}
