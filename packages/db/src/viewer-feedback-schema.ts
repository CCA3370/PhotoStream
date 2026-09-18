import { bigserial, index, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { albums, media } from "./schema.js";

export const viewerFeedback = pgTable(
  "viewer_feedback",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    albumId: uuid("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    mediaId: uuid("media_id").references(() => media.id, { onDelete: "set null" }),
    kind: varchar("kind", { length: 24 })
      .$type<"problem" | "suggestion" | "other" | "report">()
      .notNull(),
    reportReason: varchar("report_reason", { length: 32 }).$type<
      "privacy" | "inappropriate" | "copyright" | "inaccurate" | "other"
    >(),
    message: text("message").notNull(),
    pagePath: varchar("page_path", { length: 512 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("viewer_feedback_album_id_idx").on(table.albumId, table.id),
    index("viewer_feedback_media_id_idx").on(table.mediaId, table.id),
    index("viewer_feedback_created_idx").on(table.createdAt),
  ],
);
