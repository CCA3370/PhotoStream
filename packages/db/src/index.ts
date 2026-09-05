import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import * as featuredSchema from "./featured-schema.js";
import * as likesSchema from "./likes-schema.js";
import * as coreSchema from "./schema.js";

export const schema = { ...coreSchema, ...likesSchema, ...featuredSchema };

export type Database = ReturnType<typeof createDatabase>;

export function createPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    application_name: "photostream-api",
  });
}

export function createDatabase(pool: Pool) {
  return drizzle(pool, { schema });
}

export async function migrateDatabase(pool: Pool, migrationsFolder: string): Promise<void> {
  await migrate(createDatabase(pool), { migrationsFolder });
}
