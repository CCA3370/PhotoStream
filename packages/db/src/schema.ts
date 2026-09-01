import type { BibCandidateInput } from "@photostream/contracts";
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["admin", "reviewer", "uploader"]);
export const albumStateEnum = pgEnum("album_state", ["draft", "live", "ended", "archived"]);
export const albumAccessEnum = pgEnum("album_access", ["password", "public"]);
export const publishModeEnum = pgEnum("publish_mode", ["review", "auto"]);
export const ingestStatusEnum = pgEnum("ingest_status", [
  "created",
  "local_processing",
  "uploading_preview",
  "preview_ready",
  "uploading_source",
  "ready",
  "failed",
  "cancelled",
]);
export const publicationStatusEnum = pgEnum("publication_status", [
  "draft",
  "pending_review",
  "published",
  "hidden",
  "deleted",
]);
export const variantKindEnum = pgEnum("variant_kind", [
  "photo_480",
  "photo_960",
  "photo_1920",
  "photo_original",
]);
export const uploadIntentStatusEnum = pgEnum("upload_intent_status", [
  "active",
  "completed",
  "cancelled",
  "expired",
]);
export const uploadCleanupStatusEnum = pgEnum("upload_cleanup_status", [
  "not_needed",
  "pending",
  "processing",
  "failed",
  "completed",
]);
export const deletionTaskStatusEnum = pgEnum("deletion_task_status", [
  "pending",
  "processing",
  "failed",
  "completed",
]);
export const deletionObjectStatusEnum = pgEnum("deletion_object_status", [
  "pending",
  "deleted",
  "failed",
]);
export const analyticsEventTypeEnum = pgEnum("analytics_event_type", [
  "open",
  "session",
  "download",
]);
export const bibTagStatusEnum = pgEnum("bib_tag_status", [
  "suggested",
  "confirmed",
  "rejected",
  "needs_review",
]);
export const bibTagSourceEnum = pgEnum("bib_tag_source", ["ocr", "manual"]);
export const bibReviewDecisionEnum = pgEnum("bib_review_decision", [
  "pending",
  "numbers_confirmed",
  "no_number_confirmed",
  "needs_review",
]);
export const bibOcrStatusEnum = pgEnum("bib_ocr_status", [
  "not_started",
  "processing",
  "completed",
  "failed",
  "unsupported",
]);
export const bibAttributeDimensionEnum = pgEnum("bib_attribute_dimension", ["grade", "class"]);
export const bibRecalculationKindEnum = pgEnum("bib_recalculation_kind", ["rule", "mapping"]);
export const bibRecalculationStatusEnum = pgEnum("bib_recalculation_status", [
  "pending",
  "processing",
  "failed",
  "completed",
]);
export const faceIndexStateEnum = pgEnum("face_index_state", [
  "disabled",
  "provisioning",
  "indexing",
  "ready",
  "degraded",
  "deleting",
  "failed",
]);
export const faceMediaIndexStatusEnum = pgEnum("face_media_index_status", [
  "pending",
  "indexing",
  "indexed",
  "deleting",
  "excluded",
  "failed",
]);
export const faceSearchStatusEnum = pgEnum("face_search_status", [
  "awaiting_upload",
  "processing",
  "partial",
  "completed",
  "failed",
  "cancelled",
  "expired",
]);
export const faceConsentDeclarationEnum = pgEnum("face_consent_declaration", [
  "self",
  "guardian_or_authorized",
]);
export const faceAlbumJobKindEnum = pgEnum("face_album_job_kind", [
  "provision_dataset",
  "cluster",
  "delete_dataset",
]);
export const faceJobStatusEnum = pgEnum("face_job_status", [
  "pending",
  "processing",
  "failed",
  "completed",
  "cancelled",
]);
export const faceConsentResultEnum = pgEnum("face_consent_result", [
  "created",
  "completed_with_results",
  "completed_empty",
  "reference_rejected",
  "cancelled",
  "expired",
  "provider_failed",
  "cleanup_failed",
]);
export const faceEventProcessingResultEnum = pgEnum("face_event_processing_result", [
  "processed",
  "ignored",
  "failed",
]);

function timestampColumns() {
  return {
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  };
}

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    username: varchar("username", { length: 64 }).notNull(),
    normalizedUsername: varchar("normalized_username", { length: 64 }).notNull(),
    displayName: varchar("display_name", { length: 80 }).notNull(),
    role: userRoleEnum("role").notNull(),
    passwordHash: text("password_hash").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    mustChangePassword: boolean("must_change_password").notNull().default(true),
    creationActorId: uuid("creation_actor_id"),
    creationIdempotencyKey: varchar("creation_idempotency_key", { length: 128 }),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
    ...timestampColumns(),
  },
  (table) => [
    uniqueIndex("users_normalized_username_unique").on(table.normalizedUsername),
    uniqueIndex("users_creation_actor_idempotency_unique")
      .on(table.creationActorId, table.creationIdempotencyKey)
      .where(
        sql`${table.creationActorId} is not null and ${table.creationIdempotencyKey} is not null`,
      ),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    idleExpiresAt: timestamp("idle_expires_at", { withTimezone: true }).notNull(),
    absoluteExpiresAt: timestamp("absolute_expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
    index("sessions_user_active_idx").on(table.userId, table.revokedAt),
    index("sessions_expiry_idx").on(table.idleExpiresAt, table.absoluteExpiresAt),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: varchar("action", { length: 100 }).notNull(),
    targetType: varchar("target_type", { length: 64 }).notNull(),
    targetId: uuid("target_id"),
    result: varchar("result", { length: 32 }).notNull(),
    changedFields: jsonb("changed_fields").$type<readonly string[]>().notNull().default([]),
    requestId: varchar("request_id", { length: 128 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("audit_logs_actor_created_idx").on(table.actorUserId, table.createdAt)],
);

export const albums = pgTable(
  "albums",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    slug: varchar("slug", { length: 32 }).notNull(),
    title: varchar("title", { length: 120 }).notNull(),
    description: varchar("description", { length: 1_000 }).notNull().default(""),
    state: albumStateEnum("state").notNull().default("draft"),
    access: albumAccessEnum("access").notNull().default("password"),
    publishMode: publishModeEnum("publish_mode").notNull().default("review"),
    passwordHash: text("password_hash"),
    accessVersion: integer("access_version").notNull().default(1),
    previewDownloadEnabled: boolean("preview_download_enabled").notNull().default(false),
    originalDownloadEnabled: boolean("original_download_enabled").notNull().default(false),
    bibRecognitionEnabled: boolean("bib_recognition_enabled").notNull().default(false),
    bibSearchEnabled: boolean("bib_search_enabled").notNull().default(false),
    bibRuleVersion: integer("bib_rule_version").notNull().default(0),
    bibMappingVersion: integer("bib_mapping_version").notNull().default(0),
    bibModelVersion: varchar("bib_model_version", { length: 80 })
      .notNull()
      .default("ppocrv6-tiny-0.4.2-ff6ab415-1e13b227"),
    bibRuleUsable: boolean("bib_rule_usable").notNull().default(false),
    bibMappingUsable: boolean("bib_mapping_usable").notNull().default(true),
    privacyNotice: varchar("privacy_notice", { length: 2_000 }).notNull().default(""),
    complaintContact: varchar("complaint_contact", { length: 300 }).notNull().default(""),
    publishSequence: bigint("publish_sequence", { mode: "number" }).notNull().default(0),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    ...timestampColumns(),
  },
  (table) => [
    uniqueIndex("albums_slug_unique").on(table.slug),
    uniqueIndex("albums_creator_idempotency_unique").on(table.createdBy, table.idempotencyKey),
    index("albums_state_updated_idx").on(table.state, table.updatedAt),
  ],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    albumId: uuid("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 60 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    ...timestampColumns(),
  },
  (table) => [
    uniqueIndex("categories_album_name_unique").on(table.albumId, table.name),
    uniqueIndex("categories_creator_idempotency_unique").on(
      table.albumId,
      table.createdBy,
      table.idempotencyKey,
    ),
    index("categories_album_sort_idx").on(table.albumId, table.enabled, table.sortOrder),
  ],
);

export const media = pgTable(
  "media",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    albumId: uuid("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    uploaderId: uuid("uploader_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    ingestStatus: ingestStatusEnum("ingest_status").notNull().default("created"),
    publicationStatus: publicationStatusEnum("publication_status").notNull().default("draft"),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    mediaType: varchar("media_type", { length: 80 }).notNull(),
    totalBytes: bigint("total_bytes", { mode: "number" }).notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    publishSequence: bigint("publish_sequence", { mode: "number" }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    failureCode: varchar("failure_code", { length: 80 }),
    retryable: boolean("retryable").notNull().default(false),
    ...timestampColumns(),
  },
  (table) => [
    uniqueIndex("media_album_publish_sequence_unique")
      .on(table.albumId, table.publishSequence)
      .where(sql`${table.publishSequence} is not null`),
    index("media_album_public_cursor_idx").on(
      table.albumId,
      table.publicationStatus,
      table.publishSequence,
      table.id,
    ),
    index("media_album_ingest_idx").on(table.albumId, table.ingestStatus, table.createdAt),
  ],
);

export const mediaVariants = pgTable(
  "media_variants",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => media.id, { onDelete: "cascade" }),
    kind: variantKindEnum("kind").notNull(),
    objectKey: varchar("object_key", { length: 512 }).notNull(),
    format: varchar("format", { length: 16 }).notNull(),
    contentType: varchar("content_type", { length: 80 }).notNull(),
    width: integer("width"),
    height: integer("height"),
    expectedBytes: bigint("expected_bytes", { mode: "number" }).notNull(),
    bytes: bigint("bytes", { mode: "number" }),
    etag: varchar("etag", { length: 128 }),
    providerMultipartUploadId: varchar("provider_multipart_upload_id", { length: 256 }),
    verified: boolean("verified").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("media_variants_media_variant_unique").on(table.mediaId, table.kind),
    uniqueIndex("media_variants_object_key_unique").on(table.objectKey),
    index("media_variants_media_verified_idx").on(table.mediaId, table.verified),
  ],
);

export const uploadIntents = pgTable(
  "upload_intents",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => media.id, { onDelete: "cascade" }),
    uploaderId: uuid("uploader_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    status: uploadIntentStatusEnum("status").notNull().default("active"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    cleanupStatus: uploadCleanupStatusEnum("cleanup_status").notNull().default("not_needed"),
    cleanupAttempts: integer("cleanup_attempts").notNull().default(0),
    cleanupSuccessfulSweeps: integer("cleanup_successful_sweeps").notNull().default(0),
    cleanupLastErrorCode: varchar("cleanup_last_error_code", { length: 100 }),
    cleanupNextAttemptAt: timestamp("cleanup_next_attempt_at", { withTimezone: true }),
    cleanupCompletedAt: timestamp("cleanup_completed_at", { withTimezone: true }),
    ...timestampColumns(),
  },
  (table) => [
    uniqueIndex("upload_intents_uploader_idempotency_unique").on(
      table.uploaderId,
      table.idempotencyKey,
    ),
    uniqueIndex("upload_intents_media_unique").on(table.mediaId),
    index("upload_intents_expiry_idx").on(table.status, table.expiresAt),
    index("upload_intents_cleanup_idx").on(table.cleanupStatus, table.cleanupNextAttemptAt),
  ],
);

export const uploadParts = pgTable(
  "upload_parts",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => mediaVariants.id, { onDelete: "cascade" }),
    partNumber: integer("part_number").notNull(),
    expectedBytes: bigint("expected_bytes", { mode: "number" }).notNull(),
    etag: varchar("etag", { length: 128 }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("upload_parts_variant_number_unique").on(table.variantId, table.partNumber),
    index("upload_parts_variant_completed_idx").on(table.variantId, table.completedAt),
  ],
);

export const liveEvents = pgTable(
  "live_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    albumId: uuid("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 80 }).notNull(),
    mediaId: uuid("media_id").references(() => media.id, { onDelete: "cascade" }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("live_events_album_id_idx").on(table.albumId, table.id)],
);

export const visitorSessions = pgTable(
  "visitor_sessions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    albumId: uuid("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    accessVersion: integer("access_version").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("visitor_sessions_token_hash_unique").on(table.tokenHash),
    index("visitor_sessions_album_expiry_idx").on(table.albumId, table.expiresAt),
  ],
);

export const albumFaceIndexes = pgTable(
  "album_face_indexes",
  {
    albumId: uuid("album_id")
      .primaryKey()
      .references(() => albums.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    noticeVersion: varchar("notice_version", { length: 80 }),
    thresholdVersion: varchar("threshold_version", { length: 80 }).notNull(),
    participantConsentRecordsConfirmed: boolean("participant_consent_records_confirmed")
      .notNull()
      .default(false),
    guardianConsentRequirementsConfirmed: boolean("guardian_consent_requirements_confirmed")
      .notNull()
      .default(false),
    impactAssessmentCompleted: boolean("impact_assessment_completed").notNull().default(false),
    providerResourcesValidated: boolean("provider_resources_validated").notNull().default(false),
    evaluationGatePassed: boolean("evaluation_gate_passed").notNull().default(false),
    billingAlertsConfigured: boolean("billing_alerts_configured").notNull().default(false),
    indexedFacesAuthorized: boolean("indexed_faces_authorized").notNull().default(false),
    authorizationConfirmedAt: timestamp("authorization_confirmed_at", { withTimezone: true }),
    indexState: faceIndexStateEnum("index_state").notNull().default("disabled"),
    datasetName: varchar("dataset_name", { length: 128 }),
    retentionDays: integer("retention_days").notNull().default(30),
    lastIndexedAt: timestamp("last_indexed_at", { withTimezone: true }),
    lastClusteredAt: timestamp("last_clustered_at", { withTimezone: true }),
    deletionDueAt: timestamp("deletion_due_at", { withTimezone: true }),
    lastErrorCode: varchar("last_error_code", { length: 100 }),
    ...timestampColumns(),
  },
  (table) => [
    uniqueIndex("album_face_indexes_dataset_name_unique")
      .on(table.datasetName)
      .where(sql`${table.datasetName} is not null`),
    index("album_face_indexes_state_due_idx").on(table.indexState, table.deletionDueAt),
  ],
);

export const faceAlbumJobs = pgTable(
  "face_album_jobs",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    albumId: uuid("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    kind: faceAlbumJobKindEnum("kind").notNull(),
    status: faceJobStatusEnum("status").notNull().default("pending"),
    providerTaskId: varchar("provider_task_id", { length: 256 }),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastErrorCode: varchar("last_error_code", { length: 100 }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestampColumns(),
  },
  (table) => [
    uniqueIndex("face_album_jobs_active_kind_unique")
      .on(table.albumId, table.kind)
      .where(sql`${table.status} in ('pending', 'processing')`),
    uniqueIndex("face_album_jobs_provider_task_unique")
      .on(table.providerTaskId)
      .where(sql`${table.providerTaskId} is not null`),
    index("face_album_jobs_poll_idx").on(table.status, table.nextAttemptAt),
  ],
);

export const mediaFaceIndexTasks = pgTable(
  "media_face_index_tasks",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    albumId: uuid("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => media.id, { onDelete: "cascade" }),
    status: faceMediaIndexStatusEnum("status").notNull().default("pending"),
    providerTaskId: varchar("provider_task_id", { length: 256 }),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastErrorCode: varchar("last_error_code", { length: 100 }),
    deletionConfirmedAt: timestamp("deletion_confirmed_at", { withTimezone: true }),
    ...timestampColumns(),
  },
  (table) => [
    uniqueIndex("media_face_index_tasks_media_unique").on(table.mediaId),
    uniqueIndex("media_face_index_tasks_provider_task_unique")
      .on(table.providerTaskId)
      .where(sql`${table.providerTaskId} is not null`),
    index("media_face_index_tasks_album_status_idx").on(table.albumId, table.status, table.id),
    index("media_face_index_tasks_poll_idx").on(table.status, table.nextAttemptAt),
  ],
);

export const faceConsentReceipts = pgTable(
  "face_consent_receipts",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    albumId: uuid("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    noticeVersion: varchar("notice_version", { length: 80 }).notNull(),
    declaration: faceConsentDeclarationEnum("declaration").notNull(),
    resultCategory: faceConsentResultEnum("result_category").notNull().default("created"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("face_consent_receipts_album_occurred_idx").on(table.albumId, table.occurredAt),
  ],
);

export const faceSearchIntents = pgTable(
  "face_search_intents",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    albumId: uuid("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    visitorSessionDigest: varchar("visitor_session_digest", { length: 64 }).notNull(),
    ipDailyDigest: varchar("ip_daily_digest", { length: 64 }).notNull(),
    status: faceSearchStatusEnum("status").notNull().default("awaiting_upload"),
    objectKey: varchar("object_key", { length: 512 }).notNull(),
    expectedBytes: integer("expected_bytes").notNull(),
    objectEtag: varchar("object_etag", { length: 128 }),
    noticeVersion: varchar("notice_version", { length: 80 }).notNull(),
    declaration: faceConsentDeclarationEnum("declaration").notNull(),
    consentReceiptId: uuid("consent_receipt_id").references(() => faceConsentReceipts.id, {
      onDelete: "set null",
    }),
    providerTaskId: varchar("provider_task_id", { length: 256 }),
    referenceExpiresAt: timestamp("reference_expires_at", { withTimezone: true }).notNull(),
    resultExpiresAt: timestamp("result_expires_at", { withTimezone: true }).notNull(),
    referenceDeletedAt: timestamp("reference_deleted_at", { withTimezone: true }),
    initialSearchCompletedAt: timestamp("initial_search_completed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failureCode: varchar("failure_code", { length: 100 }),
    cleanupAttempts: integer("cleanup_attempts").notNull().default(0),
    cleanupNextAttemptAt: timestamp("cleanup_next_attempt_at", { withTimezone: true }),
    cleanupLastErrorCode: varchar("cleanup_last_error_code", { length: 100 }),
    ...timestampColumns(),
  },
  (table) => [
    uniqueIndex("face_search_intents_object_key_unique").on(table.objectKey),
    uniqueIndex("face_search_intents_provider_task_unique")
      .on(table.providerTaskId)
      .where(sql`${table.providerTaskId} is not null`),
    index("face_search_intents_session_rate_idx").on(table.visitorSessionDigest, table.createdAt),
    index("face_search_intents_ip_rate_idx").on(table.ipDailyDigest, table.createdAt),
    index("face_search_intents_expiry_idx").on(table.status, table.resultExpiresAt),
    index("face_search_intents_cleanup_idx").on(
      table.referenceDeletedAt,
      table.cleanupNextAttemptAt,
    ),
  ],
);

export const faceSearchCandidates = pgTable(
  "face_search_candidates",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    searchIntentId: uuid("search_intent_id")
      .notNull()
      .references(() => faceSearchIntents.id, { onDelete: "cascade" }),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => media.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("face_search_candidates_intent_media_unique").on(
      table.searchIntentId,
      table.mediaId,
    ),
    index("face_search_candidates_expiry_idx").on(table.expiresAt),
  ],
);

export const faceIntegrationEvents = pgTable(
  "face_integration_events",
  {
    eventId: varchar("event_id", { length: 256 }).primaryKey(),
    providerTaskId: varchar("provider_task_id", { length: 256 }).notNull(),
    processingResult: faceEventProcessingResultEnum("processing_result").notNull(),
    errorCode: varchar("error_code", { length: 100 }),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("face_integration_events_task_processed_idx").on(table.providerTaskId, table.processedAt),
  ],
);

export const mediaBatchRequests = pgTable(
  "media_batch_requests",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    result: jsonb("result").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("media_batch_actor_idempotency_unique").on(table.actorUserId, table.idempotencyKey),
  ],
);

export const operationRequests = pgTable(
  "operation_requests",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    actorScope: varchar("actor_scope", { length: 128 }).notNull(),
    operation: varchar("operation", { length: 120 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    result: jsonb("result").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("operation_requests_scope_operation_key_unique").on(
      table.actorScope,
      table.operation,
      table.idempotencyKey,
    ),
  ],
);

export const deletionTasks = pgTable(
  "deletion_tasks",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => media.id, { onDelete: "cascade" }),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: deletionTaskStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastErrorCode: varchar("last_error_code", { length: 100 }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    requestId: varchar("request_id", { length: 128 }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestampColumns(),
  },
  (table) => [
    uniqueIndex("deletion_tasks_media_unique").on(table.mediaId),
    index("deletion_tasks_poll_idx").on(table.status, table.nextAttemptAt),
  ],
);

export const deletionTaskObjects = pgTable(
  "deletion_task_objects",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    taskId: uuid("task_id")
      .notNull()
      .references(() => deletionTasks.id, { onDelete: "cascade" }),
    variantKind: variantKindEnum("variant_kind").notNull(),
    objectKey: varchar("object_key", { length: 512 }),
    status: deletionObjectStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastErrorCode: varchar("last_error_code", { length: 100 }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("deletion_task_objects_task_variant_unique").on(table.taskId, table.variantKind),
    index("deletion_task_objects_status_idx").on(table.taskId, table.status),
  ],
);

export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    albumId: uuid("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    eventType: analyticsEventTypeEnum("event_type").notNull(),
    visitorDigest: varchar("visitor_digest", { length: 64 }).notNull(),
    mediaId: uuid("media_id").references(() => media.id, { onDelete: "set null" }),
    variantKind: variantKindEnum("variant_kind"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("analytics_events_album_day_idx").on(table.albumId, table.day),
    index("analytics_events_retention_idx").on(table.createdAt),
  ],
);

export const analyticsDaily = pgTable(
  "analytics_daily",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    albumId: uuid("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    opens: integer("opens").notNull().default(0),
    sessions: integer("sessions").notNull().default(0),
    downloads: integer("downloads").notNull().default(0),
    uniqueVisitors: integer("unique_visitors").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("analytics_daily_album_day_unique").on(table.albumId, table.day)],
);

export const bibPatterns = pgTable(
  "bib_patterns",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    albumId: uuid("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    totalLength: integer("total_length").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
    ...timestampColumns(),
  },
  (table) => [index("bib_patterns_album_sort_idx").on(table.albumId, table.sortOrder, table.id)],
);

export const bibConstraints = pgTable(
  "bib_constraints",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    patternId: uuid("pattern_id")
      .notNull()
      .references(() => bibPatterns.id, { onDelete: "cascade" }),
    startPosition: integer("start_position").notNull(),
    width: integer("width").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("bib_constraints_pattern_sort_idx").on(table.patternId, table.sortOrder, table.id),
  ],
);

export const bibAllowedRanges = pgTable(
  "bib_allowed_ranges",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    constraintId: uuid("constraint_id")
      .notNull()
      .references(() => bibConstraints.id, { onDelete: "cascade" }),
    startValue: varchar("start_value", { length: 12 }).notNull(),
    endValue: varchar("end_value", { length: 12 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    uniqueIndex("bib_allowed_ranges_constraint_values_unique").on(
      table.constraintId,
      table.startValue,
      table.endValue,
    ),
  ],
);

export const bibAttributeOptions = pgTable(
  "bib_attribute_options",
  {
    id: uuid("id").primaryKey(),
    albumId: uuid("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    dimension: bibAttributeDimensionEnum("dimension").notNull(),
    displayName: varchar("display_name", { length: 60 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
    ...timestampColumns(),
  },
  (table) => [
    index("bib_attribute_options_album_dimension_sort_idx").on(
      table.albumId,
      table.dimension,
      table.sortOrder,
      table.id,
    ),
  ],
);

export const bibAttributeMappings = pgTable(
  "bib_attribute_mappings",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    albumId: uuid("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    dimension: bibAttributeDimensionEnum("dimension").notNull(),
    startPosition: integer("start_position").notNull(),
    width: integer("width").notNull(),
    outputOptionId: uuid("output_option_id")
      .notNull()
      .references(() => bibAttributeOptions.id, { onDelete: "restrict" }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("bib_attribute_mappings_album_dimension_sort_idx").on(
      table.albumId,
      table.dimension,
      table.sortOrder,
      table.id,
    ),
  ],
);

export const bibAttributeMappingRanges = pgTable(
  "bib_attribute_mapping_ranges",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    mappingId: uuid("mapping_id")
      .notNull()
      .references(() => bibAttributeMappings.id, { onDelete: "cascade" }),
    startValue: varchar("start_value", { length: 12 }).notNull(),
    endValue: varchar("end_value", { length: 12 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    uniqueIndex("bib_attribute_mapping_ranges_values_unique").on(
      table.mappingId,
      table.startValue,
      table.endValue,
    ),
  ],
);

export const mediaBibTags = pgTable(
  "media_bib_tags",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    albumId: uuid("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => media.id, { onDelete: "cascade" }),
    numberCiphertext: text("number_ciphertext").notNull(),
    numberIv: varchar("number_iv", { length: 32 }).notNull(),
    numberAuthTag: varchar("number_auth_tag", { length: 32 }).notNull(),
    blindIndex: varchar("blind_index", { length: 64 }).notNull(),
    keyVersion: varchar("key_version", { length: 40 }).notNull(),
    status: bibTagStatusEnum("status").notNull(),
    source: bibTagSourceEnum("source").notNull(),
    confidenceBasisPoints: integer("confidence_basis_points"),
    quadrilateral: jsonb("quadrilateral").$type<BibCandidateInput["quadrilateral"]>(),
    ruleVersion: integer("rule_version").notNull(),
    modelVersion: varchar("model_version", { length: 80 }),
    gradeOptionId: uuid("grade_option_id").references(() => bibAttributeOptions.id, {
      onDelete: "set null",
    }),
    classOptionId: uuid("class_option_id").references(() => bibAttributeOptions.id, {
      onDelete: "set null",
    }),
    mappingVersion: integer("mapping_version").notNull().default(0),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    confirmedBy: uuid("confirmed_by").references(() => users.id, { onDelete: "set null" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    ...timestampColumns(),
  },
  (table) => [
    uniqueIndex("media_bib_tags_confirmed_number_unique")
      .on(table.mediaId, table.blindIndex)
      .where(sql`${table.status} = 'confirmed'`),
    index("media_bib_tags_media_status_idx").on(table.mediaId, table.status, table.createdAt),
    index("media_bib_tags_key_version_idx").on(table.keyVersion, table.id),
    index("media_bib_tags_public_search_idx").on(
      table.albumId,
      table.blindIndex,
      table.status,
      table.ruleVersion,
    ),
    index("media_bib_tags_attribute_filter_idx").on(
      table.albumId,
      table.status,
      table.mappingVersion,
      table.gradeOptionId,
      table.classOptionId,
    ),
  ],
);

export const mediaBibReviews = pgTable("media_bib_reviews", {
  mediaId: uuid("media_id")
    .primaryKey()
    .references(() => media.id, { onDelete: "cascade" }),
  decision: bibReviewDecisionEnum("decision").notNull().default("pending"),
  ocrStatus: bibOcrStatusEnum("ocr_status").notNull().default("not_started"),
  ocrModelVersion: varchar("ocr_model_version", { length: 80 }),
  ocrErrorCode: varchar("ocr_error_code", { length: 80 }),
  decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  reason: varchar("reason", { length: 100 }).notNull().default("created"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bibRecalculationTasks = pgTable(
  "bib_recalculation_tasks",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    albumId: uuid("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    kind: bibRecalculationKindEnum("kind").notNull(),
    targetVersion: integer("target_version").notNull(),
    status: bibRecalculationStatusEnum("status").notNull().default("pending"),
    cursorTagId: uuid("cursor_tag_id"),
    attempts: integer("attempts").notNull().default(0),
    lastErrorCode: varchar("last_error_code", { length: 100 }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestampColumns(),
  },
  (table) => [
    uniqueIndex("bib_recalculation_album_kind_version_unique").on(
      table.albumId,
      table.kind,
      table.targetVersion,
    ),
    index("bib_recalculation_poll_idx").on(table.status, table.nextAttemptAt),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type SessionRow = typeof sessions.$inferSelect;
export type AlbumRow = typeof albums.$inferSelect;
export type CategoryRow = typeof categories.$inferSelect;
export type MediaRow = typeof media.$inferSelect;
export type MediaVariantRow = typeof mediaVariants.$inferSelect;
export type UploadIntentRow = typeof uploadIntents.$inferSelect;
export type UploadPartRow = typeof uploadParts.$inferSelect;
export type DeletionTaskRow = typeof deletionTasks.$inferSelect;
export type BibPatternRow = typeof bibPatterns.$inferSelect;
export type MediaBibTagRow = typeof mediaBibTags.$inferSelect;
export type MediaBibReviewRow = typeof mediaBibReviews.$inferSelect;
export type AlbumFaceIndexRow = typeof albumFaceIndexes.$inferSelect;
export type FaceAlbumJobRow = typeof faceAlbumJobs.$inferSelect;
export type MediaFaceIndexTaskRow = typeof mediaFaceIndexTasks.$inferSelect;
export type FaceSearchIntentRow = typeof faceSearchIntents.$inferSelect;
export type FaceSearchCandidateRow = typeof faceSearchCandidates.$inferSelect;
export type FaceConsentReceiptRow = typeof faceConsentReceipts.$inferSelect;
