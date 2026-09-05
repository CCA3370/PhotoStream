import { pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

import { media, users } from "./schema.js";

export const featuredMedia = pgTable("featured_media", {
  mediaId: uuid("media_id")
    .primaryKey()
    .references(() => media.id, { onDelete: "cascade" }),
  featuredBy: uuid("featured_by")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  featuredAt: timestamp("featured_at", { withTimezone: true }).notNull().defaultNow(),
});
