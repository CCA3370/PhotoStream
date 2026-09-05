import { hasPermission, type UserRole } from "@photostream/contracts";
import type { Database } from "@photostream/db";
import { schema } from "@photostream/db";
import { and, eq, inArray, ne, sql } from "drizzle-orm";

import { AppError } from "../errors.js";
import { liveEventChannel } from "./live-event-broker.js";
import type { InternalActor } from "./service.js";

function requirePermission(role: UserRole, permission: Parameters<typeof hasPermission>[1]): void {
  if (!hasPermission(role, permission)) {
    throw new AppError({ code: "FORBIDDEN", message: "当前角色无权执行此操作", statusCode: 403 });
  }
}

export class FeaturedService {
  readonly #database: Database;

  constructor(options: { readonly database: Database }) {
    this.#database = options.database;
  }

  async listInternal(actor: InternalActor, albumId: string): Promise<string[]> {
    requirePermission(actor.role, "album:read");
    const rows = await this.#database
      .select({ mediaId: schema.featuredMedia.mediaId })
      .from(schema.featuredMedia)
      .innerJoin(schema.media, eq(schema.featuredMedia.mediaId, schema.media.id))
      .where(and(eq(schema.media.albumId, albumId), ne(schema.media.publicationStatus, "deleted")));
    return rows.map((row) => row.mediaId);
  }

  async listPublishedBySlug(slug: string): Promise<string[]> {
    const rows = await this.#database
      .select({ mediaId: schema.featuredMedia.mediaId })
      .from(schema.featuredMedia)
      .innerJoin(schema.media, eq(schema.featuredMedia.mediaId, schema.media.id))
      .innerJoin(schema.albums, eq(schema.media.albumId, schema.albums.id))
      .where(and(eq(schema.albums.slug, slug), eq(schema.media.publicationStatus, "published")));
    return rows.map((row) => row.mediaId);
  }

  async setFeatured(options: {
    readonly actor: InternalActor;
    readonly mediaId: string;
    readonly featured: boolean;
    readonly requestId: string;
  }): Promise<{ readonly mediaId: string; readonly featured: boolean }> {
    requirePermission(options.actor.role, "media:manage");
    return this.#database.transaction(async (transaction) => {
      const [media] = await transaction
        .select({
          id: schema.media.id,
          albumId: schema.media.albumId,
          status: schema.media.publicationStatus,
        })
        .from(schema.media)
        .where(eq(schema.media.id, options.mediaId))
        .limit(1);
      if (media === undefined || media.status === "deleted") {
        throw new AppError({ code: "MEDIA_NOT_FOUND", message: "照片不存在", statusCode: 404 });
      }

      let changed = false;
      if (options.featured) {
        const inserted = await transaction
          .insert(schema.featuredMedia)
          .values({ mediaId: media.id, featuredBy: options.actor.id })
          .onConflictDoNothing()
          .returning({ mediaId: schema.featuredMedia.mediaId });
        changed = inserted.length > 0;
      } else {
        const deleted = await transaction
          .delete(schema.featuredMedia)
          .where(eq(schema.featuredMedia.mediaId, media.id))
          .returning({ mediaId: schema.featuredMedia.mediaId });
        changed = deleted.length > 0;
      }

      if (changed) {
        await transaction.insert(schema.liveEvents).values({
          albumId: media.albumId,
          mediaId: media.id,
          type: "media.featured.updated",
          payload: { featured: options.featured },
        });
        await transaction.execute(sql`select pg_notify(${liveEventChannel}, ${media.albumId})`);
        await transaction.insert(schema.auditLogs).values({
          actorUserId: options.actor.id,
          action: options.featured ? "media.featured.enabled" : "media.featured.disabled",
          targetType: "media",
          targetId: media.id,
          result: "success",
          changedFields: ["featured"],
          requestId: options.requestId,
        });
      }
      return { mediaId: media.id, featured: options.featured };
    });
  }

  async deletionContext(mediaId: string): Promise<{ readonly albumTitle: string }> {
    const [row] = await this.#database
      .select({ albumTitle: schema.albums.title })
      .from(schema.media)
      .innerJoin(schema.albums, eq(schema.media.albumId, schema.albums.id))
      .where(and(eq(schema.media.id, mediaId), ne(schema.media.publicationStatus, "deleted")))
      .limit(1);
    if (row === undefined) {
      throw new AppError({ code: "MEDIA_NOT_FOUND", message: "照片不存在", statusCode: 404 });
    }
    return row;
  }

  async prune(mediaIds: readonly string[]): Promise<void> {
    if (mediaIds.length === 0) return;
    await this.#database
      .delete(schema.featuredMedia)
      .where(inArray(schema.featuredMedia.mediaId, mediaIds));
  }
}
