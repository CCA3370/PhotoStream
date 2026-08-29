import { describe, expect, it } from "vitest";

import { BibCrypto } from "./crypto.js";

const crypto = new BibCrypto({
  dataKey: Buffer.alloc(32, 7).toString("base64url"),
  searchKey: "search-key-for-bib-tests-must-be-long-enough",
  keyVersion: "v1",
});

describe("BibCrypto", () => {
  it("uses authenticated album/media/tag binding without storing plaintext", () => {
    const input = {
      albumId: "019d0000-0000-7000-8000-000000000001",
      mediaId: "019d0000-0000-7000-8000-000000000002",
      tagId: "019d0000-0000-7000-8000-000000000003",
      number: "001234",
    };
    const encrypted = crypto.encrypt(input);
    expect(JSON.stringify(encrypted)).not.toContain(input.number);
    expect(crypto.decrypt({ ...input, ...encrypted })).toBe(input.number);
    expect(() =>
      crypto.decrypt({ ...input, ...encrypted, albumId: "019d0000-0000-7000-8000-000000000099" }),
    ).toThrow();
  });

  it("keeps blind indexes deterministic within an album and isolated across albums", () => {
    expect(crypto.blindIndex("album-one", "001234")).toBe(crypto.blindIndex("album-one", "001234"));
    expect(crypto.blindIndex("album-one", "001234")).not.toBe(
      crypto.blindIndex("album-two", "001234"),
    );
  });

  it("uses a keyed domain-separated digest for idempotency records", () => {
    const request = { mediaId: "019d0000-0000-7000-8000-000000000002", number: "001234" };
    const digest = crypto.requestHash(request);
    expect(digest).toHaveLength(64);
    expect(digest).not.toContain(request.number);
    expect(crypto.requestHash(request)).toBe(digest);
  });
});
