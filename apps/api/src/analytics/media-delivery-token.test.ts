import { describe, expect, it } from "vitest";

import { issueMediaDeliveryToken, verifyMediaDeliveryToken } from "./media-delivery-token.js";

const secret = "telemetry-secret-that-is-long-enough-for-tests";
const slug = "public-album-slug";
const visitorId = "visitor_token_abcdefghijklmnopqrstuvwxyz012345";
const now = new Date("2026-09-15T12:00:00.000Z");

describe("media delivery telemetry token", () => {
  it("binds a short-lived token to both album and anonymous visitor", () => {
    const issued = issueMediaDeliveryToken(secret, slug, visitorId, now);

    expect(verifyMediaDeliveryToken(secret, slug, visitorId, issued.token, now)).toBe(true);
    expect(verifyMediaDeliveryToken(secret, "another-album", visitorId, issued.token, now)).toBe(false);
    expect(
      verifyMediaDeliveryToken(secret, slug, `${visitorId}-other`, issued.token, now),
    ).toBe(false);
    expect(
      verifyMediaDeliveryToken(secret, slug, visitorId, issued.token, new Date(now.getTime() + 301_000)),
    ).toBe(false);
  });

  it("rejects malformed and tampered tokens", () => {
    const issued = issueMediaDeliveryToken(secret, slug, visitorId, now);
    const tampered = `${issued.token.slice(0, -1)}${issued.token.endsWith("a") ? "b" : "a"}`;

    expect(verifyMediaDeliveryToken(secret, slug, visitorId, "invalid", now)).toBe(false);
    expect(verifyMediaDeliveryToken(secret, slug, visitorId, tampered, now)).toBe(false);
  });
});
