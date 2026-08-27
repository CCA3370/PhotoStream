import { randomUUID } from "node:crypto";

import { normalizeUsername, usernameSchema } from "@photostream/contracts";
import { createDatabase, createPool } from "@photostream/db";
import { createTemporaryPassword, safeEqual } from "../auth/crypto.js";
import { argon2PasswordHasher, assertPasswordPolicy } from "../auth/password.js";
import { PostgresAuthStore } from "../auth/postgres-store.js";
import { loadConfig } from "../config.js";

const config = loadConfig(process.env);
const providedToken = process.env.BOOTSTRAP_ADMIN_TOKEN;
if (
  config.BOOTSTRAP_ADMIN_TOKEN === undefined ||
  providedToken === undefined ||
  !safeEqual(config.BOOTSTRAP_ADMIN_TOKEN, providedToken)
) {
  throw new Error("BOOTSTRAP_ADMIN_TOKEN is required and must match configuration");
}

const username = usernameSchema.parse(process.argv[2] ?? "admin");
const displayName = (process.argv[3] ?? "系统管理员").trim();
if (displayName.length === 0 || displayName.length > 80) {
  throw new Error("Display name must contain 1 to 80 characters");
}

const temporaryPassword = createTemporaryPassword();
const normalizedUsername = normalizeUsername(username);
assertPasswordPolicy(temporaryPassword, normalizedUsername);
const passwordHash = await argon2PasswordHasher.hash(temporaryPassword);
const pool = createPool(config.DATABASE_URL);

try {
  const store = new PostgresAuthStore(createDatabase(pool));
  const user = await store.createBootstrapAdmin({
    username,
    normalizedUsername,
    displayName,
    role: "admin",
    passwordHash,
    requestId: `bootstrap-${randomUUID()}`,
  });
  process.stdout.write(
    `${[
      `Created administrator ${user.username}.`,
      `Temporary password (shown once): ${temporaryPassword}`,
      "The account must change this password at first login.",
    ].join("\n")}\n`,
  );
} finally {
  await pool.end();
}
