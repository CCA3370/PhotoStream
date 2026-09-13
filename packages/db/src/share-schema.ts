import { index, integer, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

import { albums, media } from "./schema.js";

export const photoShares = pgTable(
  "photo_shares",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    albumId: uuid("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => media.id, { onDelete: "cascade" }),
    accessVersion: integer("access_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("photo_shares_media_idx").on(table.mediaId)],
);
