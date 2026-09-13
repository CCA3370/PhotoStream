import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class MemoryCache {
  readonly entries = new Map<string, Response>();
  put = vi.fn(async (key: Request | string, response: Response) => {
    this.entries.set(typeof key === "string" ? key : key.url, response.clone());
  });
  async match(key: Request | string) {
    return this.entries.get(typeof key === "string" ? key : key.url)?.clone();
  }
  async keys() {
    return [...this.entries.keys()].map((key) => new Request(key));
  }
  async delete(key: Request | string) {
    return this.entries.delete(typeof key === "string" ? key : key.url);
  }
}

const photo = {
  cacheName: "photostream-derived-images-v1",
  key: "https://app.test/cache/photo/1920",
  expectedBytes: 5,
  sourceUrl: "https://cdn.test/photo?auth_key=first",
};
let cache: MemoryCache;
let network: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules();
  cache = new MemoryCache();
  const storage = { open: async () => cache };
  vi.stubGlobal("window", { caches: storage, location: { origin: "https://app.test" } });
  vi.stubGlobal("caches", storage);
  vi.stubGlobal("navigator", { storage: { estimate: async () => ({ quota: 1024 * 1024 }) } });
  network = vi.fn(async () => new Response(new Blob(["photo"], { type: "image/webp" })));
  vi.stubGlobal("fetch", network);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("media body reuse", () => {
  it("coalesces simultaneous view/download and ignores rotating signatures", async () => {
    const { loadMediaBlob } = await import("./media-blob-cache");
    const [view, download] = await Promise.all([
      loadMediaBlob(photo),
      loadMediaBlob({ ...photo, sourceUrl: "https://cdn.test/photo?auth_key=second" }),
    ]);
    expect(await view.text()).toBe("photo");
    expect(download).toBe(view);
    expect(network).toHaveBeenCalledTimes(1);
    expect(network.mock.calls[0]?.[1]).toMatchObject({
      cache: "default",
      credentials: "omit",
      mode: "cors",
    });
    await loadMediaBlob(photo);
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("reuses persistent bytes after module reload", async () => {
    await (await import("./media-blob-cache")).loadMediaBlob(photo);
    vi.resetModules();
    await (await import("./media-blob-cache")).loadMediaBlob({
      ...photo,
      sourceUrl: "https://cdn.test/photo?auth_key=new",
    });
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("cache-only probes never request a missing photo", async () => {
    const { readCachedDerivedImage } = await import("./derived-image-cache");
    expect(
      await readCachedDerivedImage({
        scope: "album",
        mediaId: "neighbor",
        kind: "photo_1920",
        bytes: 5,
      }),
    ).toBeNull();
    expect(network).not.toHaveBeenCalled();
  });

  it("rechecks a failed signature once and joins the refresh", async () => {
    network.mockResolvedValueOnce(new Response(null, { status: 403 }));
    const refreshUrl = vi.fn(async () => "https://cdn.test/fresh");
    const { loadMediaBlob } = await import("./media-blob-cache");
    await Promise.all([
      loadMediaBlob({ ...photo, refreshUrl }),
      loadMediaBlob({ ...photo, refreshUrl }),
    ]);
    expect(refreshUrl).toHaveBeenCalledTimes(1);
    expect(network).toHaveBeenCalledTimes(2);
  });

  it("recovers when a newly published photo briefly misses at the CDN edge", async () => {
    vi.useFakeTimers();
    network.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const refreshUrl = vi.fn(async () => "https://cdn.test/fresh");
    const { loadMediaBlob } = await import("./media-blob-cache");
    const pending = loadMediaBlob({ ...photo, refreshUrl });
    await vi.runAllTimersAsync();
    const blob = await pending;
    expect(await blob.text()).toBe("photo");
    expect(refreshUrl).toHaveBeenCalledTimes(1);
    expect(network).toHaveBeenCalledTimes(2);
    expect(network.mock.calls[1]?.[1]).toMatchObject({ cache: "no-store" });
  });

  it("bounds retries for a persistently missing resource", async () => {
    vi.useFakeTimers();
    network.mockResolvedValue(new Response(null, { status: 404 }));
    const refreshUrl = vi.fn(async () => "https://cdn.test/fresh");
    const { loadMediaBlob } = await import("./media-blob-cache");
    const pending = loadMediaBlob({ ...photo, refreshUrl });
    const rejected = expect(pending).rejects.toMatchObject({ status: 404 });
    await vi.runAllTimersAsync();
    await rejected;
    expect(refreshUrl).toHaveBeenCalledTimes(3);
    expect(network).toHaveBeenCalledTimes(4);
  });

  it("does not retry a missing resource without a refresh path", async () => {
    network.mockResolvedValue(new Response(null, { status: 404 }));
    const { loadMediaBlob } = await import("./media-blob-cache");
    await expect(loadMediaBlob(photo)).rejects.toMatchObject({ status: 404 });
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("refreshes rejected authorization only once", async () => {
    network.mockResolvedValue(new Response(null, { status: 403 }));
    const refreshUrl = vi.fn(async () => "https://cdn.test/fresh");
    const { loadMediaBlob } = await import("./media-blob-cache");
    await expect(loadMediaBlob({ ...photo, refreshUrl })).rejects.toMatchObject({ status: 403 });
    expect(refreshUrl).toHaveBeenCalledTimes(1);
    expect(network).toHaveBeenCalledTimes(2);
  });

  it("rejects mismatched bytes instead of caching corrupted content", async () => {
    network.mockResolvedValue(new Response("bad"));
    const { loadMediaBlob } = await import("./media-blob-cache");
    await expect(loadMediaBlob(photo)).rejects.toThrow("大小");
    expect(cache.entries.size).toBe(0);
  });

  it("continues using memory when persistent storage is unavailable", async () => {
    cache.put.mockRejectedValue(new DOMException("denied", "SecurityError"));
    const { loadMediaBlob, setMediaCacheDiagnostics, getMediaCacheDiagnostics } = await import(
      "./media-blob-cache"
    );
    setMediaCacheDiagnostics(true);
    await loadMediaBlob(photo);
    await loadMediaBlob(photo);
    expect(network).toHaveBeenCalledTimes(1);
    expect(getMediaCacheDiagnostics().writeFailure).toBe(1);
  });

  it("retries quota errors once without deleting unrelated cache namespaces", async () => {
    cache.put.mockRejectedValueOnce(new DOMException("full", "QuotaExceededError"));
    await (await import("./media-blob-cache")).loadMediaBlob(photo);
    expect(cache.put).toHaveBeenCalledTimes(2);
    expect(cache.entries.size).toBe(1);
  });

  it("protects a displayed object URL while other images enter the cache", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const derived = await import("./derived-image-cache");
    const request = {
      scope: "album",
      mediaId: "displayed",
      kind: "photo_1920" as const,
      bytes: 5,
      sourceUrl: photo.sourceUrl,
    };
    const release = derived.retainDerivedImage(request);
    await derived.loadDerivedImage(request);
    const displayed = derived.getWarmDerivedImageUrl(request);
    for (let i = 0; i < 24; i++)
      await derived.loadDerivedImage({ ...request, mediaId: `other-${i}` });
    expect(derived.getWarmDerivedImageUrl(request)).toBe(displayed);
    expect(revoke.mock.calls.some(([url]) => url === displayed)).toBe(false);
    release();
  });

  it("keeps a shared fetch alive when only the speculative consumer cancels", async () => {
    cache = new MemoryCache();
    const storage = { open: async () => cache };
    vi.stubGlobal("window", { caches: storage, location: { origin: "https://app.test" } });
    vi.stubGlobal("caches", storage);
    let resolveNetwork: ((response: Response) => void) | undefined;
    let sharedSignal: AbortSignal | undefined;
    network.mockImplementation(
      async (_url: string, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          sharedSignal = init?.signal instanceof AbortSignal ? init.signal : undefined;
          resolveNetwork = resolve;
        }),
    );
    const { loadMediaBlob } = await import("./media-blob-cache");
    const controller = new AbortController();
    const request = { ...photo, key: `${photo.key}/shared`, expectedBytes: null };
    const speculative = loadMediaBlob({ ...request, signal: controller.signal });
    const display = loadMediaBlob(request);
    await Promise.resolve();
    controller.abort();
    await expect(speculative).rejects.toMatchObject({ name: "AbortError" });
    expect(sharedSignal?.aborted).toBe(false);
    resolveNetwork?.(new Response(new Blob(["photo"], { type: "image/webp" })));
    await expect(display).resolves.toBeInstanceOf(Blob);
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("aborts the underlying fetch when the last consumer cancels", async () => {
    cache = new MemoryCache();
    const storage = { open: async () => cache };
    vi.stubGlobal("window", { caches: storage, location: { origin: "https://app.test" } });
    vi.stubGlobal("caches", storage);
    let sharedSignal: AbortSignal | undefined;
    let signalNetworkStarted: (() => void) | undefined;
    const networkStarted = new Promise<void>((resolve) => {
      signalNetworkStarted = resolve;
    });
    network.mockImplementation(
      async (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          sharedSignal = init?.signal instanceof AbortSignal ? init.signal : undefined;
          signalNetworkStarted?.();
          sharedSignal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    const { loadMediaBlob } = await import("./media-blob-cache");
    const controller = new AbortController();
    const pending = loadMediaBlob({
      ...photo,
      key: `${photo.key}/cancelled`,
      expectedBytes: null,
      signal: controller.signal,
    });
    await networkStarted;
    expect(sharedSignal).toBeDefined();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(sharedSignal?.aborted).toBe(true);
  });
});
