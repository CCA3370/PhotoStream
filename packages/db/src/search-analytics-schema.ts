import {
  bigint,
  bigserial,
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

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

export const mediaDeliveryEvents = pgTable(
  "media_delivery_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    albumId: uuid("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    memoryHits: integer("memory_hits").notNull().default(0),
    memoryBytes: bigint("memory_bytes", { mode: "number" }).notNull().default(0),
    diskHits: integer("disk_hits").notNull().default(0),
    diskBytes: bigint("disk_bytes", { mode: "number" }).notNull().default(0),
    joinedRequests: integer("joined_requests").notNull().default(0),
    networkRequests: integer("network_requests").notNull().default(0),
    networkBytes: bigint("network_bytes", { mode: "number" }).notNull().default(0),
    readFailures: integer("read_failures").notNull().default(0),
    writeFailures: integer("write_failures").notNull().default(0),
    sizeMismatches: integer("size_mismatches").notNull().default(0),
    refreshedUrls: integer("refreshed_urls").notNull().default(0),
    evictions: integer("evictions").notNull().default(0),
    directFallbacks: integer("direct_fallbacks").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("media_delivery_events_album_created_idx").on(table.albumId, table.createdAt),
    index("media_delivery_events_retention_idx").on(table.createdAt),
  ],
);
