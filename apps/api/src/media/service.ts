import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  type AlbumView,
  type CreateAlbumRequest,
  type CreatePhotoUploadRequest,
  type DerivedPhotoVariantKind,
  hasPermission,
  type PhotoVariantKind,
  type PublicMediaView,
  type ReviewCollaborationView,
  type UpdateAlbumRequest,
  type UploadIntentView,
  type UserRole,
} from "@photostream/contracts";
import type { Database } from "@photostream/db";
import { schema } from "@photostream/db";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  not,
  or,
  sql,
} from "drizzle-orm";
import { createSessionToken, safeEqual } from "../auth/crypto.js";
import type { PasswordHasher } from "../auth/types.js";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import {
  findOperationRequest,
  lockOperationRequest,
  operationRequestHash,
  saveOperationRequest,
} from "../idempotency.js";
import { type CdnInvalidator, LocalCdnInvalidator } from "./cdn-invalidator.js";
import { liveEventChannel } from "./live-event-broker.js";
import type { ObjectStorage } from "./object-storage.js";
import { previewExpiresAt } from "./preview-expiry.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type DbExecutor = Database | Transaction;

const photoVariantKinds: readonly PhotoVariantKind[] = [
  "photo_480",
  "photo_960",
  "photo_1920",
  "photo_original",
];
const previewVariantKinds = new Set<PhotoVariantKind>(["photo_480", "photo_960"]);
const publicVariantKinds = new Set<PhotoVariantKind>(["photo_480", "photo_960", "photo_1920"]);
const multipartThreshold = 16 * 1024 * 1024;
const uploadCleanupInitialGraceMs = 30 * 60 * 1_000;
const uploadCleanupVerificationDelayMs = 24 * 60 * 60 * 1_000;
const multipartPartBytes = 8 * 1024 * 1024;
const maxActiveUploadIntentsPerUploader = 32;
const maxOutstandingUploadBytesPerUploader = 4 * 1024 * 1024 * 1024;
const maxAlbumReservedBytes = 256 * 1024 * 1024 * 1024;
const incompleteIngestStatuses = [
  "created",
  "local_processing",
  "uploading_preview",
  "preview_ready",
  "uploading_source",
] as const;

function iso(value: Date): string {
  return value.toISOString();
}

function albumView(row: typeof schema.albums.$inferSelect): AlbumView {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    state: row.state,
    access: row.access,
    publishMode: row.publishMode,
    previewDownloadEnabled: true,
    originalDownloadEnabled: true,
    privacyNotice: row.privacyNotice,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function categoryView(row: typeof schema.categories.$inferSelect) {
  return {
    id: row.id,
    albumId: row.albumId,
    name: row.name,
    sortOrder: row.sortOrder,
    enabled: row.enabled,
  };
}

function extensionFor(format: string): string {
  if (format === "jpeg") return "jpg";
  return format;
}

function variantFilename(kind: PhotoVariantKind, format: string): string {
  if (kind === "photo_original") return `original.${extensionFor(format)}`;
  return `${kind.slice("photo_".length)}.${extensionFor(format)}`;
}

function requireHeaderIdempotency(value: string | undefined): string {
  if (value === undefined || value.length < 16 || value.length > 128) {
    throw new AppError({
      code: "BAD_REQUEST",
      message: "缺少有效幂等键",
      statusCode: 400,
    });
  }
  return value;
}

function requirePermission(role: UserRole, permission: Parameters<typeof hasPermission>[1]): void {
  if (!hasPermission(role, permission)) {
    throw new AppError({ code: "FORBIDDEN", message: "当前角色无权执行此操作", statusCode: 403 });
  }
}

function cursorSignature(secret: string, encoded: string): string {
  return createHmac("sha256", secret).update(encoded, "utf8").digest("base64url");
}

function visitorTokenHash(secret: string, token: string): string {
  return createHmac("sha256", secret).update(token, "utf8").digest("hex");
}

export interface InternalActor {
  readonly id: string;
  readonly role: UserRole;
}

export class PhotoService {
  readonly #database: Database;
  readonly #storage: ObjectStorage;
  readonly #hasher: PasswordHasher;
  readonly #config: AppConfig;
  readonly #cdnInvalidator: CdnInvalidator;

  constructor(options: {
    readonly database: Database;
    readonly storage: ObjectStorage;
    readonly passwordHasher: PasswordHasher;
    readonly config: AppConfig;
    readonly cdnInvalidator?: CdnInvalidator;
  }) {
    this.#database = options.database;
    this.#storage = options.storage;
    this.#hasher = options.passwordHasher;
    this.#config = options.config;
    this.#cdnInvalidator = options.cdnInvalidator ?? new LocalCdnInvalidator();
  }

  async listAlbums(actor: InternalActor): Promise<AlbumView[]> {
    requirePermission(actor.role, "album:read");
    const rows = await this.#database
      .select()
      .from(schema.albums)
      .orderBy(desc(schema.albums.updatedAt));
    return rows.map(albumView);
  }

  async listAlbumSummaries(actor: InternalActor) {
    const albums = await this.listAlbums(actor);
    return Promise.all(
      albums.map(async (album) => {
        const [counts] = await this.#database
          .select({
            mediaCount: sql<number>`count(*)::int`,
            pendingReviewCount: sql<number>`count(*) filter (where ${schema.media.publicationStatus} = 'pending_review')::int`,
            incompleteCount: sql<number>`count(*) filter (where ${schema.media.ingestStatus} not in ('ready', 'failed', 'cancelled'))::int`,
          })
          .from(schema.media)
          .where(
            and(
              eq(schema.media.albumId, album.id),
              sql`${schema.media.publicationStatus} <> 'deleted'`,
            ),
          );
        const [storage] = await this.#database
          .select({
            logicalBytes: sql<number>`coalesce(sum(${schema.mediaVariants.bytes}), 0)::bigint`,
          })
          .from(schema.mediaVariants)
          .innerJoin(schema.media, eq(schema.mediaVariants.mediaId, schema.media.id))
          .where(and(eq(schema.media.albumId, album.id), eq(schema.mediaVariants.verified, true)));
        return {
          ...album,
          mediaCount: counts?.mediaCount ?? 0,
          pendingReviewCount: counts?.pendingReviewCount ?? 0,
          incompleteCount: counts?.incompleteCount ?? 0,
          logicalBytes: Number(storage?.logicalBytes ?? 0),
        };
      }),
    );
  }

  async getAlbum(actor: InternalActor, albumId: string): Promise<AlbumView> {
    requirePermission(actor.role, "album:read");
    const row = await this.#albumById(this.#database, albumId);
    if (row === null) throw this.#albumNotFound();
    return albumView(row);
  }

  async reviewRevision(actor: InternalActor, albumId: string): Promise<string> {
    requirePermission(actor.role, "album:read");
    const [row] = await this.#database
      .select({
        albumUpdatedAt: schema.albums.updatedAt,
        reviewCollaborationState: sql<string>`(
          select coalesce(
            string_agg(
              ${schema.albumReviewCollaborators.userId}::text || ':' ||
              ${schema.users.isActive}::text || ':' ||
              ${schema.users.role}::text,
              ',' order by ${schema.albumReviewCollaborators.userId}
            ),
            ''
          )
          from ${schema.albumReviewCollaborators}
          inner join ${schema.users}
            on ${schema.users.id} = ${schema.albumReviewCollaborators.userId}
          where ${schema.albumReviewCollaborators.albumId} = ${albumId}
        )`,
        mediaCount: sql<number>`(
          select count(*)::int
          from ${schema.media}
          where ${schema.media.albumId} = ${albumId}
        )`,
        mediaUpdatedAt: sql<Date | null>`(
          select max(${schema.media.updatedAt})
          from ${schema.media}
          where ${schema.media.albumId} = ${albumId}
        )`,
        variantCount: sql<number>`(
          select count(*)::int
          from ${schema.mediaVariants}
          where ${schema.mediaVariants.mediaId} in (
            select ${schema.media.id}
            from ${schema.media}
            where ${schema.media.albumId} = ${albumId}
          )
        )`,
        variantCompletedAt: sql<Date | null>`(
          select max(${schema.mediaVariants.completedAt})
          from ${schema.mediaVariants}
          where ${schema.mediaVariants.mediaId} in (
            select ${schema.media.id}
            from ${schema.media}
            where ${schema.media.albumId} = ${albumId}
          )
        )`,
        featuredCount: sql<number>`(
          select count(*)::int
          from ${schema.featuredMedia}
          where ${schema.featuredMedia.mediaId} in (
            select ${schema.media.id}
            from ${schema.media}
            where ${schema.media.albumId} = ${albumId}
          )
        )`,
        featuredAt: sql<Date | null>`(
          select max(${schema.featuredMedia.featuredAt})
          from ${schema.featuredMedia}
          where ${schema.featuredMedia.mediaId} in (
            select ${schema.media.id}
            from ${schema.media}
            where ${schema.media.albumId} = ${albumId}
          )
        )`,
        categoryCount: sql<number>`(
          select count(*)::int
          from ${schema.categories}
          where ${schema.categories.albumId} = ${albumId}
        )`,
        categoryUpdatedAt: sql<Date | null>`(
          select max(${schema.categories.updatedAt})
          from ${schema.categories}
          where ${schema.categories.albumId} = ${albumId}
        )`,
        uploaderUpdatedAt: sql<Date | null>`(
          select max(${schema.users.updatedAt})
          from ${schema.users}
          where ${schema.users.id} in (
            select distinct ${schema.media.uploaderId}
            from ${schema.media}
            where ${schema.media.albumId} = ${albumId}
          )
        )`,
        bibReviewCount: sql<number>`(
          select count(*)::int
          from ${schema.mediaBibReviews}
          where ${schema.mediaBibReviews.mediaId} in (
            select ${schema.media.id}
            from ${schema.media}
            where ${schema.media.albumId} = ${albumId}
          )
        )`,
        bibReviewUpdatedAt: sql<Date | null>`(
          select max(${schema.mediaBibReviews.updatedAt})
          from ${schema.mediaBibReviews}
          where ${schema.mediaBibReviews.mediaId} in (
            select ${schema.media.id}
            from ${schema.media}
            where ${schema.media.albumId} = ${albumId}
          )
        )`,
        bibTagCount: sql<number>`(
          select count(*)::int
          from ${schema.mediaBibTags}
          where ${schema.mediaBibTags.albumId} = ${albumId}
        )`,
        bibTagUpdatedAt: sql<Date | null>`(
          select max(${schema.mediaBibTags.updatedAt})
          from ${schema.mediaBibTags}
          where ${schema.mediaBibTags.albumId} = ${albumId}
        )`,
        editStateCount: sql<number>`(
          select count(*)::int
          from ${schema.mediaEditStates}
          where ${schema.mediaEditStates.mediaId} in (
            select ${schema.media.id}
            from ${schema.media}
            where ${schema.media.albumId} = ${albumId}
          )
        )`,
        editStateUpdatedAt: sql<Date | null>`(
          select max(${schema.mediaEditStates.updatedAt})
          from ${schema.mediaEditStates}
          where ${schema.mediaEditStates.mediaId} in (
            select ${schema.media.id}
            from ${schema.media}
            where ${schema.media.albumId} = ${albumId}
          )
        )`,
        editRevisionCount: sql<number>`(
          select count(*)::int
          from ${schema.mediaEditRevisions}
          where ${schema.mediaEditRevisions.mediaId} in (
            select ${schema.media.id}
            from ${schema.media}
            where ${schema.media.albumId} = ${albumId}
          )
        )`,
        editRevisionUpdatedAt: sql<Date | null>`(
          select max(${schema.mediaEditRevisions.updatedAt})
          from ${schema.mediaEditRevisions}
          where ${schema.mediaEditRevisions.mediaId} in (
            select ${schema.media.id}
            from ${schema.media}
            where ${schema.media.albumId} = ${albumId}
          )
        )`,
        deletionCount: sql<number>`(
          select count(*)::int
          from ${schema.deletionTasks}
          where ${schema.deletionTasks.mediaId} in (
            select ${schema.media.id}
            from ${schema.media}
            where ${schema.media.albumId} = ${albumId}
          )
        )`,
        deletionUpdatedAt: sql<Date | null>`(
          select max(${schema.deletionTasks.updatedAt})
          from ${schema.deletionTasks}
          where ${schema.deletionTasks.mediaId} in (
            select ${schema.media.id}
            from ${schema.media}
            where ${schema.media.albumId} = ${albumId}
          )
        )`,
      })
      .from(schema.albums)
      .where(eq(schema.albums.id, albumId))
      .limit(1);
    if (row === undefined) throw this.#albumNotFound();
    return createHash("sha256").update(JSON.stringify(row), "utf8").digest("base64url");
  }

  async getReviewCollaboration(
    actor: InternalActor,
    albumId: string,
  ): Promise<ReviewCollaborationView> {
    requirePermission(actor.role, "media:review");
    const album = await this.#albumById(this.#database, albumId);
    if (album === null) throw this.#albumNotFound();

    const participantRows = await this.#database
      .select({
        id: schema.users.id,
        username: schema.users.username,
        displayName: schema.users.displayName,
        role: schema.users.role,
        isActive: schema.users.isActive,
      })
      .from(schema.albumReviewCollaborators)
      .innerJoin(schema.users, eq(schema.albumReviewCollaborators.userId, schema.users.id))
      .where(eq(schema.albumReviewCollaborators.albumId, albumId))
      .orderBy(asc(schema.users.displayName), asc(schema.users.id));

    const remainingCounts = await this.#database
      .select({
        userId: schema.media.reviewAssigneeId,
        total: sql<number>`count(*)::int`,
      })
      .from(schema.media)
      .where(
        and(
          eq(schema.media.albumId, albumId),
          isNotNull(schema.media.reviewAssigneeId),
          isNull(schema.media.reviewedAt),
          sql`${schema.media.publicationStatus} <> 'deleted'`,
        ),
      )
      .groupBy(schema.media.reviewAssigneeId);
    const counts = new Map(
      remainingCounts
        .filter((row): row is { userId: string; total: number } => row.userId !== null)
        .map((row) => [row.userId, row.total] as const),
    );
    const participants = participantRows.map((row) => ({
      ...row,
      remainingCount: counts.get(row.id) ?? 0,
    }));

    const canConfigureReview = hasPermission(actor.role, "review:configure");
    const eligibleParticipants = canConfigureReview
      ? await this.#database
          .select({
            id: schema.users.id,
            username: schema.users.username,
            displayName: schema.users.displayName,
            role: schema.users.role,
            isActive: schema.users.isActive,
          })
          .from(schema.users)
          .where(
            and(
              eq(schema.users.isActive, true),
              inArray(schema.users.role, ["admin", "operator", "reviewer"]),
            ),
          )
          .orderBy(asc(schema.users.displayName), asc(schema.users.id))
      : [];
    const availableParticipants = canConfigureReview
      ? [
          ...new Map(
            [...eligibleParticipants, ...participantRows].map((row) => [row.id, row] as const),
          ).values(),
        ].sort(
          (left, right) =>
            left.displayName.localeCompare(right.displayName, "zh-CN") ||
            left.id.localeCompare(right.id),
        )
      : [];

    return {
      enabled: participants.length >= 2,
      participants,
      availableParticipants,
      currentUserParticipating: participants.some((participant) => participant.id === actor.id),
      currentUserRemainingCount: participants.some((participant) => participant.id === actor.id)
        ? (counts.get(actor.id) ?? 0)
        : null,
    };
  }

  async updateReviewCollaboration(options: {
    readonly actor: InternalActor;
    readonly albumId: string;
    readonly participantIds: readonly string[];
    readonly requestId: string;
  }): Promise<ReviewCollaborationView> {
    requirePermission(options.actor.role, "review:configure");
    const participantIds = [...new Set(options.participantIds)];
    if (participantIds.length === 1) {
      throw new AppError({
        code: "BAD_REQUEST",
        message: "审核分工至少选择 2 个账号；清空选择可关闭分工",
        statusCode: 400,
      });
    }
    const album = await this.#albumById(this.#database, options.albumId);
    if (album === null) throw this.#albumNotFound();

    const selectedUsers =
      participantIds.length === 0
        ? []
        : await this.#database
            .select({
              id: schema.users.id,
              role: schema.users.role,
              isActive: schema.users.isActive,
            })
            .from(schema.users)
            .where(inArray(schema.users.id, participantIds));
    if (
      selectedUsers.length !== participantIds.length ||
      selectedUsers.some((user) => !user.isActive || user.role === "uploader")
    ) {
      throw new AppError({
        code: "BAD_REQUEST",
        message: "只能选择已启用的管理员、协作员或审核员参与审核分工",
        statusCode: 400,
      });
    }

    await this.#database.transaction(async (transaction) => {
      await this.#advisoryLock(transaction, `review-collaboration:${options.albumId}`);
      await transaction
        .delete(schema.albumReviewCollaborators)
        .where(eq(schema.albumReviewCollaborators.albumId, options.albumId));
      if (participantIds.length > 0) {
        await transaction.insert(schema.albumReviewCollaborators).values(
          participantIds.map((userId) => ({
            albumId: options.albumId,
            userId,
          })),
        );
        await transaction.execute(sql`
          with ranked_media as (
            select id,
                   row_number() over (
                     order by (reviewed_at is not null), created_at, id
                   ) - 1 as rn
            from media
            where album_id = ${options.albumId}
              and publication_status <> 'deleted'
          ), ranked_reviewers as (
            select user_id,
                   row_number() over (order by user_id) - 1 as rn,
                   count(*) over () as total
            from album_review_collaborators
            where album_id = ${options.albumId}
          )
          update media as target
          set review_assignee_id = ranked_reviewers.user_id,
              updated_at = now()
          from ranked_media
          join ranked_reviewers
            on ranked_reviewers.rn = mod(ranked_media.rn, ranked_reviewers.total)
          where target.id = ranked_media.id
        `);
        await transaction
          .update(schema.media)
          .set({ reviewAssigneeId: null, updatedAt: new Date() })
          .where(
            and(
              eq(schema.media.albumId, options.albumId),
              eq(schema.media.publicationStatus, "deleted"),
            ),
          );
      } else {
        await transaction
          .update(schema.media)
          .set({ reviewAssigneeId: null, updatedAt: new Date() })
          .where(eq(schema.media.albumId, options.albumId));
      }
      await transaction.insert(schema.auditLogs).values({
        actorUserId: options.actor.id,
        action: "album.review_collaboration.updated",
        targetType: "album",
        targetId: options.albumId,
        result: "success",
        changedFields: ["reviewCollaborators", "reviewAssigneeId"],
        requestId: options.requestId,
      });
      await transaction.execute(sql`select pg_notify(${liveEventChannel}, ${options.albumId})`);
    });

    return this.getReviewCollaboration(options.actor, options.albumId);
  }

  async createAlbum(options: {
    readonly actor: InternalActor;
    readonly input: CreateAlbumRequest;
    readonly idempotencyKey: string | undefined;
    readonly requestId: string;
  }): Promise<{ album: AlbumView; generatedPassword: string }> {
    requirePermission(options.actor.role, "album:create");
    const idempotencyKey = requireHeaderIdempotency(options.idempotencyKey);
    const generatedPassword = this.#deriveAlbumPassword(options.actor.id, idempotencyKey);
    const passwordHash = await this.#hasher.hash(generatedPassword);

    return this.#database.transaction(async (transaction) => {
      await this.#advisoryLock(transaction, `album:${options.actor.id}:${idempotencyKey}`);
      const [existing] = await transaction
        .select()
        .from(schema.albums)
        .where(
          and(
            eq(schema.albums.createdBy, options.actor.id),
            eq(schema.albums.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (existing !== undefined) {
        return { album: albumView(existing), generatedPassword };
      }

      const [created] = await transaction
        .insert(schema.albums)
        .values({
          slug: randomBytes(12).toString("base64url"),
          title: options.input.title,
          description: options.input.description,
          publishMode: options.input.publishMode,
          access: "password",
          state: "draft",
          passwordHash,
          idempotencyKey,
          createdBy: options.actor.id,
        })
        .returning();
      if (created === undefined) throw new Error("Album insert returned no row");
      await transaction.insert(schema.auditLogs).values({
        actorUserId: options.actor.id,
        action: "album.created",
        targetType: "album",
        targetId: created.id,
        result: "success",
        changedFields: ["title", "description", "publishMode", "passwordHash"],
        requestId: options.requestId,
      });
      return { album: albumView(created), generatedPassword };
    });
  }

  async startAlbum(options: {
    readonly actor: InternalActor;
    readonly albumId: string;
    readonly requestId: string;
  }): Promise<AlbumView> {
    requirePermission(options.actor.role, "album:configure");
    return this.#database.transaction(async (transaction) => {
      await this.#advisoryLock(transaction, `album-state:${options.albumId}`);
      const album = await this.#albumById(transaction, options.albumId);
      if (album === null) throw this.#albumNotFound();
      if (album.state === "live") return albumView(album);
      if (album.state !== "draft" && album.state !== "ended") {
        throw new AppError({
          code: "STATE_CONFLICT",
          message: "当前相册状态不能开始直播",
          statusCode: 409,
        });
      }
      const now = new Date();
      const [updated] = await transaction
        .update(schema.albums)
        .set({ state: "live", updatedAt: now })
        .where(eq(schema.albums.id, album.id))
        .returning();
      if (updated === undefined) throw new Error("Album state update returned no row");
      await transaction.insert(schema.auditLogs).values({
        actorUserId: options.actor.id,
        action: "album.started",
        targetType: "album",
        targetId: album.id,
        result: "success",
        changedFields: ["state"],
        requestId: options.requestId,
      });
      return albumView(updated);
    });
  }

  async endAlbum(options: {
    readonly actor: InternalActor;
    readonly albumId: string;
    readonly requestId: string;
  }): Promise<AlbumView> {
    requirePermission(options.actor.role, "album:configure");
    return this.#transitionAlbum({
      ...options,
      from: ["live"],
      to: "ended",
      action: "album.ended",
    });
  }

  async archiveAlbum(options: {
    readonly actor: InternalActor;
    readonly albumId: string;
    readonly requestId: string;
  }): Promise<AlbumView> {
    requirePermission(options.actor.role, "album:configure");
    return this.#transitionAlbum({
      ...options,
      from: ["ended"],
      to: "archived",
      action: "album.archived",
    });
  }

  async restoreAlbum(options: {
    readonly actor: InternalActor;
    readonly albumId: string;
    readonly requestId: string;
  }): Promise<AlbumView> {
    requirePermission(options.actor.role, "album:configure");
    return this.#transitionAlbum({
      ...options,
      from: ["archived"],
      to: "ended",
      action: "album.restored",
    });
  }

  async updateAlbum(options: {
    readonly actor: InternalActor;
    readonly albumId: string;
    readonly input: UpdateAlbumRequest;
    readonly requestId: string;
  }): Promise<AlbumView> {
    requirePermission(options.actor.role, "album:configure");
    return this.#database.transaction(async (transaction) => {
      await this.#advisoryLock(transaction, `album-settings:${options.albumId}`);
      const album = await this.#albumById(transaction, options.albumId);
      if (album === null) throw this.#albumNotFound();
      const accessChanged =
        options.input.access !== undefined && options.input.access !== album.access;
      const now = new Date();
      const [updated] = await transaction
        .update(schema.albums)
        .set({
          ...options.input,
          previewDownloadEnabled: true,
          originalDownloadEnabled: true,
          ...(options.input.access === "public" ? { bibSearchEnabled: false } : {}),
          ...(accessChanged ? { accessVersion: album.accessVersion + 1 } : {}),
          updatedAt: now,
        })
        .where(eq(schema.albums.id, album.id))
        .returning();
      if (updated === undefined) throw this.#albumNotFound();
      await transaction.insert(schema.auditLogs).values({
        actorUserId: options.actor.id,
        action: "album.settings.updated",
        targetType: "album",
        targetId: album.id,
        result: "success",
        changedFields: [
          ...Object.keys(options.input).sort(),
          ...(accessChanged ? ["accessVersion"] : []),
        ],
        requestId: options.requestId,
      });
      return albumView(updated);
    });
  }

  async rotateAlbumPassword(options: {
    readonly actor: InternalActor;
    readonly albumId: string;
    readonly idempotencyKey: string | undefined;
    readonly requestId: string;
  }): Promise<{ readonly album: AlbumView; readonly generatedPassword: string }> {
    requirePermission(options.actor.role, "album:configure");
    const idempotencyKey = requireHeaderIdempotency(options.idempotencyKey);
    const generatedPassword = this.#deriveAlbumPassword(
      options.actor.id,
      `rotate:${options.albumId}:${idempotencyKey}`,
    );
    const passwordHash = await this.#hasher.hash(generatedPassword);
    return this.#database.transaction(async (transaction) => {
      const actorScope = `user:${options.actor.id}`;
      const operation = `album.password.rotate:${options.albumId}`;
      const requestHash = operationRequestHash({ albumId: options.albumId });
      await lockOperationRequest(transaction, { actorScope, operation, idempotencyKey });
      const retried = await findOperationRequest(transaction, {
        actorScope,
        operation,
        idempotencyKey,
        requestHash,
      });
      if (retried !== null) {
        return { album: retried.album as AlbumView, generatedPassword };
      }
      const album = await this.#albumById(transaction, options.albumId);
      if (album === null) throw this.#albumNotFound();
      const now = new Date();
      const [updated] = await transaction
        .update(schema.albums)
        .set({
          passwordHash,
          access: "password",
          accessVersion: album.accessVersion + 1,
          updatedAt: now,
        })
        .where(eq(schema.albums.id, album.id))
        .returning();
      if (updated === undefined) throw this.#albumNotFound();
      await transaction.insert(schema.auditLogs).values({
        actorUserId: options.actor.id,
        action: "album.password.rotated",
        targetType: "album",
        targetId: album.id,
        result: "success",
        changedFields: ["passwordHash", "access", "accessVersion"],
        requestId: options.requestId,
      });
      const view = albumView(updated);
      await saveOperationRequest(transaction, {
        actorScope,
        operation,
        idempotencyKey,
        requestHash,
        result: { album: view },
      });
      return { album: view, generatedPassword };
    });
  }

  async createCategory(options: {
    readonly actor: InternalActor;
    readonly albumId: string;
    readonly name: string;
    readonly sortOrder: number;
    readonly idempotencyKey: string | undefined;
  }) {
    requirePermission(options.actor.role, "album:configure");
    const idempotencyKey = requireHeaderIdempotency(options.idempotencyKey);
    return this.#database.transaction(async (transaction) => {
      await this.#advisoryLock(
        transaction,
        `category:${options.albumId}:${options.actor.id}:${idempotencyKey}`,
      );
      const album = await this.#albumById(transaction, options.albumId);
      if (album === null) throw this.#albumNotFound();
      const [existing] = await transaction
        .select()
        .from(schema.categories)
        .where(
          and(
            eq(schema.categories.albumId, options.albumId),
            eq(schema.categories.createdBy, options.actor.id),
            eq(schema.categories.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (existing !== undefined) return categoryView(existing);
      const [created] = await transaction
        .insert(schema.categories)
        .values({
          albumId: options.albumId,
          name: options.name,
          sortOrder: options.sortOrder,
          createdBy: options.actor.id,
          idempotencyKey,
        })
        .returning();
      if (created === undefined) throw new Error("Category insert returned no row");
      return categoryView(created);
    });
  }

  async listCategories(actor: InternalActor, albumId: string) {
    requirePermission(actor.role, "album:read");
    const album = await this.#albumById(this.#database, albumId);
    if (album === null) throw this.#albumNotFound();
    const rows = await this.#database
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.albumId, albumId))
      .orderBy(asc(schema.categories.sortOrder), asc(schema.categories.id));
    return rows.map(categoryView);
  }

  async updateCategory(options: {
    readonly actor: InternalActor;
    readonly albumId: string;
    readonly categoryId: string;
    readonly input: {
      readonly name?: string | undefined;
      readonly sortOrder?: number | undefined;
      readonly enabled?: boolean | undefined;
    };
  }) {
    requirePermission(options.actor.role, "album:configure");
    const [updated] = await this.#database
      .update(schema.categories)
      .set({ ...options.input, updatedAt: new Date() })
      .where(
        and(
          eq(schema.categories.id, options.categoryId),
          eq(schema.categories.albumId, options.albumId),
        ),
      )
      .returning();
    if (updated === undefined) {
      throw new AppError({ code: "NOT_FOUND", message: "分类不存在", statusCode: 404 });
    }
    return categoryView(updated);
  }

  async createPhotoUpload(options: {
    readonly actor: InternalActor;
    readonly input: CreatePhotoUploadRequest;
    readonly idempotencyKey: string | undefined;
  }): Promise<UploadIntentView> {
    requirePermission(options.actor.role, "media:upload");
    const idempotencyKey = requireHeaderIdempotency(options.idempotencyKey);
    const intentId = await this.#database.transaction(async (transaction) => {
      await this.#advisoryLock(transaction, `upload:${options.actor.id}:${idempotencyKey}`);
      const [existing] = await transaction
        .select({ id: schema.uploadIntents.id })
        .from(schema.uploadIntents)
        .where(
          and(
            eq(schema.uploadIntents.uploaderId, options.actor.id),
            eq(schema.uploadIntents.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (existing !== undefined) return existing.id;

      await transaction.execute(
        sql`select pg_advisory_xact_lock_shared(hashtextextended(${`album-state:${options.input.albumId}`}, 0))`,
      );
      const album = await this.#albumById(transaction, options.input.albumId);
      if (album === null) throw this.#albumNotFound();
      if (album.state !== "live") {
        throw new AppError({
          code: "ALBUM_NOT_LIVE",
          message: "相册未在直播中，不能创建上传任务",
          statusCode: 409,
        });
      }
      if (options.input.categoryId !== null) {
        const [category] = await transaction
          .select({ id: schema.categories.id })
          .from(schema.categories)
          .where(
            and(
              eq(schema.categories.id, options.input.categoryId),
              eq(schema.categories.albumId, album.id),
              eq(schema.categories.enabled, true),
            ),
          )
          .limit(1);
        if (category === undefined) {
          throw new AppError({ code: "BAD_REQUEST", message: "分类无效", statusCode: 400 });
        }
      }
      await this.#advisoryLock(transaction, `album-media-quota:${album.id}`);
      const countRows = await transaction
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.media)
        .where(eq(schema.media.albumId, album.id));
      if ((countRows[0]?.count ?? 0) >= 5_000) {
        throw new AppError({
          code: "MEDIA_LIMIT_EXCEEDED",
          message: "相册照片数量已达到 5000 张上限",
          statusCode: 409,
        });
      }

      const requestedBytes = options.input.variants.reduce(
        (sum, variant) => sum + variant.bytes,
        0,
      );
      await this.#advisoryLock(transaction, `uploader-upload-quota:${options.actor.id}`);
      const quotaNow = new Date();
      const [uploaderQuota] = await transaction
        .select({
          activeIntents: sql<number>`count(distinct ${schema.uploadIntents.id})::int`,
          outstandingBytes: sql<number>`coalesce(sum(case when ${schema.mediaVariants.verified} = false then ${schema.mediaVariants.expectedBytes} else 0 end), 0)::bigint`,
        })
        .from(schema.uploadIntents)
        .innerJoin(
          schema.mediaVariants,
          eq(schema.mediaVariants.mediaId, schema.uploadIntents.mediaId),
        )
        .where(
          and(
            eq(schema.uploadIntents.uploaderId, options.actor.id),
            eq(schema.uploadIntents.status, "active"),
            gt(schema.uploadIntents.expiresAt, quotaNow),
          ),
        );
      if ((uploaderQuota?.activeIntents ?? 0) >= maxActiveUploadIntentsPerUploader) {
        throw new AppError({
          code: "MEDIA_LIMIT_EXCEEDED",
          message: "同时进行的上传任务过多，请等待现有上传完成后重试",
          statusCode: 409,
        });
      }
      if (
        Number(uploaderQuota?.outstandingBytes ?? 0) + requestedBytes >
        maxOutstandingUploadBytesPerUploader
      ) {
        throw new AppError({
          code: "MEDIA_LIMIT_EXCEEDED",
          message: "未完成上传占用已达到上限，请等待现有上传完成后重试",
          statusCode: 409,
        });
      }
      const [albumQuota] = await transaction
        .select({
          reservedBytes: sql<number>`coalesce(sum(${schema.mediaVariants.expectedBytes}), 0)::bigint`,
        })
        .from(schema.mediaVariants)
        .innerJoin(schema.media, eq(schema.mediaVariants.mediaId, schema.media.id))
        .where(
          and(
            eq(schema.media.albumId, album.id),
            sql`${schema.media.publicationStatus} <> 'deleted'`,
          ),
        );
      if (Number(albumQuota?.reservedBytes ?? 0) + requestedBytes > maxAlbumReservedBytes) {
        throw new AppError({
          code: "MEDIA_LIMIT_EXCEEDED",
          message: "相册已达到 256 GiB 上传配额",
          statusCode: 409,
        });
      }

      const original = options.input.variants.find((variant) => variant.kind === "photo_original");
      if (original === undefined) throw new Error("Validated upload lacks original variant");
      const [createdMedia] = await transaction
        .insert(schema.media)
        .values({
          albumId: album.id,
          categoryId: options.input.categoryId,
          uploaderId: options.actor.id,
          ingestStatus: "uploading_preview",
          publicationStatus: "draft",
          width: options.input.width,
          height: options.input.height,
          mediaType: original.contentType,
          totalBytes: options.input.totalBytes,
          capturedAt: options.input.capturedAt === null ? null : new Date(options.input.capturedAt),
        })
        .returning({ id: schema.media.id });
      if (createdMedia === undefined) throw new Error("Media insert returned no row");
      const createdVariants = await transaction
        .insert(schema.mediaVariants)
        .values(
          options.input.variants.map((variant) => ({
            mediaId: createdMedia.id,
            kind: variant.kind,
            objectKey: `media/albums/${album.id}/photos/${createdMedia.id}/${variantFilename(variant.kind, variant.format)}`,
            format: variant.format,
            contentType: variant.contentType,
            width: variant.width,
            height: variant.height,
            expectedBytes: variant.bytes,
          })),
        )
        .returning({ id: schema.mediaVariants.id, kind: schema.mediaVariants.kind });
      if (original.bytes > multipartThreshold) {
        const originalVariant = createdVariants.find(
          (variant) => variant.kind === "photo_original",
        );
        if (originalVariant === undefined)
          throw new Error("Original variant insert returned no row");
        const partCount = Math.ceil(original.bytes / multipartPartBytes);
        await transaction.insert(schema.uploadParts).values(
          Array.from({ length: partCount }, (_, index) => ({
            variantId: originalVariant.id,
            partNumber: index + 1,
            expectedBytes: Math.min(
              multipartPartBytes,
              original.bytes - index * multipartPartBytes,
            ),
          })),
        );
      }
      const [intent] = await transaction
        .insert(schema.uploadIntents)
        .values({
          mediaId: createdMedia.id,
          uploaderId: options.actor.id,
          idempotencyKey,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
        })
        .returning({ id: schema.uploadIntents.id });
      if (intent === undefined) throw new Error("Upload intent insert returned no row");
      return intent.id;
    });
    return this.getUploadIntent(options.actor, intentId);
  }

  async getUploadIntent(actor: InternalActor, intentId: string): Promise<UploadIntentView> {
    const [row] = await this.#database
      .select({ intent: schema.uploadIntents, media: schema.media })
      .from(schema.uploadIntents)
      .innerJoin(schema.media, eq(schema.uploadIntents.mediaId, schema.media.id))
      .where(eq(schema.uploadIntents.id, intentId))
      .limit(1);
    if (row === undefined) throw this.#uploadNotFound();
    this.#assertUploadAccess(actor, row.media.uploaderId);
    const variants = await this.#database
      .select()
      .from(schema.mediaVariants)
      .where(eq(schema.mediaVariants.mediaId, row.media.id))
      .orderBy(asc(schema.mediaVariants.kind));
    const parts = await this.#database
      .select()
      .from(schema.uploadParts)
      .where(
        inArray(
          schema.uploadParts.variantId,
          variants.map((variant) => variant.id),
        ),
      )
      .orderBy(asc(schema.uploadParts.partNumber));
    const partsByVariant = new Map<string, typeof parts>();
    for (const part of parts) {
      const current = partsByVariant.get(part.variantId) ?? [];
      current.push(part);
      partsByVariant.set(part.variantId, current);
    }
    return {
      id: row.intent.id,
      mediaId: row.media.id,
      status: row.intent.status,
      cleanupStatus: row.intent.cleanupStatus,
      cleanupLastErrorCode: row.intent.cleanupLastErrorCode,
      ingestStatus: row.media.ingestStatus,
      publicationStatus: row.media.publicationStatus,
      expiresAt: iso(row.intent.expiresAt),
      objects: variants
        .filter((variant) => photoVariantKinds.includes(variant.kind as PhotoVariantKind))
        .map((variant) => {
          const variantParts = partsByVariant.get(variant.id) ?? [];
          return {
            kind: variant.kind as PhotoVariantKind,
            objectKey: variant.objectKey,
            expectedBytes: variant.expectedBytes,
            contentType: variant.contentType,
            completed: variant.verified,
            uploadMode: variantParts.length === 0 ? ("single" as const) : ("multipart" as const),
            multipartUploadId: variantParts.length === 0 ? null : variant.id,
            parts: variantParts.map((part) => ({
              partNumber: part.partNumber,
              expectedBytes: part.expectedBytes,
              completed: part.completedAt !== null,
              etag: part.etag,
            })),
          };
        }),
    };
  }

  async cancelUpload(options: {
    readonly actor: InternalActor;
    readonly intentId: string;
  }): Promise<UploadIntentView> {
    const now = new Date();
    await this.#database.transaction(async (transaction) => {
      await this.#advisoryLock(transaction, `upload-cleanup:${options.intentId}`);
      const [row] = await transaction
        .select({ intent: schema.uploadIntents, media: schema.media })
        .from(schema.uploadIntents)
        .innerJoin(schema.media, eq(schema.uploadIntents.mediaId, schema.media.id))
        .where(eq(schema.uploadIntents.id, options.intentId))
        .limit(1);
      if (row === undefined) throw this.#uploadNotFound();
      this.#assertUploadAccess(options.actor, row.media.uploaderId);
      if (row.intent.status === "completed" || row.intent.cleanupStatus === "completed") return;
      await transaction
        .update(schema.uploadIntents)
        .set({
          status: "cancelled",
          cleanupStatus: "pending",
          cleanupLastErrorCode: null,
          cleanupNextAttemptAt: new Date(now.getTime() + uploadCleanupInitialGraceMs),
          updatedAt: now,
        })
        .where(eq(schema.uploadIntents.id, row.intent.id));
    });
    return this.getUploadIntent(options.actor, options.intentId);
  }

  async processExpiredUploadCleanups(limit = 10, now = new Date()): Promise<number> {
    await this.#database
      .update(schema.uploadIntents)
      .set({
        status: "expired",
        cleanupStatus: "pending",
        cleanupLastErrorCode: null,
        cleanupNextAttemptAt: new Date(now.getTime() + uploadCleanupInitialGraceMs),
        updatedAt: now,
      })
      .where(
        and(eq(schema.uploadIntents.status, "active"), lte(schema.uploadIntents.expiresAt, now)),
      );
    const intents = await this.#database
      .select({ id: schema.uploadIntents.id })
      .from(schema.uploadIntents)
      .where(
        and(
          inArray(schema.uploadIntents.status, ["cancelled", "expired"]),
          inArray(schema.uploadIntents.cleanupStatus, ["pending", "processing", "failed"]),
          or(
            isNull(schema.uploadIntents.cleanupNextAttemptAt),
            lte(schema.uploadIntents.cleanupNextAttemptAt, now),
          ),
        ),
      )
      .orderBy(asc(schema.uploadIntents.cleanupNextAttemptAt), asc(schema.uploadIntents.id))
      .limit(limit);
    for (const intent of intents) await this.processUploadCleanup(intent.id, now);
    return intents.length;
  }

  async processUploadCleanup(intentId: string, now = new Date()): Promise<void> {
    const claimed = await this.#database.transaction(async (transaction) => {
      await this.#advisoryLock(transaction, `upload-cleanup:${intentId}`);
      const [row] = await transaction
        .select({ intent: schema.uploadIntents, media: schema.media })
        .from(schema.uploadIntents)
        .innerJoin(schema.media, eq(schema.uploadIntents.mediaId, schema.media.id))
        .where(eq(schema.uploadIntents.id, intentId))
        .limit(1);
      if (
        row === undefined ||
        (row.intent.status !== "cancelled" && row.intent.status !== "expired") ||
        row.intent.cleanupStatus === "completed" ||
        row.intent.cleanupStatus === "not_needed" ||
        (row.intent.cleanupNextAttemptAt !== null && row.intent.cleanupNextAttemptAt > now)
      ) {
        return null;
      }
      const [intent] = await transaction
        .update(schema.uploadIntents)
        .set({
          cleanupStatus: "processing",
          cleanupAttempts: row.intent.cleanupAttempts + 1,
          cleanupLastErrorCode: null,
          cleanupNextAttemptAt: new Date(now.getTime() + 5 * 60 * 1_000),
          updatedAt: now,
        })
        .where(eq(schema.uploadIntents.id, intentId))
        .returning();
      return intent === undefined ? null : { intent, media: row.media };
    });
    if (claimed === null) return;

    const variants = await this.#database
      .select()
      .from(schema.mediaVariants)
      .where(eq(schema.mediaVariants.mediaId, claimed.media.id));
    const parts =
      variants.length === 0
        ? []
        : await this.#database
            .select({ variantId: schema.uploadParts.variantId })
            .from(schema.uploadParts)
            .where(
              inArray(
                schema.uploadParts.variantId,
                variants.map((variant) => variant.id),
              ),
            );
    const multipartVariantIds = new Set(parts.map((part) => part.variantId));
    const preserveVerified =
      claimed.media.publicationStatus === "published" ||
      claimed.media.publicationStatus === "pending_review";
    const cleanedVariants = variants.filter((variant) => !(preserveVerified && variant.verified));
    const editRevisions = preserveVerified
      ? []
      : await this.#database
          .select({ id: schema.mediaEditRevisions.id })
          .from(schema.mediaEditRevisions)
          .where(eq(schema.mediaEditRevisions.mediaId, claimed.media.id));
    const editRevisionIds = editRevisions.map((revision) => revision.id);
    const editVariants =
      editRevisionIds.length === 0
        ? []
        : await this.#database
            .select({
              id: schema.mediaEditVariants.id,
              editRevisionId: schema.mediaEditVariants.editRevisionId,
              objectKey: schema.mediaEditVariants.objectKey,
            })
            .from(schema.mediaEditVariants)
            .where(inArray(schema.mediaEditVariants.editRevisionId, editRevisionIds));
    try {
      for (const variant of variants) {
        if (multipartVariantIds.has(variant.id)) {
          await this.#storage.abortMultipart(
            variant.providerMultipartUploadId ?? variant.id,
            variant.objectKey,
          );
        }
      }
      for (const variant of cleanedVariants) await this.#storage.delete(variant.objectKey);
      for (const variant of editVariants) await this.#storage.delete(variant.objectKey);
    } catch {
      const retryDelay = Math.min(60 * 60 * 1_000, 30_000 * 2 ** claimed.intent.cleanupAttempts);
      await this.#database
        .update(schema.uploadIntents)
        .set({
          cleanupStatus: "failed",
          cleanupLastErrorCode: "UPLOAD_CLEANUP_FAILED",
          cleanupNextAttemptAt: new Date(now.getTime() + retryDelay),
          updatedAt: now,
        })
        .where(eq(schema.uploadIntents.id, intentId));
      return;
    }

    const preservedKinds = new Set(
      variants
        .filter((variant) => preserveVerified && variant.verified)
        .map((variant) => variant.kind),
    );
    const ingestStatus = preserveVerified
      ? photoVariantKinds.every((kind) => preservedKinds.has(kind))
        ? "ready"
        : [...previewVariantKinds].every((kind) => preservedKinds.has(kind))
          ? "preview_ready"
          : "failed"
      : "cancelled";
    await this.#database.transaction(async (transaction) => {
      await this.#advisoryLock(transaction, `upload-cleanup:${intentId}`);
      if (variants.length > 0) {
        await transaction.delete(schema.uploadParts).where(
          inArray(
            schema.uploadParts.variantId,
            variants.map((variant) => variant.id),
          ),
        );
      }
      if (editRevisionIds.length > 0) {
        await transaction
          .delete(schema.mediaEditStates)
          .where(eq(schema.mediaEditStates.mediaId, claimed.media.id));
        await transaction
          .delete(schema.mediaEditVariants)
          .where(inArray(schema.mediaEditVariants.editRevisionId, editRevisionIds));
        await transaction
          .delete(schema.mediaEditRevisions)
          .where(inArray(schema.mediaEditRevisions.id, editRevisionIds));
      }
      if (cleanedVariants.length > 0) {
        await transaction.delete(schema.mediaVariants).where(
          inArray(
            schema.mediaVariants.id,
            cleanedVariants.map((variant) => variant.id),
          ),
        );
      }
      await transaction
        .update(schema.media)
        .set({ ingestStatus, retryable: false, updatedAt: now })
        .where(eq(schema.media.id, claimed.media.id));
      const successfulSweeps = claimed.intent.cleanupSuccessfulSweeps + 1;
      const completed = successfulSweeps >= 2;
      await transaction
        .update(schema.uploadIntents)
        .set({
          cleanupStatus: completed ? "completed" : "pending",
          cleanupSuccessfulSweeps: successfulSweeps,
          cleanupLastErrorCode: null,
          cleanupNextAttemptAt: completed
            ? now
            : new Date(now.getTime() + uploadCleanupVerificationDelayMs),
          cleanupCompletedAt: completed ? now : null,
          updatedAt: now,
        })
        .where(eq(schema.uploadIntents.id, intentId));
    });
  }

  async signUpload(options: {
    readonly actor: InternalActor;
    readonly intentId: string;
    readonly kind: PhotoVariantKind;
  }) {
    return this.#database.transaction(async (transaction) => {
      await this.#lockUploadAlbumShared(transaction, options.intentId);
      const row = await this.#uploadVariant(options.intentId, options.kind, transaction);
      this.#assertUploadAccess(options.actor, row.media.uploaderId);
      if (row.intent.status !== "active" || row.intent.expiresAt <= new Date()) {
        throw new AppError({ code: "STATE_CONFLICT", message: "上传任务已失效", statusCode: 409 });
      }
      if (row.variant.verified) {
        throw new AppError({ code: "STATE_CONFLICT", message: "该对象已经完成", statusCode: 409 });
      }
      const multipartParts = await transaction
        .select({ id: schema.uploadParts.id })
        .from(schema.uploadParts)
        .where(eq(schema.uploadParts.variantId, row.variant.id))
        .limit(1);
      if (multipartParts.length > 0) {
        throw new AppError({
          code: "STATE_CONFLICT",
          message: "该对象必须使用分片上传",
          statusCode: 409,
        });
      }
      const signed = await this.#storage.signPut({
        key: row.variant.objectKey,
        contentType: row.variant.contentType,
        bytes: row.variant.expectedBytes,
        expiresAt: new Date(Date.now() + 15 * 60 * 1_000),
      });
      if (options.kind === "photo_1920" || options.kind === "photo_original") {
        await this.#markSourceUploading(row.media.id, transaction);
      }
      return {
        url: signed.url,
        headers: signed.headers,
        expiresAt: iso(signed.expiresAt),
      };
    });
  }

  async signUploadPart(options: {
    readonly actor: InternalActor;
    readonly intentId: string;
    readonly kind: PhotoVariantKind;
    readonly partNumber: number;
  }) {
    return this.#database.transaction(async (transaction) => {
      await this.#lockUploadAlbumShared(transaction, options.intentId);
      const row = await this.#uploadPart(
        options.intentId,
        options.kind,
        options.partNumber,
        transaction,
      );
      this.#assertUploadAccess(options.actor, row.media.uploaderId);
      if (row.intent.status !== "active" || row.intent.expiresAt <= new Date()) {
        throw new AppError({ code: "STATE_CONFLICT", message: "上传任务已失效", statusCode: 409 });
      }
      if (row.variant.verified || row.part.completedAt !== null) {
        throw new AppError({ code: "STATE_CONFLICT", message: "该分片已经完成", statusCode: 409 });
      }
      const providerUploadId = await this.#ensureMultipartUpload(row.variant, transaction);
      const signed = await this.#storage.signMultipartPart({
        key: row.variant.objectKey,
        uploadId: providerUploadId,
        partNumber: row.part.partNumber,
        contentType: row.variant.contentType,
        bytes: row.part.expectedBytes,
        expiresAt: new Date(Date.now() + 15 * 60 * 1_000),
      });
      await this.#markSourceUploading(row.media.id, transaction);
      return {
        url: signed.url,
        headers: signed.headers,
        expiresAt: iso(signed.expiresAt),
      };
    });
  }

  async completeUploadPart(options: {
    readonly actor: InternalActor;
    readonly intentId: string;
    readonly kind: PhotoVariantKind;
    readonly partNumber: number;
    readonly etag: string;
  }): Promise<UploadIntentView> {
    const row = await this.#uploadPart(options.intentId, options.kind, options.partNumber);
    this.#assertUploadAccess(options.actor, row.media.uploaderId);
    const etag = options.etag.replace(/^"|"$/gu, "");
    const now = new Date();
    if (row.intent.status !== "active" || row.intent.expiresAt <= now) {
      throw new AppError({ code: "STATE_CONFLICT", message: "上传任务已失效", statusCode: 409 });
    }
    await this.#database.transaction(async (transaction) => {
      await this.#advisoryLock(transaction, `upload-cleanup:${options.intentId}`);
      const [intent] = await transaction
        .select()
        .from(schema.uploadIntents)
        .where(eq(schema.uploadIntents.id, options.intentId))
        .limit(1);
      const [part] = await transaction
        .select()
        .from(schema.uploadParts)
        .where(eq(schema.uploadParts.id, row.part.id))
        .limit(1);
      if (
        intent === undefined ||
        part === undefined ||
        intent.status !== "active" ||
        intent.expiresAt <= now
      ) {
        throw new AppError({ code: "STATE_CONFLICT", message: "上传任务已失效", statusCode: 409 });
      }
      if (part.completedAt !== null) {
        if (part.etag !== etag) {
          throw new AppError({
            code: "STATE_CONFLICT",
            message: "分片 ETag 冲突",
            statusCode: 409,
          });
        }
        return;
      }
      await transaction
        .update(schema.uploadParts)
        .set({ etag, completedAt: now })
        .where(eq(schema.uploadParts.id, part.id));
    });
    return this.getUploadIntent(options.actor, options.intentId);
  }

  async completeUploadObject(options: {
    readonly actor: InternalActor;
    readonly intentId: string;
    readonly kind: PhotoVariantKind;
  }): Promise<UploadIntentView> {
    const snapshot = await this.#uploadVariant(options.intentId, options.kind);
    this.#assertUploadAccess(options.actor, snapshot.media.uploaderId);
    if (snapshot.intent.status !== "active" || snapshot.intent.expiresAt <= new Date()) {
      throw new AppError({ code: "STATE_CONFLICT", message: "上传任务已失效", statusCode: 409 });
    }
    const multipartParts = await this.#database
      .select()
      .from(schema.uploadParts)
      .where(eq(schema.uploadParts.variantId, snapshot.variant.id))
      .orderBy(asc(schema.uploadParts.partNumber));
    if (multipartParts.length > 0 && !snapshot.variant.verified) {
      if (multipartParts.some((part) => part.completedAt === null || part.etag === null)) {
        throw new AppError({
          code: "STATE_CONFLICT",
          message: "仍有分片未完成",
          statusCode: 409,
        });
      }
      await this.#storage.completeMultipart({
        uploadId: await this.#ensureMultipartUpload(snapshot.variant),
        key: snapshot.variant.objectKey,
        contentType: snapshot.variant.contentType,
        parts: multipartParts.map((part) => ({
          partNumber: part.partNumber,
          etag: part.etag as string,
        })),
      });
    }
    const metadata = await this.#storage.head(snapshot.variant.objectKey);
    if (
      metadata === null ||
      metadata.bytes !== snapshot.variant.expectedBytes ||
      metadata.contentType !== snapshot.variant.contentType
    ) {
      throw new AppError({
        code: "OBJECT_VERIFICATION_FAILED",
        message: "对象校验失败，请重新上传",
        statusCode: 409,
        retryable: true,
      });
    }

    await this.#database.transaction(async (transaction) => {
      await this.#advisoryLock(transaction, `upload-cleanup:${options.intentId}`);
      await this.#advisoryLock(transaction, `media:${snapshot.media.id}`);
      const [currentIntent] = await transaction
        .select()
        .from(schema.uploadIntents)
        .where(eq(schema.uploadIntents.id, options.intentId))
        .limit(1);
      if (
        currentIntent === undefined ||
        currentIntent.status !== "active" ||
        currentIntent.expiresAt <= new Date()
      ) {
        throw new AppError({ code: "STATE_CONFLICT", message: "上传任务已失效", statusCode: 409 });
      }
      const [currentVariant] = await transaction
        .select()
        .from(schema.mediaVariants)
        .where(eq(schema.mediaVariants.id, snapshot.variant.id))
        .limit(1);
      if (currentVariant === undefined) throw this.#uploadNotFound();
      if (currentVariant.verified) return;

      const now = new Date();
      await transaction
        .update(schema.mediaVariants)
        .set({
          verified: true,
          bytes: metadata.bytes,
          etag: metadata.etag,
          completedAt: now,
        })
        .where(eq(schema.mediaVariants.id, currentVariant.id));
      const variants = await transaction
        .select()
        .from(schema.mediaVariants)
        .where(eq(schema.mediaVariants.mediaId, snapshot.media.id));
      const verifiedKinds = new Set(
        variants
          .filter((variant) => variant.verified || variant.id === currentVariant.id)
          .map((variant) => variant.kind as PhotoVariantKind),
      );
      const previewReady = [...previewVariantKinds].every((kind) => verifiedKinds.has(kind));
      const allReady = photoVariantKinds.every((kind) => verifiedKinds.has(kind));
      const [currentMedia] = await transaction
        .select()
        .from(schema.media)
        .where(eq(schema.media.id, snapshot.media.id))
        .limit(1);
      if (currentMedia === undefined) throw this.#uploadNotFound();
      let publicationStatus = currentMedia.publicationStatus;
      let publishSequence = currentMedia.publishSequence;
      let publishedAt = currentMedia.publishedAt;

      if (previewReady && publicationStatus === "draft") {
        const album = await this.#albumById(transaction, currentMedia.albumId);
        if (album === null) throw this.#albumNotFound();
        if (
          album.publishMode === "auto" &&
          !(await this.#hasPendingEdit(transaction, currentMedia.id))
        ) {
          const published = await this.#allocatePublication(
            transaction,
            album.id,
            currentMedia.id,
            now,
          );
          publicationStatus = "published";
          publishSequence = published.publishSequence;
          publishedAt = now;
        } else {
          publicationStatus = "pending_review";
        }
      }

      await transaction
        .update(schema.media)
        .set({
          ingestStatus: allReady
            ? "ready"
            : previewReady &&
                (currentMedia.ingestStatus === "uploading_source" ||
                  verifiedKinds.has("photo_1920") ||
                  verifiedKinds.has("photo_original"))
              ? "uploading_source"
              : previewReady
                ? "preview_ready"
                : "uploading_preview",
          publicationStatus,
          publishSequence,
          publishedAt,
          updatedAt: now,
        })
        .where(eq(schema.media.id, currentMedia.id));
      if (allReady) {
        await transaction
          .update(schema.uploadIntents)
          .set({ status: "completed", updatedAt: now })
          .where(eq(schema.uploadIntents.id, options.intentId));
        if (currentMedia.publicationStatus === "published") {
          await this.#insertLiveEvent(transaction, {
            albumId: currentMedia.albumId,
            mediaId: currentMedia.id,
            type: "media.updated",
          });
        }
      }
    });
    return this.getUploadIntent(options.actor, options.intentId);
  }

  async publishMedia(options: {
    readonly actor: InternalActor;
    readonly mediaId: string;
    readonly requestId: string;
    readonly idempotencyKey: string | undefined;
  }): Promise<void> {
    requirePermission(options.actor.role, "media:review");
    const idempotencyKey = requireHeaderIdempotency(options.idempotencyKey);
    await this.#database.transaction(async (transaction) => {
      const actorScope = `user:${options.actor.id}`;
      const operation = `media.publish:${options.mediaId}`;
      const requestHash = operationRequestHash({ mediaId: options.mediaId });
      await lockOperationRequest(transaction, { actorScope, operation, idempotencyKey });
      if (
        (await findOperationRequest(transaction, {
          actorScope,
          operation,
          idempotencyKey,
          requestHash,
        })) !== null
      ) {
        return;
      }
      await this.#advisoryLock(transaction, `media:${options.mediaId}`);
      const [media] = await transaction
        .select()
        .from(schema.media)
        .where(eq(schema.media.id, options.mediaId))
        .limit(1);
      if (media === undefined) throw this.#uploadNotFound();
      if (media.publicationStatus !== "published" && media.publicationStatus !== "pending_review") {
        throw new AppError({
          code: "STATE_CONFLICT",
          message: "媒体尚未达到可发布状态",
          statusCode: 409,
        });
      }
      if (media.publicationStatus === "pending_review") {
        if (media.ingestStatus !== "ready") {
          throw new AppError({
            code: "STATE_CONFLICT",
            message: "照片尚未上传完成，不能显示",
            statusCode: 409,
          });
        }
        if (await this.#hasPendingEdit(transaction, media.id)) {
          throw new AppError({
            code: "STATE_CONFLICT",
            message: "修图版本仍在处理中，完成或取消后才能显示",
            statusCode: 409,
          });
        }
        await this.#allocatePublication(transaction, media.albumId, media.id, new Date());
        await transaction.insert(schema.auditLogs).values({
          actorUserId: options.actor.id,
          action: "media.published",
          targetType: "media",
          targetId: media.id,
          result: "success",
          changedFields: ["publicationStatus", "publishSequence"],
          requestId: options.requestId,
        });
      }
      await saveOperationRequest(transaction, {
        actorScope,
        operation,
        idempotencyKey,
        requestHash,
        result: { mediaId: options.mediaId },
      });
    });
  }

  async markMediaReviewed(options: {
    readonly actor: InternalActor;
    readonly mediaId: string;
    readonly requestId: string;
  }): Promise<void> {
    requirePermission(options.actor.role, "media:review");
    await this.#database.transaction(async (transaction) => {
      const [media] = await transaction
        .select({
          albumId: schema.media.albumId,
          publicationStatus: schema.media.publicationStatus,
        })
        .from(schema.media)
        .where(eq(schema.media.id, options.mediaId))
        .limit(1);
      if (media === undefined || media.publicationStatus === "deleted")
        throw this.#uploadNotFound();
      await this.#advisoryLock(transaction, `review-collaboration:${media.albumId}`);
      const now = new Date();
      const [updated] = await transaction
        .update(schema.media)
        .set({ reviewedAt: now, updatedAt: now })
        .where(
          and(
            eq(schema.media.id, options.mediaId),
            isNull(schema.media.reviewedAt),
            sql`${schema.media.publicationStatus} <> 'deleted'`,
          ),
        )
        .returning({ id: schema.media.id });
      if (updated === undefined) {
        const [existing] = await transaction
          .select({ publicationStatus: schema.media.publicationStatus })
          .from(schema.media)
          .where(eq(schema.media.id, options.mediaId))
          .limit(1);
        if (existing === undefined || existing.publicationStatus === "deleted") {
          throw this.#uploadNotFound();
        }
        return;
      }
      await transaction.insert(schema.auditLogs).values({
        actorUserId: options.actor.id,
        action: "media.reviewed",
        targetType: "media",
        targetId: options.mediaId,
        result: "success",
        changedFields: ["reviewedAt"],
        requestId: options.requestId,
      });
      await transaction.execute(sql`select pg_notify(${liveEventChannel}, ${media.albumId})`);
    });
  }

  async refreshPublicVariant(options: {
    readonly slug: string;
    readonly visitorToken: string | undefined;
    readonly mediaId: string;
    readonly kind: DerivedPhotoVariantKind;
  }) {
    const album = await this.#publicAlbumBySlug(options.slug);
    if (!(await this.#isVisitorAuthorized(album, options.visitorToken)))
      throw this.#albumNotFound();
    const [media] = await this.#database
      .select()
      .from(schema.media)
      .where(
        and(
          eq(schema.media.id, options.mediaId),
          eq(schema.media.albumId, album.id),
          eq(schema.media.publicationStatus, "published"),
          isNotNull(schema.media.publishSequence),
        ),
      )
      .limit(1);
    if (media === undefined) throw this.#albumNotFound();
    return this.#refreshVariant(media.id, options.kind, 2 * 60 * 60 * 1_000);
  }

  async refreshInternalVariant(
    actor: { readonly id: string; readonly role: UserRole },
    options: {
      readonly mediaId: string;
      readonly kind: DerivedPhotoVariantKind;
    },
  ) {
    requirePermission(actor.role, "album:read");
    const [media] = await this.#database
      .select()
      .from(schema.media)
      .where(
        and(
          eq(schema.media.id, options.mediaId),
          ...(actor.role === "uploader" ? [eq(schema.media.uploaderId, actor.id)] : []),
        ),
      )
      .limit(1);
    if (media === undefined || media.publicationStatus === "deleted") throw this.#albumNotFound();
    if ((await this.#albumById(this.#database, media.albumId)) === null)
      throw this.#albumNotFound();
    return this.#refreshVariant(media.id, options.kind, 15 * 60 * 1_000);
  }

  async #refreshVariant(mediaId: string, kind: DerivedPhotoVariantKind, ttlMilliseconds: number) {
    if (!publicVariantKinds.has(kind)) throw this.#albumNotFound();
    const [editState] = await this.#database
      .select({ activeRevisionId: schema.mediaEditStates.activeRevisionId })
      .from(schema.mediaEditStates)
      .where(eq(schema.mediaEditStates.mediaId, mediaId))
      .limit(1);
    if (editState?.activeRevisionId !== null && editState?.activeRevisionId !== undefined) {
      const [editVariant] = await this.#database
        .select()
        .from(schema.mediaEditVariants)
        .where(
          and(
            eq(schema.mediaEditVariants.editRevisionId, editState.activeRevisionId),
            eq(schema.mediaEditVariants.kind, kind),
            eq(schema.mediaEditVariants.verified, true),
            isNotNull(schema.mediaEditVariants.bytes),
          ),
        )
        .limit(1);
      if (editVariant !== undefined && editVariant.bytes !== null) {
        const expiresAt = previewExpiresAt(ttlMilliseconds);
        return {
          url: this.#storage.signRead({
            key: editVariant.objectKey,
            expiresAt,
            stable: true,
          }),
          expiresAt: expiresAt.toISOString(),
          bytes: editVariant.bytes,
        };
      }
    }
    const [variant] = await this.#database
      .select()
      .from(schema.mediaVariants)
      .where(
        and(
          eq(schema.mediaVariants.mediaId, mediaId),
          eq(schema.mediaVariants.kind, kind),
          eq(schema.mediaVariants.verified, true),
          isNotNull(schema.mediaVariants.bytes),
        ),
      )
      .limit(1);
    if (variant === undefined || variant.bytes === null) throw this.#albumNotFound();
    const expiresAt = previewExpiresAt(ttlMilliseconds);
    return {
      url: this.#storage.signRead({
        key: variant.objectKey,
        expiresAt,
        stable: true,
      }),
      expiresAt: expiresAt.toISOString(),
      bytes: variant.bytes,
    };
  }

  async listInternalMedia(
    actor: InternalActor,
    options: {
      readonly albumId: string;
      readonly publicationStatus?:
        | (typeof schema.publicationStatusEnum.enumValues)[number]
        | undefined;
      readonly publicationGroup?: "unpublished" | undefined;
      readonly featured?: "true" | undefined;
      readonly ingestStatus?: (typeof schema.ingestStatusEnum.enumValues)[number] | undefined;
      readonly ingestGroup?: "incomplete" | "failed" | undefined;
      readonly categoryId?: string | undefined;
      readonly uploaderId?: string | undefined;
      readonly reviewAssignment?: "mine" | undefined;
      readonly bibReviewDecision?:
        | (typeof schema.bibReviewDecisionEnum.enumValues)[number]
        | undefined;
      readonly bibOcrStatus?: (typeof schema.bibOcrStatusEnum.enumValues)[number] | undefined;
      readonly gradeOptionId?: string | undefined;
      readonly classOptionId?: string | undefined;
      readonly sort?: "newest" | "oldest";
      readonly cursor?: string | undefined;
      readonly limit: number;
    },
  ) {
    requirePermission(actor.role, "album:read");
    const album = await this.#albumById(this.#database, options.albumId);
    if (album === null) throw this.#albumNotFound();
    const cursor =
      options.cursor === undefined
        ? null
        : this.#decodeInternalCursor(options.cursor, options.albumId, options.sort ?? "newest");
    const conditions = [eq(schema.media.albumId, options.albumId)];
    if (options.publicationStatus !== undefined) {
      conditions.push(eq(schema.media.publicationStatus, options.publicationStatus));
    } else if (options.publicationGroup === "unpublished") {
      conditions.push(inArray(schema.media.publicationStatus, ["draft", "pending_review"]));
    }
    if (options.featured === "true") {
      conditions.push(
        exists(
          this.#database
            .select({ value: sql`1` })
            .from(schema.featuredMedia)
            .where(eq(schema.featuredMedia.mediaId, schema.media.id)),
        ),
      );
    }
    if (options.ingestStatus !== undefined) {
      conditions.push(eq(schema.media.ingestStatus, options.ingestStatus));
    }
    if (options.ingestGroup === "incomplete") {
      conditions.push(inArray(schema.media.ingestStatus, incompleteIngestStatuses));
    } else if (options.ingestGroup === "failed") {
      conditions.push(eq(schema.media.ingestStatus, "failed"));
    }
    if (options.categoryId !== undefined) {
      conditions.push(eq(schema.media.categoryId, options.categoryId));
    }
    if (options.uploaderId !== undefined) {
      conditions.push(eq(schema.media.uploaderId, options.uploaderId));
    }
    if (options.reviewAssignment === "mine") {
      requirePermission(actor.role, "media:review");
      conditions.push(eq(schema.media.reviewAssigneeId, actor.id));
    }
    if (options.bibReviewDecision !== undefined) {
      const matchingReview = this.#database
        .select({ value: sql`1` })
        .from(schema.mediaBibReviews)
        .where(
          and(
            eq(schema.mediaBibReviews.mediaId, schema.media.id),
            eq(schema.mediaBibReviews.decision, options.bibReviewDecision),
          ),
        );
      if (options.bibReviewDecision === "pending") {
        const anyReview = this.#database
          .select({ value: sql`1` })
          .from(schema.mediaBibReviews)
          .where(eq(schema.mediaBibReviews.mediaId, schema.media.id));
        const pending = or(exists(matchingReview), not(exists(anyReview)));
        if (pending !== undefined) conditions.push(pending);
      } else {
        conditions.push(exists(matchingReview));
      }
    }
    if (options.bibOcrStatus !== undefined) {
      conditions.push(
        exists(
          this.#database
            .select({ value: sql`1` })
            .from(schema.mediaBibReviews)
            .where(
              and(
                eq(schema.mediaBibReviews.mediaId, schema.media.id),
                eq(schema.mediaBibReviews.ocrStatus, options.bibOcrStatus),
              ),
            ),
        ),
      );
    }
    if (options.gradeOptionId !== undefined) {
      conditions.push(
        exists(
          this.#database
            .select({ value: sql`1` })
            .from(schema.mediaBibTags)
            .where(
              and(
                eq(schema.mediaBibTags.mediaId, schema.media.id),
                eq(schema.mediaBibTags.status, "confirmed"),
                eq(schema.mediaBibTags.mappingVersion, album.bibMappingVersion),
                eq(schema.mediaBibTags.gradeOptionId, options.gradeOptionId),
                ...(options.classOptionId === undefined
                  ? []
                  : [eq(schema.mediaBibTags.classOptionId, options.classOptionId)]),
              ),
            ),
        ),
      );
    }
    if (actor.role === "uploader") {
      conditions.push(eq(schema.media.uploaderId, actor.id));
    }
    if (cursor !== null) {
      const cursorCondition =
        (options.sort ?? "newest") === "oldest"
          ? or(
              gt(schema.media.createdAt, cursor.createdAt),
              and(
                eq(schema.media.createdAt, cursor.createdAt),
                gt(schema.media.id, cursor.mediaId),
              ),
            )
          : or(
              lt(schema.media.createdAt, cursor.createdAt),
              and(
                eq(schema.media.createdAt, cursor.createdAt),
                lt(schema.media.id, cursor.mediaId),
              ),
            );
      if (cursorCondition !== undefined) conditions.push(cursorCondition);
    }
    const rows = await this.#database
      .select()
      .from(schema.media)
      .where(and(...conditions))
      .orderBy(
        ...((options.sort ?? "newest") === "oldest"
          ? [asc(schema.media.createdAt), asc(schema.media.id)]
          : [desc(schema.media.createdAt), desc(schema.media.id)]),
      )
      .limit(options.limit + 1);
    const hasMore = rows.length > options.limit;
    const page = rows.slice(0, options.limit);
    const mediaIds = page.map((media) => media.id);
    const variants =
      mediaIds.length === 0
        ? []
        : await this.#database
            .select()
            .from(schema.mediaVariants)
            .where(
              and(
                inArray(schema.mediaVariants.mediaId, mediaIds),
                eq(schema.mediaVariants.verified, true),
                isNotNull(schema.mediaVariants.bytes),
              ),
            );
    const editStates =
      mediaIds.length === 0
        ? []
        : await this.#database
            .select()
            .from(schema.mediaEditStates)
            .where(inArray(schema.mediaEditStates.mediaId, mediaIds));
    const activeEditRevisionIds = editStates
      .map((state) => state.activeRevisionId)
      .filter((id): id is string => id !== null);
    const pendingEditRevisionIds = editStates
      .map((state) => state.pendingRevisionId)
      .filter((id): id is string => id !== null);
    const editVariants =
      activeEditRevisionIds.length === 0
        ? []
        : await this.#database
            .select()
            .from(schema.mediaEditVariants)
            .where(
              and(
                inArray(schema.mediaEditVariants.editRevisionId, activeEditRevisionIds),
                eq(schema.mediaEditVariants.verified, true),
                isNotNull(schema.mediaEditVariants.bytes),
              ),
            );
    const pendingEditRevisions =
      pendingEditRevisionIds.length === 0
        ? []
        : await this.#database
            .select({
              id: schema.mediaEditRevisions.id,
              status: schema.mediaEditRevisions.status,
            })
            .from(schema.mediaEditRevisions)
            .where(inArray(schema.mediaEditRevisions.id, pendingEditRevisionIds));
    const editStateByMedia = new Map(editStates.map((state) => [state.mediaId, state]));
    const pendingStatusByRevision = new Map(
      pendingEditRevisions.map((revision) => [revision.id, revision.status]),
    );
    const editVariantsByRevision = new Map<string, typeof editVariants>();
    for (const variant of editVariants) {
      const current = editVariantsByRevision.get(variant.editRevisionId) ?? [];
      current.push(variant);
      editVariantsByRevision.set(variant.editRevisionId, current);
    }
    const deletionTasks =
      mediaIds.length === 0
        ? []
        : await this.#database
            .select()
            .from(schema.deletionTasks)
            .where(inArray(schema.deletionTasks.mediaId, mediaIds));
    const byMedia = new Map<string, typeof variants>();
    for (const variant of variants) {
      const current = byMedia.get(variant.mediaId) ?? [];
      current.push(variant);
      byMedia.set(variant.mediaId, current);
    }
    const deletionByMedia = new Map(deletionTasks.map((task) => [task.mediaId, task]));
    const expiresAt = previewExpiresAt(15 * 60 * 1_000);
    const items = page.map((media) => {
      const deletion = deletionByMedia.get(media.id) ?? null;
      const editState = editStateByMedia.get(media.id);
      const activeEditVariants =
        editState?.activeRevisionId === null || editState?.activeRevisionId === undefined
          ? []
          : (editVariantsByRevision.get(editState.activeRevisionId) ?? []);
      const baseMediaVariants = byMedia.get(media.id) ?? [];
      const resolvedVariants =
        activeEditVariants.length === 0
          ? baseMediaVariants
          : [
              ...activeEditVariants.filter((variant) => variant.kind !== "photo_download"),
              ...baseMediaVariants.filter((variant) => variant.kind === "photo_original"),
            ];
      return {
        id: media.id,
        albumId: media.albumId,
        uploaderId: media.uploaderId,
        categoryId: media.categoryId,
        ingestStatus: media.ingestStatus,
        publicationStatus: media.publicationStatus,
        width: media.width,
        height: media.height,
        totalBytes: media.totalBytes,
        capturedAt: media.capturedAt === null ? null : iso(media.capturedAt),
        publishSequence: media.publishSequence,
        publishedAt: media.publishedAt === null ? null : iso(media.publishedAt),
        variants: resolvedVariants
          .filter(
            (variant) =>
              variant.kind !== "photo_download" &&
              publicVariantKinds.has(variant.kind as PhotoVariantKind) &&
              variant.bytes !== null,
          )
          .map((variant) => ({
            kind: variant.kind as PhotoVariantKind,
            url: this.#storage.signRead({
              key: variant.objectKey,
              expiresAt,
              stable: true,
            }),
            width: variant.width,
            height: variant.height,
            bytes: variant.bytes as number,
            contentType: variant.contentType,
          })),
        edit: {
          activeRevisionId: editState?.activeRevisionId ?? null,
          pendingRevisionId: editState?.pendingRevisionId ?? null,
          generation: editState?.generation ?? 0,
          pendingStatus:
            editState?.pendingRevisionId === null || editState?.pendingRevisionId === undefined
              ? null
              : (pendingStatusByRevision.get(editState.pendingRevisionId) ?? null),
        },
        deletionTask:
          deletion === null
            ? null
            : {
                id: deletion.id,
                status: deletion.status,
                attempts: deletion.attempts,
                lastErrorCode: deletion.lastErrorCode,
              },
        createdAt: iso(media.createdAt),
      };
    });
    const last = page.at(-1);
    return {
      items,
      nextCursor:
        hasMore && last !== undefined
          ? this.#encodeInternalCursor(
              options.albumId,
              last.createdAt,
              last.id,
              options.sort ?? "newest",
            )
          : null,
    };
  }

  async listInternalMediaSelection(
    actor: InternalActor,
    options: {
      readonly albumId: string;
      readonly publicationStatus?:
        | (typeof schema.publicationStatusEnum.enumValues)[number]
        | undefined;
      readonly publicationGroup?: "unpublished" | undefined;
      readonly featured?: "true" | undefined;
      readonly ingestStatus?: (typeof schema.ingestStatusEnum.enumValues)[number] | undefined;
      readonly ingestGroup?: "incomplete" | "failed" | undefined;
      readonly categoryId?: string | undefined;
      readonly uploaderId?: string | undefined;
      readonly reviewAssignment?: "mine" | undefined;
      readonly bibReviewDecision?:
        | (typeof schema.bibReviewDecisionEnum.enumValues)[number]
        | undefined;
      readonly bibOcrStatus?: (typeof schema.bibOcrStatusEnum.enumValues)[number] | undefined;
      readonly gradeOptionId?: string | undefined;
      readonly classOptionId?: string | undefined;
      readonly sort?: "newest" | "oldest";
      readonly cursor?: string | undefined;
      readonly limit: number;
    },
  ) {
    requirePermission(actor.role, "album:read");
    const album = await this.#albumById(this.#database, options.albumId);
    if (album === null) throw this.#albumNotFound();
    const cursor =
      options.cursor === undefined
        ? null
        : this.#decodeInternalCursor(options.cursor, options.albumId, options.sort ?? "newest");
    const baseConditions = [eq(schema.media.albumId, options.albumId)];
    if (options.publicationStatus !== undefined) {
      baseConditions.push(eq(schema.media.publicationStatus, options.publicationStatus));
    } else if (options.publicationGroup === "unpublished") {
      baseConditions.push(inArray(schema.media.publicationStatus, ["draft", "pending_review"]));
    }
    if (options.featured === "true") {
      baseConditions.push(
        exists(
          this.#database
            .select({ value: sql`1` })
            .from(schema.featuredMedia)
            .where(eq(schema.featuredMedia.mediaId, schema.media.id)),
        ),
      );
    }
    if (options.ingestStatus !== undefined) {
      baseConditions.push(eq(schema.media.ingestStatus, options.ingestStatus));
    }
    if (options.ingestGroup === "incomplete") {
      baseConditions.push(inArray(schema.media.ingestStatus, incompleteIngestStatuses));
    } else if (options.ingestGroup === "failed") {
      baseConditions.push(eq(schema.media.ingestStatus, "failed"));
    }
    if (options.categoryId !== undefined) {
      baseConditions.push(eq(schema.media.categoryId, options.categoryId));
    }
    if (options.uploaderId !== undefined) {
      baseConditions.push(eq(schema.media.uploaderId, options.uploaderId));
    }
    if (options.reviewAssignment === "mine") {
      requirePermission(actor.role, "media:review");
      baseConditions.push(eq(schema.media.reviewAssigneeId, actor.id));
    }
    if (options.bibReviewDecision !== undefined) {
      const matchingReview = this.#database
        .select({ value: sql`1` })
        .from(schema.mediaBibReviews)
        .where(
          and(
            eq(schema.mediaBibReviews.mediaId, schema.media.id),
            eq(schema.mediaBibReviews.decision, options.bibReviewDecision),
          ),
        );
      if (options.bibReviewDecision === "pending") {
        const anyReview = this.#database
          .select({ value: sql`1` })
          .from(schema.mediaBibReviews)
          .where(eq(schema.mediaBibReviews.mediaId, schema.media.id));
        const pending = or(exists(matchingReview), not(exists(anyReview)));
        if (pending !== undefined) baseConditions.push(pending);
      } else {
        baseConditions.push(exists(matchingReview));
      }
    }
    if (options.bibOcrStatus !== undefined) {
      baseConditions.push(
        exists(
          this.#database
            .select({ value: sql`1` })
            .from(schema.mediaBibReviews)
            .where(
              and(
                eq(schema.mediaBibReviews.mediaId, schema.media.id),
                eq(schema.mediaBibReviews.ocrStatus, options.bibOcrStatus),
              ),
            ),
        ),
      );
    }
    if (options.gradeOptionId !== undefined) {
      baseConditions.push(
        exists(
          this.#database
            .select({ value: sql`1` })
            .from(schema.mediaBibTags)
            .where(
              and(
                eq(schema.mediaBibTags.mediaId, schema.media.id),
                eq(schema.mediaBibTags.status, "confirmed"),
                eq(schema.mediaBibTags.mappingVersion, album.bibMappingVersion),
                eq(schema.mediaBibTags.gradeOptionId, options.gradeOptionId),
                ...(options.classOptionId === undefined
                  ? []
                  : [eq(schema.mediaBibTags.classOptionId, options.classOptionId)]),
              ),
            ),
        ),
      );
    }
    if (actor.role === "uploader") {
      baseConditions.push(eq(schema.media.uploaderId, actor.id));
    }
    const [countRow] = await this.#database
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.media)
      .where(and(...baseConditions));
    const conditions = [...baseConditions];
    if (cursor !== null) {
      const cursorCondition =
        (options.sort ?? "newest") === "oldest"
          ? or(
              gt(schema.media.createdAt, cursor.createdAt),
              and(
                eq(schema.media.createdAt, cursor.createdAt),
                gt(schema.media.id, cursor.mediaId),
              ),
            )
          : or(
              lt(schema.media.createdAt, cursor.createdAt),
              and(
                eq(schema.media.createdAt, cursor.createdAt),
                lt(schema.media.id, cursor.mediaId),
              ),
            );
      if (cursorCondition !== undefined) conditions.push(cursorCondition);
    }
    const rows = await this.#database
      .select({
        id: schema.media.id,
        publicationStatus: schema.media.publicationStatus,
        categoryId: schema.media.categoryId,
        createdAt: schema.media.createdAt,
      })
      .from(schema.media)
      .where(and(...conditions))
      .orderBy(
        ...((options.sort ?? "newest") === "oldest"
          ? [asc(schema.media.createdAt), asc(schema.media.id)]
          : [desc(schema.media.createdAt), desc(schema.media.id)]),
      )
      .limit(options.limit + 1);
    const hasMore = rows.length > options.limit;
    const page = rows.slice(0, options.limit);
    const mediaIds = page.map((row) => row.id);
    const featured =
      mediaIds.length === 0
        ? []
        : await this.#database
            .select({ mediaId: schema.featuredMedia.mediaId })
            .from(schema.featuredMedia)
            .where(inArray(schema.featuredMedia.mediaId, mediaIds));
    const featuredIds = new Set(featured.map((row) => row.mediaId));
    const last = page.at(-1);
    return {
      items: page.map((row) => ({
        id: row.id,
        publicationStatus: row.publicationStatus,
        categoryId: row.categoryId,
        featured: featuredIds.has(row.id),
      })),
      nextCursor:
        hasMore && last !== undefined
          ? this.#encodeInternalCursor(
              options.albumId,
              last.createdAt,
              last.id,
              options.sort ?? "newest",
            )
          : null,
      total: countRow?.total ?? 0,
    };
  }

  async listAlbumUploaders(actor: InternalActor, albumId: string) {
    requirePermission(actor.role, "album:read");
    const album = await this.#albumById(this.#database, albumId);
    if (album === null) throw this.#albumNotFound();
    const rows = await this.#database
      .selectDistinct({
        id: schema.users.id,
        username: schema.users.username,
        displayName: schema.users.displayName,
      })
      .from(schema.media)
      .innerJoin(schema.users, eq(schema.media.uploaderId, schema.users.id))
      .where(
        and(
          eq(schema.media.albumId, albumId),
          ...(actor.role === "uploader" ? [eq(schema.users.id, actor.id)] : []),
        ),
      )
      .orderBy(asc(schema.users.displayName), asc(schema.users.id));
    return rows;
  }

  async getPublicAlbum(slug: string, visitorToken?: string) {
    const album = await this.#publicAlbumBySlug(slug);
    const unlocked = await this.#isVisitorAuthorized(album, visitorToken);
    const [faceIndex] = await this.#database
      .select({
        enabled: schema.albumFaceIndexes.enabled,
        noticeVersion: schema.albumFaceIndexes.noticeVersion,
        indexState: schema.albumFaceIndexes.indexState,
      })
      .from(schema.albumFaceIndexes)
      .where(eq(schema.albumFaceIndexes.albumId, album.id))
      .limit(1);
    const faceSearchAvailable = faceIndex?.enabled === true;
    const categories = await this.#database
      .select()
      .from(schema.categories)
      .where(and(eq(schema.categories.albumId, album.id), eq(schema.categories.enabled, true)))
      .orderBy(asc(schema.categories.sortOrder), asc(schema.categories.id));
    const bibSearchEnabled =
      unlocked && album.access === "password" && album.bibSearchEnabled && album.bibRuleUsable;
    const bibNumberLengths = bibSearchEnabled
      ? (
          await this.#database
            .selectDistinct({ totalLength: schema.bibPatterns.totalLength })
            .from(schema.bibPatterns)
            .where(
              and(eq(schema.bibPatterns.albumId, album.id), eq(schema.bibPatterns.enabled, true)),
            )
            .orderBy(asc(schema.bibPatterns.totalLength))
        ).map((pattern) => pattern.totalLength)
      : [];
    const bibAttributeOptionRows = bibSearchEnabled
      ? await this.#database
          .select({
            id: schema.bibAttributeOptions.id,
            dimension: schema.bibAttributeOptions.dimension,
            displayName: schema.bibAttributeOptions.displayName,
            sortOrder: schema.bibAttributeOptions.sortOrder,
            parentGradeOptionId: schema.bibAttributeOptions.parentGradeOptionId,
          })
          .from(schema.bibAttributeOptions)
          .where(
            and(
              eq(schema.bibAttributeOptions.albumId, album.id),
              eq(schema.bibAttributeOptions.enabled, true),
            ),
          )
          .orderBy(
            asc(schema.bibAttributeOptions.dimension),
            asc(schema.bibAttributeOptions.sortOrder),
            asc(schema.bibAttributeOptions.id),
          )
      : [];
    const bibAttributeOptions = bibAttributeOptionRows.map((option) => ({
      id: option.id,
      dimension: option.dimension,
      displayName: option.displayName,
      sortOrder: option.sortOrder,
    }));
    const [mappingTask] = bibSearchEnabled
      ? await this.#database
          .select({ id: schema.bibRecalculationTasks.id })
          .from(schema.bibRecalculationTasks)
          .where(
            and(
              eq(schema.bibRecalculationTasks.albumId, album.id),
              eq(schema.bibRecalculationTasks.kind, "mapping"),
              inArray(schema.bibRecalculationTasks.status, ["pending", "processing", "failed"]),
            ),
          )
          .limit(1)
      : [];
    const bibAttributeFilterEnabled =
      bibSearchEnabled && album.bibMappingUsable && mappingTask === undefined;
    const gradeOptionIds = bibAttributeOptionRows
      .filter((option) => option.dimension === "grade")
      .map((option) => option.id);
    const classOptions = bibAttributeOptionRows.filter((option) => option.dimension === "class");
    const bibAttributePairs = bibAttributeFilterEnabled
      ? gradeOptionIds.flatMap((gradeOptionId) => [
          { gradeOptionId, classOptionId: null },
          ...classOptions
            .filter((classOption) => classOption.parentGradeOptionId === gradeOptionId)
            .map((classOption) => ({ gradeOptionId, classOptionId: classOption.id })),
        ])
      : [];
    return {
      album,
      view: {
        slug: album.slug,
        title: album.title,
        description: album.description,
        state: album.state,
        access: album.access,
        accessRequired: album.access === "password" && !unlocked,
        previewDownloadEnabled: true,
        originalDownloadEnabled: true,
        privacyNotice: album.privacyNotice,
        faceSearchAvailable,
        faceSearchNoticeVersion: faceSearchAvailable
          ? this.#config.FACE_SEARCH_NOTICE_VERSION
          : null,
        bibSearchEnabled,
        bibNumberLengths,
        bibAttributeFilterEnabled,
        bibAttributeOptions,
        bibAttributePairs,
        categories: categories.map(categoryView),
      },
      unlocked,
    };
  }

  async unlockAlbum(slug: string, password: string) {
    const album = await this.#publicAlbumBySlug(slug);
    if (album.access !== "password" || album.passwordHash === null) {
      throw new AppError({
        code: "ALBUM_PASSWORD_INVALID",
        message: "相册不可用或口令错误",
        statusCode: 404,
      });
    }
    if (!(await this.#hasher.verify(album.passwordHash, password))) {
      throw new AppError({
        code: "ALBUM_PASSWORD_INVALID",
        message: "相册不可用或口令错误",
        statusCode: 404,
      });
    }
    const rawToken = createSessionToken();
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1_000);
    await this.#database.insert(schema.visitorSessions).values({
      tokenHash: visitorTokenHash(this.#config.VISITOR_SESSION_SECRET, rawToken),
      albumId: album.id,
      accessVersion: album.accessVersion,
      expiresAt,
    });
    return { rawToken, expiresAt };
  }

  async listPublicMedia(options: {
    readonly slug: string;
    readonly visitorToken: string | undefined;
    readonly cursor: string | undefined;
    readonly categoryId: string | undefined;
    readonly limit: number;
    readonly mediaIds?: readonly string[] | undefined;
  }) {
    const album = await this.#publicAlbumBySlug(options.slug);
    if (!(await this.#isVisitorAuthorized(album, options.visitorToken))) {
      throw new AppError({
        code: "ALBUM_PASSWORD_INVALID",
        message: "相册不可用或口令错误",
        statusCode: 404,
      });
    }
    const cursor =
      options.cursor === undefined ? null : this.#decodeCursor(options.cursor, album.id);
    const [latestEvent] = await this.#database
      .select({ id: schema.liveEvents.id })
      .from(schema.liveEvents)
      .where(eq(schema.liveEvents.albumId, album.id))
      .orderBy(desc(schema.liveEvents.id))
      .limit(1);
    const conditions = [
      eq(schema.media.albumId, album.id),
      eq(schema.media.publicationStatus, "published"),
    ];
    if (options.categoryId !== undefined) {
      conditions.push(eq(schema.media.categoryId, options.categoryId));
    }
    if (options.mediaIds !== undefined) {
      conditions.push(
        options.mediaIds.length === 0
          ? sql`false`
          : inArray(schema.media.id, [...options.mediaIds]),
      );
    }
    if (cursor !== null) conditions.push(lt(schema.media.publishSequence, cursor.publishSequence));
    const rows = await this.#database
      .select()
      .from(schema.media)
      .where(and(...conditions))
      .orderBy(desc(schema.media.publishSequence), desc(schema.media.id))
      .limit(options.limit + 1);
    const hasMore = rows.length > options.limit;
    const page = rows.slice(0, options.limit);
    const variants =
      page.length === 0
        ? []
        : await this.#database
            .select()
            .from(schema.mediaVariants)
            .where(
              and(
                or(...page.map((media) => eq(schema.mediaVariants.mediaId, media.id))),
                eq(schema.mediaVariants.verified, true),
              ),
            );
    const publicMediaIds = page.map((media) => media.id);
    const publicEditStates =
      publicMediaIds.length === 0
        ? []
        : await this.#database
            .select()
            .from(schema.mediaEditStates)
            .where(inArray(schema.mediaEditStates.mediaId, publicMediaIds));
    const publicActiveRevisionIds = publicEditStates
      .map((state) => state.activeRevisionId)
      .filter((id): id is string => id !== null);
    const publicEditVariants =
      publicActiveRevisionIds.length === 0
        ? []
        : await this.#database
            .select()
            .from(schema.mediaEditVariants)
            .where(
              and(
                inArray(schema.mediaEditVariants.editRevisionId, publicActiveRevisionIds),
                eq(schema.mediaEditVariants.verified, true),
                isNotNull(schema.mediaEditVariants.bytes),
              ),
            );
    const publicEditStateByMedia = new Map(publicEditStates.map((state) => [state.mediaId, state]));
    const publicEditVariantsByRevision = new Map<string, typeof publicEditVariants>();
    for (const variant of publicEditVariants) {
      const current = publicEditVariantsByRevision.get(variant.editRevisionId) ?? [];
      current.push(variant);
      publicEditVariantsByRevision.set(variant.editRevisionId, current);
    }
    const byMedia = new Map<string, typeof variants>();
    for (const variant of variants) {
      const current = byMedia.get(variant.mediaId) ?? [];
      current.push(variant);
      byMedia.set(variant.mediaId, current);
    }
    const expiresAt = previewExpiresAt(2 * 60 * 60 * 1_000);
    const items: PublicMediaView[] = page.map((media) => {
      if (media.publishSequence === null || media.publishedAt === null) {
        throw new Error("Published media lacks publication metadata");
      }
      const editState = publicEditStateByMedia.get(media.id);
      const activeEditVariants =
        editState?.activeRevisionId === null || editState?.activeRevisionId === undefined
          ? []
          : (publicEditVariantsByRevision.get(editState.activeRevisionId) ?? []);
      const baseVariants = byMedia.get(media.id) ?? [];
      const browserVariants =
        activeEditVariants.length === 0
          ? baseVariants.filter((variant) =>
              publicVariantKinds.has(variant.kind as PhotoVariantKind),
            )
          : activeEditVariants.filter((variant) => variant.kind !== "photo_download");
      const activeDownload =
        activeEditVariants.length === 0
          ? baseVariants.find(
              (variant) =>
                variant.kind === "photo_original" && variant.verified && variant.bytes !== null,
            )
          : activeEditVariants.find(
              (variant) =>
                variant.kind === "photo_download" && variant.verified && variant.bytes !== null,
            );
      return {
        id: media.id,
        width: media.width,
        height: media.height,
        publishSequence: media.publishSequence,
        publishedAt: iso(media.publishedAt),
        variants: browserVariants.map((variant) => {
          if (variant.bytes === null) throw new Error("Verified variant lacks size");
          return {
            kind: variant.kind as PhotoVariantKind,
            url: this.#storage.signRead({
              key: variant.objectKey,
              expiresAt,
              stable: true,
            }),
            width: variant.width,
            height: variant.height,
            bytes: variant.bytes,
            contentType: variant.contentType,
          };
        }),
        downloads: {
          preview: browserVariants.some(
            (variant) => variant.kind === "photo_1920" && variant.verified,
          ),
          original: activeDownload !== undefined,
          originalBytes: activeDownload?.bytes ?? null,
        },
      };
    });
    const last = page.at(-1);
    return {
      items,
      eventCursor: latestEvent?.id ?? 0,
      nextCursor:
        hasMore && last?.publishSequence !== null && last?.publishSequence !== undefined
          ? this.#encodeCursor(album.id, last.publishSequence, last.id)
          : null,
    };
  }

  async getAuthorizedPublicAlbum(
    slug: string,
    visitorToken: string | undefined,
    options: { readonly requirePassword?: boolean } = {},
  ) {
    const album = await this.#publicAlbumBySlug(slug);
    const authorized = await this.#isVisitorAuthorized(album, visitorToken);
    if (!authorized || (options.requirePassword === true && album.access !== "password")) {
      throw new AppError({
        code: "ALBUM_PASSWORD_INVALID",
        message: "相册不可用或口令错误",
        statusCode: 404,
      });
    }
    return album;
  }

  async listLiveEvents(options: {
    readonly slug: string;
    readonly visitorToken: string | undefined;
    readonly afterId: number;
    readonly limit?: number;
  }) {
    const album = await this.#publicAlbumBySlug(options.slug);
    if (!(await this.#isVisitorAuthorized(album, options.visitorToken))) {
      throw new AppError({
        code: "ALBUM_PASSWORD_INVALID",
        message: "相册不可用或口令错误",
        statusCode: 404,
      });
    }
    const rows = await this.#database
      .select()
      .from(schema.liveEvents)
      .where(
        and(eq(schema.liveEvents.albumId, album.id), gt(schema.liveEvents.id, options.afterId)),
      )
      .orderBy(asc(schema.liveEvents.id))
      .limit(options.limit ?? 100);
    return {
      album,
      events: rows.map((event) => ({
        id: event.id,
        type: event.type,
        albumId: event.albumId,
        mediaId: event.mediaId,
        createdAt: iso(event.createdAt),
      })),
    };
  }

  #deriveAlbumPassword(userId: string, idempotencyKey: string): string {
    return createHmac("sha256", this.#config.ALBUM_PASSWORD_GENERATION_SECRET)
      .update(`${userId}\n${idempotencyKey}`, "utf8")
      .digest("base64url")
      .slice(0, 14);
  }

  async #transitionAlbum(options: {
    readonly actor: InternalActor;
    readonly albumId: string;
    readonly requestId: string;
    readonly from: readonly AlbumView["state"][];
    readonly to: AlbumView["state"];
    readonly action: string;
  }): Promise<AlbumView> {
    return this.#database.transaction(async (transaction) => {
      await this.#advisoryLock(transaction, `album-state:${options.albumId}`);
      const album = await this.#albumById(transaction, options.albumId);
      if (album === null) throw this.#albumNotFound();
      if (album.state === options.to) return albumView(album);
      if (!options.from.includes(album.state)) {
        throw new AppError({
          code: "STATE_CONFLICT",
          message: "当前相册状态不能执行该操作",
          statusCode: 409,
        });
      }
      const now = new Date();
      const [updated] = await transaction
        .update(schema.albums)
        .set({ state: options.to, updatedAt: now })
        .where(eq(schema.albums.id, album.id))
        .returning();
      if (updated === undefined) throw this.#albumNotFound();
      await transaction.insert(schema.auditLogs).values({
        actorUserId: options.actor.id,
        action: options.action,
        targetType: "album",
        targetId: album.id,
        result: "success",
        changedFields: ["state"],
        requestId: options.requestId,
      });
      return albumView(updated);
    });
  }

  async #advisoryLock(executor: DbExecutor, value: string): Promise<void> {
    await executor.execute(sql`select pg_advisory_xact_lock(hashtextextended(${value}, 0))`);
  }

  async #albumById(executor: DbExecutor, albumId: string) {
    const [row] = await executor
      .select()
      .from(schema.albums)
      .where(eq(schema.albums.id, albumId))
      .limit(1);
    return row ?? null;
  }

  async #publicAlbumBySlug(slug: string) {
    const [album] = await this.#database
      .select()
      .from(schema.albums)
      .where(
        and(
          eq(schema.albums.slug, slug),
          or(
            eq(schema.albums.state, "live"),
            eq(schema.albums.state, "ended"),
            eq(schema.albums.state, "archived"),
          ),
        ),
      )
      .limit(1);
    if (album === undefined) throw this.#albumNotFound();
    return album;
  }

  async #isVisitorAuthorized(
    album: typeof schema.albums.$inferSelect,
    rawToken: string | undefined,
  ): Promise<boolean> {
    if (album.access === "public") return true;
    if (rawToken === undefined) return false;
    const [session] = await this.#database
      .select({ id: schema.visitorSessions.id })
      .from(schema.visitorSessions)
      .where(
        and(
          eq(
            schema.visitorSessions.tokenHash,
            visitorTokenHash(this.#config.VISITOR_SESSION_SECRET, rawToken),
          ),
          eq(schema.visitorSessions.albumId, album.id),
          eq(schema.visitorSessions.accessVersion, album.accessVersion),
          gt(schema.visitorSessions.expiresAt, new Date()),
          isNull(schema.visitorSessions.revokedAt),
        ),
      )
      .limit(1);
    return session !== undefined;
  }

  async #lockUploadAlbumShared(transaction: Transaction, intentId: string): Promise<void> {
    const [scope] = await transaction
      .select({ albumId: schema.media.albumId })
      .from(schema.uploadIntents)
      .innerJoin(schema.media, eq(schema.uploadIntents.mediaId, schema.media.id))
      .where(eq(schema.uploadIntents.id, intentId))
      .limit(1);
    if (scope === undefined) throw this.#uploadNotFound();

    await transaction.execute(
      sql`select pg_advisory_xact_lock_shared(hashtextextended(${`album-state:${scope.albumId}`}, 0))`,
    );
    const [album] = await transaction
      .select({ state: schema.albums.state })
      .from(schema.albums)
      .where(eq(schema.albums.id, scope.albumId))
      .limit(1);
    if (album?.state !== "live") {
      throw new AppError({ code: "STATE_CONFLICT", message: "活动已停止上传", statusCode: 409 });
    }
  }

  async #uploadVariant(
    intentId: string,
    kind: PhotoVariantKind,
    executor: DbExecutor = this.#database,
  ) {
    const [row] = await executor
      .select({
        intent: schema.uploadIntents,
        media: schema.media,
        variant: schema.mediaVariants,
      })
      .from(schema.uploadIntents)
      .innerJoin(schema.media, eq(schema.uploadIntents.mediaId, schema.media.id))
      .innerJoin(
        schema.mediaVariants,
        and(eq(schema.mediaVariants.mediaId, schema.media.id), eq(schema.mediaVariants.kind, kind)),
      )
      .where(eq(schema.uploadIntents.id, intentId))
      .limit(1);
    if (row === undefined) throw this.#uploadNotFound();
    return row;
  }

  async #uploadPart(
    intentId: string,
    kind: PhotoVariantKind,
    partNumber: number,
    executor: DbExecutor = this.#database,
  ) {
    const [row] = await executor
      .select({
        intent: schema.uploadIntents,
        media: schema.media,
        variant: schema.mediaVariants,
        part: schema.uploadParts,
      })
      .from(schema.uploadIntents)
      .innerJoin(schema.media, eq(schema.uploadIntents.mediaId, schema.media.id))
      .innerJoin(
        schema.mediaVariants,
        and(eq(schema.mediaVariants.mediaId, schema.media.id), eq(schema.mediaVariants.kind, kind)),
      )
      .innerJoin(schema.uploadParts, eq(schema.uploadParts.variantId, schema.mediaVariants.id))
      .where(
        and(eq(schema.uploadIntents.id, intentId), eq(schema.uploadParts.partNumber, partNumber)),
      )
      .limit(1);
    if (row === undefined) throw this.#uploadNotFound();
    return row;
  }

  async #ensureMultipartUpload(
    variant: typeof schema.mediaVariants.$inferSelect,
    executor: DbExecutor = this.#database,
  ): Promise<string> {
    if (variant.providerMultipartUploadId !== null) return variant.providerMultipartUploadId;
    const created =
      (await this.#storage.createMultipartUpload?.({
        clientUploadId: variant.id,
        contentType: variant.contentType,
        key: variant.objectKey,
      })) ?? variant.id;
    try {
      const [claimed] = await executor
        .update(schema.mediaVariants)
        .set({ providerMultipartUploadId: created })
        .where(
          and(
            eq(schema.mediaVariants.id, variant.id),
            isNull(schema.mediaVariants.providerMultipartUploadId),
          ),
        )
        .returning({ providerMultipartUploadId: schema.mediaVariants.providerMultipartUploadId });
      if (
        claimed?.providerMultipartUploadId !== null &&
        claimed?.providerMultipartUploadId !== undefined
      ) {
        return claimed.providerMultipartUploadId;
      }
      const [winner] = await executor
        .select({ providerMultipartUploadId: schema.mediaVariants.providerMultipartUploadId })
        .from(schema.mediaVariants)
        .where(eq(schema.mediaVariants.id, variant.id))
        .limit(1);
      if (
        winner?.providerMultipartUploadId === null ||
        winner?.providerMultipartUploadId === undefined
      ) {
        throw new Error("Multipart upload state disappeared");
      }
      await this.#storage.abortMultipart(created, variant.objectKey).catch(() => undefined);
      return winner.providerMultipartUploadId;
    } catch (error) {
      await this.#storage.abortMultipart(created, variant.objectKey).catch(() => undefined);
      throw error;
    }
  }

  async #markSourceUploading(
    mediaId: string,
    executor: DbExecutor = this.#database,
  ): Promise<void> {
    await executor
      .update(schema.media)
      .set({ ingestStatus: "uploading_source", updatedAt: new Date() })
      .where(and(eq(schema.media.id, mediaId), eq(schema.media.ingestStatus, "preview_ready")));
  }

  async #hasPendingEdit(transaction: Transaction, mediaId: string): Promise<boolean> {
    const [state] = await transaction
      .select({ pendingRevisionId: schema.mediaEditStates.pendingRevisionId })
      .from(schema.mediaEditStates)
      .where(eq(schema.mediaEditStates.mediaId, mediaId))
      .limit(1);
    return state?.pendingRevisionId !== null && state?.pendingRevisionId !== undefined;
  }

  #assertUploadAccess(actor: InternalActor, uploaderId: string): void {
    if (actor.id === uploaderId) return;
    if (hasPermission(actor.role, "media:review")) return;
    throw new AppError({ code: "FORBIDDEN", message: "无权操作他人的上传任务", statusCode: 403 });
  }

  async #allocatePublication(
    transaction: Transaction,
    albumId: string,
    mediaId: string,
    now: Date,
  ) {
    if (await this.#hasPendingEdit(transaction, mediaId)) {
      throw new AppError({
        code: "STATE_CONFLICT",
        message: "修图版本仍在处理中，完成或取消后才能发布",
        statusCode: 409,
      });
    }
    const [album] = await transaction
      .update(schema.albums)
      .set({
        publishSequence: sql`${schema.albums.publishSequence} + 1`,
        updatedAt: now,
      })
      .where(eq(schema.albums.id, albumId))
      .returning({ publishSequence: schema.albums.publishSequence });
    if (album === undefined) throw this.#albumNotFound();
    await transaction
      .update(schema.media)
      .set({
        publicationStatus: "published",
        publishSequence: album.publishSequence,
        publishedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.media.id, mediaId));
    await this.#insertLiveEvent(transaction, { albumId, mediaId, type: "media.published" });
    return album;
  }

  async #insertLiveEvent(
    transaction: Transaction,
    event: { readonly albumId: string; readonly mediaId: string; readonly type: string },
  ): Promise<void> {
    await transaction.insert(schema.liveEvents).values({
      albumId: event.albumId,
      mediaId: event.mediaId,
      type: event.type,
      payload: {},
    });
    await transaction.execute(sql`select pg_notify(${liveEventChannel}, ${event.albumId})`);
  }

  #encodeCursor(albumId: string, publishSequence: number, mediaId: string): string {
    const encoded = Buffer.from(
      JSON.stringify({ albumId, publishSequence, mediaId }),
      "utf8",
    ).toString("base64url");
    return `${encoded}.${cursorSignature(this.#config.CURSOR_SIGNING_SECRET, encoded)}`;
  }

  #decodeCursor(value: string, albumId: string) {
    const [encoded, suppliedSignature] = value.split(".", 2);
    if (
      encoded === undefined ||
      suppliedSignature === undefined ||
      !safeEqual(cursorSignature(this.#config.CURSOR_SIGNING_SECRET, encoded), suppliedSignature)
    ) {
      throw new AppError({ code: "BAD_REQUEST", message: "分页游标无效", statusCode: 400 });
    }
    try {
      const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as {
        albumId: string;
        publishSequence: number;
        mediaId: string;
      };
      if (
        parsed.albumId !== albumId ||
        !Number.isSafeInteger(parsed.publishSequence) ||
        parsed.publishSequence < 1 ||
        typeof parsed.mediaId !== "string"
      ) {
        throw new Error("Invalid cursor payload");
      }
      return parsed;
    } catch {
      throw new AppError({ code: "BAD_REQUEST", message: "分页游标无效", statusCode: 400 });
    }
  }

  #encodeInternalCursor(
    albumId: string,
    createdAt: Date,
    mediaId: string,
    sort: "newest" | "oldest",
  ): string {
    const encoded = Buffer.from(
      JSON.stringify({ albumId, createdAt: createdAt.toISOString(), mediaId, sort }),
      "utf8",
    ).toString("base64url");
    return `${encoded}.${cursorSignature(this.#config.CURSOR_SIGNING_SECRET, encoded)}`;
  }

  #decodeInternalCursor(value: string, albumId: string, sort: "newest" | "oldest") {
    const [encoded, suppliedSignature] = value.split(".", 2);
    if (
      encoded === undefined ||
      suppliedSignature === undefined ||
      !safeEqual(cursorSignature(this.#config.CURSOR_SIGNING_SECRET, encoded), suppliedSignature)
    ) {
      throw new AppError({ code: "BAD_REQUEST", message: "媒体游标无效", statusCode: 400 });
    }
    try {
      const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as {
        albumId: string;
        createdAt: string;
        mediaId: string;
        sort: "newest" | "oldest";
      };
      const createdAt = new Date(parsed.createdAt);
      if (
        parsed.albumId !== albumId ||
        parsed.sort !== sort ||
        Number.isNaN(createdAt.getTime()) ||
        typeof parsed.mediaId !== "string"
      ) {
        throw new Error("invalid cursor");
      }
      return { createdAt, mediaId: parsed.mediaId };
    } catch {
      throw new AppError({ code: "BAD_REQUEST", message: "媒体游标无效", statusCode: 400 });
    }
  }

  #albumNotFound(): AppError {
    return new AppError({
      code: "ALBUM_NOT_FOUND",
      message: "相册不存在或不可访问",
      statusCode: 404,
    });
  }

  #uploadNotFound(): AppError {
    return new AppError({ code: "UPLOAD_NOT_FOUND", message: "上传任务不存在", statusCode: 404 });
  }
}
