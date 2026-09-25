import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { albums } from "./schema.js";

export const albumDeletionErrors = pgTable(
  "album_deletion_errors",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    albumId: uuid("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    source: varchar("source", { length: 40 }).notNull(),
    stage: varchar("stage", { length: 80 }).notNull(),
    operation: varchar("operation", { length: 120 }).notNull(),
    code: varchar("code", { length: 200 }),
    message: text("message").notNull(),
    providerRequestId: varchar("provider_request_id", { length: 256 }),
    httpStatus: integer("http_status"),
    attempt: integer("attempt").notNull().default(1),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("album_deletion_errors_album_time_idx").on(table.albumId, table.occurredAt)],
);
