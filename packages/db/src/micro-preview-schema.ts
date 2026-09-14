import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const mediaMicroPreviews = pgTable(
  "media_micro_previews",
  {
    mediaId: uuid("media_id").primaryKey(),
    albumId: uuid("album_id").notNull(),
    objectKey: varchar("object_key", { length: 512 }).notNull(),
    format: varchar("format", { length: 16 }).notNull(),
    contentType: varchar("content_type", { length: 80 }).notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    expectedBytes: bigint("expected_bytes", { mode: "number" }).notNull(),
    bytes: bigint("bytes", { mode: "number" }),
    etag: varchar("etag", { length: 128 }),
    verified: boolean("verified").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("media_micro_previews_object_key_unique").on(table.objectKey),
    index("media_micro_previews_album_verified_idx").on(
      table.albumId,
      table.verified,
      table.mediaId,
    ),
  ],
);
