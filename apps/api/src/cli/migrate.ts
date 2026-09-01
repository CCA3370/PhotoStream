import { resolve } from "node:path";

import { createPool, migrateDatabase } from "@photostream/db";

const databaseUrl = process.env.DATABASE_URL;
const migrationsFolder = process.env.MIGRATIONS_FOLDER;

if (databaseUrl === undefined || !databaseUrl.startsWith("postgresql://")) {
  throw new Error("DATABASE_URL must be a PostgreSQL URL");
}
if (migrationsFolder === undefined || !migrationsFolder.startsWith("/")) {
  throw new Error("MIGRATIONS_FOLDER must be an absolute path");
}

const pool = createPool(databaseUrl);
try {
  await migrateDatabase(pool, resolve(migrationsFolder));
  process.stdout.write("Database migrations completed.\n");
} finally {
  await pool.end();
}
