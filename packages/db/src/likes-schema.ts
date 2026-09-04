import { sql } from "drizzle-orm";
import { index, pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

import { media } from "./schema.js";

export const mediaLikes = pgTable(
  "media_likes",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => media.id, { onDelete: "cascade" }),
    visitorDigest: varchar("visitor_digest", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("media_likes_media_visitor_unique").on(table.mediaId, table.visitorDigest),
    index("media_likes_media_idx").on(table.mediaId),
  ],
);
