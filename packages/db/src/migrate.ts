import { fileURLToPath } from "node:url";

import { createPool, migrateDatabase } from "./index.js";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error("DATABASE_URL is required");
}

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const pool = createPool(databaseUrl);

try {
  await migrateDatabase(pool, migrationsFolder);
  process.stdout.write("Database migrations completed.\n");
} finally {
  await pool.end();
}
