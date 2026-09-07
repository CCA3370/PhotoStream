import { index, integer, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { albums } from "./schema.js";

export const faceOperationDiagnostics = pgTable(
  "face_operation_diagnostics",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    albumId: uuid("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    source: varchar("source", { length: 40 }).notNull(),
    operation: varchar("operation", { length: 120 }).notNull(),
    providerCode: varchar("provider_code", { length: 200 }),
    providerMessage: text("provider_message").notNull(),
    providerRequestId: varchar("provider_request_id", { length: 256 }),
    httpStatus: integer("http_status"),
    region: varchar("region", { length: 64 }),
    endpoint: varchar("endpoint", { length: 255 }),
    projectName: varchar("project_name", { length: 128 }),
    datasetName: varchar("dataset_name", { length: 128 }),
    context: jsonb("context").$type<Record<string, string | number | boolean | null>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("face_operation_diagnostics_album_time_idx").on(table.albumId, table.occurredAt)],
);
