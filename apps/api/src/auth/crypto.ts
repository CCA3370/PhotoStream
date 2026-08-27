import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

const temporaryPasswordAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token, "utf8").digest("hex");
}

export function createCsrfToken(secret: string, sessionToken: string): string {
  return createHmac("sha256", secret).update(sessionToken, "utf8").digest("base64url");
}

export function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function createTemporaryPassword(length = 20): string {
  let password = "";
  for (let index = 0; index < length; index += 1) {
    password += temporaryPasswordAlphabet[randomInt(temporaryPasswordAlphabet.length)];
  }
  return password;
}
