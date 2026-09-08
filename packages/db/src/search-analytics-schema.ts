import { bigserial, index, pgEnum, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

import { albums } from "./schema.js";

export const searchUsageMethodEnum = pgEnum("search_usage_method", [
  "number",
  "attributes",
  "face",
]);

export const searchUsageEvents = pgTable(
  "search_usage_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    albumId: uuid("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    method: searchUsageMethodEnum("method").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("search_usage_events_album_created_idx").on(table.albumId, table.createdAt),
    index("search_usage_events_method_created_idx").on(table.method, table.createdAt),
  ],
);
