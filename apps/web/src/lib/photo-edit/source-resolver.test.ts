import { describe, expect, it, vi } from "vitest";

import { resolveMediaEditSource, resolveRemoteMediaEditSource } from "./source-resolver";

describe("resolveMediaEditSource", () => {
  it("never requests the remote original when a local original exists", async () => {
    const localBlob = new Blob(["local-original"], { type: "image/jpeg" });
    const requestRemote = vi.fn();
    const fetchRemote = vi.fn();

    const resolved = await resolveMediaEditSource("11111111-1111-4111-8111-111111111111", {
      findLocal: async () => ({ originalBlob: localBlob }),
      requestRemote,
      fetchRemote,
    });

    expect(resolved.sourceOrigin).toBe("local-original");
    expect(resolved.blob).toBe(localBlob);
    expect(requestRemote).not.toHaveBeenCalled();
    expect(fetchRemote).not.toHaveBeenCalled();
  });

  it("can explicitly fall back to the verified remote original after a local decode failure", async () => {
    const remoteBlob = new Blob(["remote-original"], { type: "image/jpeg" });
    const requestRemote = vi.fn(async () => ({
      url: "https://media.example.test/original.jpg?signature=test",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }));
    const fetchRemote = vi.fn(async () => new Response(remoteBlob, { status: 200 }));

    const resolved = await resolveRemoteMediaEditSource(
      "11111111-1111-4111-8111-111111111111",
      {
        findLocal: async () => ({ originalBlob: new Blob(["broken-local"]) }),
        requestRemote,
        fetchRemote,
      },
    );

    expect(resolved.sourceOrigin).toBe("remote-original");
    expect(await resolved.blob.text()).toBe("remote-original");
    expect(requestRemote).toHaveBeenCalledTimes(1);
    expect(fetchRemote).toHaveBeenCalledTimes(1);
  });

  it("falls back to the verified remote original when no local source exists", async () => {
    const remoteBlob = new Blob(["remote-original"], { type: "image/jpeg" });
    const requestRemote = vi.fn(async () => ({
      url: "https://media.example.test/original.jpg?signature=test",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }));
    const fetchRemote = vi.fn(async () => new Response(remoteBlob, { status: 200 }));

    const resolved = await resolveMediaEditSource("11111111-1111-4111-8111-111111111111", {
      findLocal: async () => null,
      requestRemote,
      fetchRemote,
    });

    expect(resolved.sourceOrigin).toBe("remote-original");
    expect(await resolved.blob.text()).toBe("remote-original");
    expect(requestRemote).toHaveBeenCalledTimes(1);
    expect(fetchRemote).toHaveBeenCalledTimes(1);
  });
});
