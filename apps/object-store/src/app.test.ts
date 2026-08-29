import { once } from "node:events";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  signLocalMultipartCompleteUrl,
  signLocalMultipartPartUrl,
  signLocalObjectUrl,
} from "@photostream/local-object-protocol";
import { afterEach, describe, expect, it } from "vitest";

import { createObjectStoreServer } from "./app.js";

const secret = "object-store-test-secret-123456789012345";
const appOrigin = "http://localhost:3000";
const servers: ReturnType<typeof createObjectStoreServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

async function fixture() {
  const storageRoot = await mkdtemp(join(tmpdir(), "photostream-objects-"));
  const server = createObjectStoreServer({ appOrigin, secret, storageRoot });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Expected TCP address");
  return { storageRoot, baseUrl: `http://127.0.0.1:${address.port}` };
}

describe("local object store", () => {
  it("accepts one exact PUT, exposes HEAD and forbids overwrite", async () => {
    const { storageRoot, baseUrl } = await fixture();
    const body = new Uint8Array([1, 2, 3, 4]);
    const key = "media/albums/a/photos/m/480.webp";
    const expiresAt = new Date(Date.now() + 60_000);
    const putUrl = signLocalObjectUrl({
      baseUrl,
      key,
      method: "PUT",
      secret,
      expiresAt,
      contentType: "image/webp",
      contentLength: body.byteLength,
    });
    const first = await fetch(putUrl, {
      method: "PUT",
      headers: { "content-type": "image/webp", origin: appOrigin },
      body,
    });
    expect(first.status).toBe(201);
    expect(await readFile(join(storageRoot, key))).toEqual(Buffer.from(body));

    const second = await fetch(putUrl, {
      method: "PUT",
      headers: { "content-type": "image/webp", origin: appOrigin },
      body,
    });
    expect(second.status).toBe(409);

    const head = await fetch(
      signLocalObjectUrl({ baseUrl, key, method: "HEAD", secret, expiresAt }),
      { method: "HEAD" },
    );
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("4");
    expect(head.headers.get("content-type")).toBe("image/webp");
  });

  it("rejects wrong origins, lengths and signatures without keeping partial objects", async () => {
    const { storageRoot, baseUrl } = await fixture();
    const key = "media/albums/a/photos/m/960.webp";
    const url = signLocalObjectUrl({
      baseUrl,
      key,
      method: "PUT",
      secret,
      expiresAt: new Date(Date.now() + 60_000),
      contentType: "image/webp",
      contentLength: 4,
    });
    expect(
      (
        await fetch(url, {
          method: "PUT",
          headers: { "content-type": "image/webp", origin: "https://attacker.example" },
          body: new Uint8Array([1, 2, 3, 4]),
        })
      ).status,
    ).toBe(403);

    expect(
      (
        await fetch(url, {
          method: "PUT",
          headers: { "content-type": "image/webp", origin: appOrigin },
          body: new Uint8Array([1, 2, 3]),
        })
      ).status,
    ).toBe(400);
    await expect(readFile(join(storageRoot, key))).rejects.toThrow();

    const tampered = new URL(url);
    tampered.pathname = "/objects/media/albums/a/photos/m/other.webp";
    expect((await fetch(tampered, { method: "PUT", body: new Uint8Array(4) })).status).toBe(403);
  });

  it("supports bounded byte ranges for signed reads", async () => {
    const { baseUrl } = await fixture();
    const key = "media/albums/a/videos/v/source.mp4";
    const expiresAt = new Date(Date.now() + 60_000);
    const body = new Uint8Array([0, 1, 2, 3, 4, 5]);
    await fetch(
      signLocalObjectUrl({
        baseUrl,
        key,
        method: "PUT",
        secret,
        expiresAt,
        contentType: "video/mp4",
        contentLength: body.byteLength,
      }),
      { method: "PUT", headers: { "content-type": "video/mp4" }, body },
    );
    const response = await fetch(
      signLocalObjectUrl({ baseUrl, key, method: "GET", secret, expiresAt }),
      { headers: { range: "bytes=2-4" } },
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 2-4/6");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([2, 3, 4]));
  });

  it("deletes an exact signed object idempotently", async () => {
    const { storageRoot, baseUrl } = await fixture();
    const key = "media/albums/a/photos/delete/original.jpg";
    const expiresAt = new Date(Date.now() + 60_000);
    const body = new Uint8Array([1, 2, 3]);
    await fetch(
      signLocalObjectUrl({
        baseUrl,
        key,
        method: "PUT",
        secret,
        expiresAt,
        contentType: "image/jpeg",
        contentLength: body.byteLength,
      }),
      { method: "PUT", headers: { "content-type": "image/jpeg" }, body },
    );
    const deleteUrl = signLocalObjectUrl({
      baseUrl,
      key,
      method: "DELETE",
      secret,
      expiresAt,
    });
    expect((await fetch(deleteUrl, { method: "DELETE" })).status).toBe(204);
    expect((await fetch(deleteUrl, { method: "DELETE" })).status).toBe(204);
    await expect(readFile(join(storageRoot, key))).rejects.toThrow();
  });

  it("composes immutable multipart parts without proxying bytes through the API", async () => {
    const { storageRoot, baseUrl } = await fixture();
    const uploadId = "019d43f4-7d20-7000-8000-000000000002";
    const expiresAt = new Date(Date.now() + 60_000);
    const missingPart = await fetch(
      signLocalMultipartCompleteUrl({
        baseUrl,
        uploadId,
        objectKey: "media/albums/a/photos/m/missing.jpg",
        contentType: "image/jpeg",
        manifest: [{ partNumber: 1, etag: "a".repeat(64) }],
        secret,
        expiresAt,
      }),
      { method: "POST" },
    );
    expect(missingPart.status).toBe(409);
    const parts = [new Uint8Array([1, 2]), new Uint8Array([3, 4]), new Uint8Array([5])];
    const manifest: { partNumber: number; etag: string }[] = [];
    for (const [index, body] of parts.entries()) {
      const response = await fetch(
        signLocalMultipartPartUrl({
          baseUrl,
          uploadId,
          partNumber: index + 1,
          secret,
          expiresAt,
          contentType: "image/jpeg",
          contentLength: body.byteLength,
        }),
        { method: "PUT", headers: { "content-type": "image/jpeg", origin: appOrigin }, body },
      );
      expect(response.status).toBe(201);
      const etag = response.headers.get("etag");
      expect(etag).toMatch(/^[a-f0-9]{64}$/u);
      manifest.push({ partNumber: index + 1, etag: etag as string });
    }
    const key = "media/albums/a/photos/m/original.jpg";
    const completeUrl = signLocalMultipartCompleteUrl({
      baseUrl,
      uploadId,
      objectKey: key,
      contentType: "image/jpeg",
      manifest,
      secret,
      expiresAt,
    });
    expect((await fetch(completeUrl, { method: "POST" })).status).toBe(201);
    expect(await readFile(join(storageRoot, key))).toEqual(Buffer.from([1, 2, 3, 4, 5]));
    expect((await fetch(completeUrl, { method: "POST" })).status).toBe(200);
  });
});
