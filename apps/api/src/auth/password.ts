import argon2 from "argon2";

import { AppError } from "../errors.js";
import type { PasswordHasher } from "./types.js";

const commonPasswords = new Set([
  "123456789012",
  "password1234",
  "qwerty123456",
  "admin123456",
  "photostream",
]);

export const argon2PasswordHasher: PasswordHasher = {
  async hash(password) {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65_536,
      timeCost: 3,
      parallelism: 1,
    });
  },
  async verify(hash, password) {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  },
};

export function assertPasswordPolicy(password: string, normalizedUsername: string): void {
  const normalizedPassword = password.normalize("NFKC").toLocaleLowerCase("en-US");
  if (
    password.length < 12 ||
    password.length > 128 ||
    normalizedPassword === normalizedUsername ||
    commonPasswords.has(normalizedPassword)
  ) {
    throw new AppError({
      code: "AUTH_PASSWORD_POLICY",
      message: "密码至少 12 位，且不能是常见弱密码或与用户名相同",
      statusCode: 400,
    });
  }
}
