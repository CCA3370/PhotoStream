import { bigserial, index, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { albums, media, users } from "./schema.js";

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
      "privacy" | "inappropriate" | "copyright" | "inaccurate" | "malicious_spread" | "other"
    >(),
    status: varchar("status", { length: 24 })
      .$type<"pending" | "in_progress" | "resolved" | "rejected">()
      .notNull()
      .default("pending"),
    assignedToUserId: uuid("assigned_to_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    resolutionNote: text("resolution_note"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    message: text("message").notNull(),
    pagePath: varchar("page_path", { length: 512 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("viewer_feedback_album_id_idx").on(table.albumId, table.id),
    index("viewer_feedback_media_id_idx").on(table.mediaId, table.id),
    index("viewer_feedback_status_id_idx").on(table.status, table.id),
    index("viewer_feedback_assignee_id_idx").on(table.assignedToUserId, table.id),
    index("viewer_feedback_created_idx").on(table.createdAt),
  ],
);
