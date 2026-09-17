import { index, pgTable, text, timestamp, uuid, varchar, bigserial } from "drizzle-orm/pg-core";

import { albums } from "./schema.js";

export const viewerFeedback = pgTable(
  "viewer_feedback",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    albumId: uuid("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 24 })
      .$type<"problem" | "suggestion" | "other">()
      .notNull(),
    message: text("message").notNull(),
    pagePath: varchar("page_path", { length: 512 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("viewer_feedback_album_id_idx").on(table.albumId, table.id),
    index("viewer_feedback_created_idx").on(table.id),
  ],
);
