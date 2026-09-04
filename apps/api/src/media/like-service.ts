import { createHmac } from "node:crypto";
import type { Database } from "@photostream/db";
import { schema } from "@photostream/db";
import { and, eq, inArray, sql } from "drizzle-orm";

import { AppError } from "../errors.js";
import { liveEventChannel } from "./live-event-broker.js";

export interface MediaLikeState {
  readonly mediaId: string;
  readonly count: number;
  readonly likedByViewer: boolean;
}

export class MediaLikeService {
  readonly #database: Database;
  readonly #secret: string;

  constructor(options: { readonly database: Database; readonly secret: string }) {
    this.#database = options.database;
    this.#secret = options.secret;
  }

  async listStates(options: {
    readonly albumId: string;
    readonly mediaIds: readonly string[];
    readonly viewerId: string;
  }): Promise<MediaLikeState[]> {
    const mediaIds = [...new Set(options.mediaIds)];
    if (mediaIds.length === 0) return [];

    const visitorDigest = this.#visitorDigest(options.viewerId);
    const counts = await this.#database
      .select({
        mediaId: schema.mediaLikes.mediaId,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.mediaLikes)
      .innerJoin(schema.media, eq(schema.mediaLikes.mediaId, schema.media.id))
      .where(
        and(
          eq(schema.media.albumId, options.albumId),
          eq(schema.media.publicationStatus, "published"),
          inArray(schema.mediaLikes.mediaId, mediaIds),
        ),
      )
      .groupBy(schema.mediaLikes.mediaId);
    const viewerLikes = await this.#database
      .select({ mediaId: schema.mediaLikes.mediaId })
      .from(schema.mediaLikes)
      .innerJoin(schema.media, eq(schema.mediaLikes.mediaId, schema.media.id))
      .where(
        and(
          eq(schema.media.albumId, options.albumId),
          eq(schema.media.publicationStatus, "published"),
          eq(schema.mediaLikes.visitorDigest, visitorDigest),
          inArray(schema.mediaLikes.mediaId, mediaIds),
        ),
      );

    const countByMediaId = new Map(counts.map((row) => [row.mediaId, Number(row.count)]));
    const likedMediaIds = new Set(viewerLikes.map((row) => row.mediaId));
    return mediaIds.map((mediaId) => ({
      mediaId,
      count: countByMediaId.get(mediaId) ?? 0,
      likedByViewer: likedMediaIds.has(mediaId),
    }));
  }

  async setLike(options: {
    readonly albumId: string;
    readonly mediaId: string;
    readonly viewerId: string;
    readonly liked: boolean;
  }): Promise<MediaLikeState> {
    const visitorDigest = this.#visitorDigest(options.viewerId);
    return this.#database.transaction(async (transaction) => {
      const [publishedMedia] = await transaction
        .select({ id: schema.media.id })
        .from(schema.media)
        .where(
          and(
            eq(schema.media.id, options.mediaId),
            eq(schema.media.albumId, options.albumId),
            eq(schema.media.publicationStatus, "published"),
          ),
        )
        .limit(1);
      if (publishedMedia === undefined) {
        throw new AppError({ code: "MEDIA_NOT_FOUND", message: "照片不存在", statusCode: 404 });
      }

      let changed = false;
      if (options.liked) {
        const inserted = await transaction
          .insert(schema.mediaLikes)
          .values({ mediaId: options.mediaId, visitorDigest })
          .onConflictDoNothing()
          .returning({ id: schema.mediaLikes.id });
        changed = inserted.length > 0;
      } else {
        const deleted = await transaction
          .delete(schema.mediaLikes)
          .where(
            and(
              eq(schema.mediaLikes.mediaId, options.mediaId),
              eq(schema.mediaLikes.visitorDigest, visitorDigest),
            ),
          )
          .returning({ id: schema.mediaLikes.id });
        changed = deleted.length > 0;
      }

      const [aggregate] = await transaction
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.mediaLikes)
        .where(eq(schema.mediaLikes.mediaId, options.mediaId));
      const [viewerLike] = await transaction
        .select({ id: schema.mediaLikes.id })
        .from(schema.mediaLikes)
        .where(
          and(
            eq(schema.mediaLikes.mediaId, options.mediaId),
            eq(schema.mediaLikes.visitorDigest, visitorDigest),
          ),
        )
        .limit(1);

      if (changed) {
        await transaction.insert(schema.liveEvents).values({
          albumId: options.albumId,
          mediaId: options.mediaId,
          type: "media.likes.updated",
          payload: {},
        });
        await transaction.execute(sql`select pg_notify(${liveEventChannel}, ${options.albumId})`);
      }

      return {
        mediaId: options.mediaId,
        count: Number(aggregate?.count ?? 0),
        likedByViewer: viewerLike !== undefined,
      };
    });
  }

  #visitorDigest(viewerId: string): string {
    return createHmac("sha256", this.#secret).update(viewerId, "utf8").digest("hex");
  }
}
