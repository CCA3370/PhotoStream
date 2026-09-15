import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const tokenTtlMs = 5 * 60 * 1_000;

function signature(secret: string, slug: string, visitorId: string, expiresAt: number, nonce: string): Buffer {
  return createHmac("sha256", secret)
    .update(`${slug}\n${visitorId}\n${expiresAt}\n${nonce}`, "utf8")
    .digest();
}

export interface MediaDeliveryToken {
  readonly token: string;
  readonly expiresAt: string;
}

export function issueMediaDeliveryToken(
  secret: string,
  slug: string,
  visitorId: string,
  now = new Date(),
): MediaDeliveryToken {
  const expiresAt = now.getTime() + tokenTtlMs;
  const nonce = randomBytes(18).toString("base64url");
  const mac = signature(secret, slug, visitorId, expiresAt, nonce).toString("base64url");
  return {
    token: `${expiresAt.toString(36)}.${nonce}.${mac}`,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

export function verifyMediaDeliveryToken(
  secret: string,
  slug: string,
  visitorId: string,
  token: string,
  now = new Date(),
): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [encodedExpiry, nonce, encodedMac] = parts;
  if (encodedExpiry === undefined || nonce === undefined || encodedMac === undefined) return false;
  if (!/^[a-z0-9]+$/u.test(encodedExpiry) || !/^[A-Za-z0-9_-]{20,64}$/u.test(nonce)) return false;

  const expiresAt = Number.parseInt(encodedExpiry, 36);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now.getTime()) return false;
  if (expiresAt > now.getTime() + tokenTtlMs + 30_000) return false;

  let provided: Buffer;
  try {
    provided = Buffer.from(encodedMac, "base64url");
  } catch {
    return false;
  }
  const expected = signature(secret, slug, visitorId, expiresAt, nonce);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
