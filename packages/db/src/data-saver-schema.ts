import { boolean, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

import { albums } from "./schema.js";

export const albumDataSaverSettings = pgTable("album_data_saver_settings", {
  albumId: uuid("album_id")
    .primaryKey()
    .references(() => albums.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
