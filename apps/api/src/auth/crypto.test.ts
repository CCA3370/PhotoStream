import { describe, expect, it } from "vitest";

import {
  createCsrfToken,
  createSessionToken,
  createTemporaryPassword,
  hashSessionToken,
  safeEqual,
} from "./crypto.js";

describe("authentication cryptography", () => {
  it("creates opaque session tokens and stores only deterministic hashes", () => {
    const token = createSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    const firstHash = hashSessionToken(token, "s".repeat(32));
    const rotatedHash = hashSessionToken(token, "r".repeat(32));
    expect(firstHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(firstHash).not.toContain(token);
    expect(rotatedHash).not.toBe(firstHash);
  });

  it("binds CSRF values to the session token", () => {
    const secret = "c".repeat(32);
    const first = createCsrfToken(secret, "session-one");
    const second = createCsrfToken(secret, "session-two");
    expect(safeEqual(first, first)).toBe(true);
    expect(safeEqual(first, second)).toBe(false);
    expect(safeEqual(first, `${first}x`)).toBe(false);
  });

  it("generates a one-time password with sufficient entropy-bearing length", () => {
    const password = createTemporaryPassword();
    expect(password).toHaveLength(20);
    expect(createTemporaryPassword()).not.toBe(password);
  });
});
