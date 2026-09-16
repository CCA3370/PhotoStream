import { describe, expect, it } from "vitest";

import { issueMediaDeliveryToken, verifyMediaDeliveryToken } from "./media-delivery-token.js";

const secret = "telemetry-secret-that-is-long-enough-for-tests";
const slug = "public-album-slug";
const visitorId = "visitor_token_abcdefghijklmnopqrstuvwxyz012345";
const now = new Date("2026-09-15T12:00:00.000Z");
const base64UrlAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function tokenParts(token: string): readonly [string, string, string] {
  const [expiry, nonce, mac] = token.split(".");
  if (expiry === undefined || nonce === undefined || mac === undefined) {
    throw new Error("issued token has an unexpected format");
  }
  return [expiry, nonce, mac];
}

function equivalentNonCanonicalMac(mac: string): string {
  const decoded = Buffer.from(mac, "base64url");
  const prefix = mac.slice(0, -1);
  const canonicalLast = mac.at(-1);
  for (const candidateLast of base64UrlAlphabet) {
    if (candidateLast === canonicalLast) continue;
    const candidate = `${prefix}${candidateLast}`;
    if (Buffer.from(candidate, "base64url").equals(decoded)) return candidate;
  }
  throw new Error("could not construct an equivalent non-canonical base64url MAC");
}

describe("media delivery telemetry token", () => {
  it("binds a short-lived token to both album and anonymous visitor", () => {
    const issued = issueMediaDeliveryToken(secret, slug, visitorId, now);

    expect(verifyMediaDeliveryToken(secret, slug, visitorId, issued.token, now)).toBe(true);
    expect(verifyMediaDeliveryToken(secret, "another-album", visitorId, issued.token, now)).toBe(
      false,
    );
    expect(verifyMediaDeliveryToken(secret, slug, `${visitorId}-other`, issued.token, now)).toBe(
      false,
    );
    expect(
      verifyMediaDeliveryToken(
        secret,
        slug,
        visitorId,
        issued.token,
        new Date(now.getTime() + 301_000),
      ),
    ).toBe(false);
  });

  it("rejects malformed and tampered tokens", () => {
    const issued = issueMediaDeliveryToken(secret, slug, visitorId, now);
    const [expiry, nonce, mac] = tokenParts(issued.token);
    const tamperedMac = `${mac.startsWith("A") ? "B" : "A"}${mac.slice(1)}`;
    const tampered = `${expiry}.${nonce}.${tamperedMac}`;

    expect(verifyMediaDeliveryToken(secret, slug, visitorId, "invalid", now)).toBe(false);
    expect(verifyMediaDeliveryToken(secret, slug, visitorId, tampered, now)).toBe(false);
  });

  it("rejects equivalent non-canonical base64url MAC encodings", () => {
    const issued = issueMediaDeliveryToken(secret, slug, visitorId, now);
    const [expiry, nonce, mac] = tokenParts(issued.token);
    const nonCanonical = `${expiry}.${nonce}.${equivalentNonCanonicalMac(mac)}`;

    expect(Buffer.from(nonCanonical.split(".")[2] ?? "", "base64url")).toEqual(
      Buffer.from(mac, "base64url"),
    );
    expect(verifyMediaDeliveryToken(secret, slug, visitorId, nonCanonical, now)).toBe(false);
  });
});
