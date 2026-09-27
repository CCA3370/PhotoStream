import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { albums, users } from "./schema.js";

export const albumNotifications = pgTable(
  "album_notifications",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    albumId: uuid("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 120 }).notNull(),
    content: text("content").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("album_notifications_album_time_idx").on(table.albumId, table.startsAt, table.endsAt),
    check("album_notifications_time_window_check", sql`${table.endsAt} > ${table.startsAt}`),
  ],
);
