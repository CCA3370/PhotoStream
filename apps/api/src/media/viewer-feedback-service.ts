import { schema, type Database } from "@photostream/db";
import { asc, desc, eq, gt, sql } from "drizzle-orm";

import { AppError } from "../errors.js";
import { liveEventChannel } from "./live-event-broker.js";
import type { PhotoService } from "./service.js";

export const viewerFeedbackTopic = "viewer-feedback";

export type ViewerFeedbackKind = "problem" | "suggestion" | "other";

export interface ViewerFeedbackView {
  readonly id: number;
  readonly albumId: string;
  readonly albumTitle: string;
  readonly kind: ViewerFeedbackKind;
  readonly message: string;
  readonly pagePath: string | null;
  readonly createdAt: string;
}

export class ViewerFeedbackService {
  readonly #database: Database;
  readonly #photoService: PhotoService;

  constructor(options: { readonly database: Database; readonly photoService: PhotoService }) {
    this.#database = options.database;
    this.#photoService = options.photoService;
  }

  async createPublic(options: {
    readonly slug: string;
    readonly visitorToken: string | undefined;
    readonly kind: ViewerFeedbackKind;
    readonly message: string;
    readonly pagePath: string | null;
  }): Promise<{ readonly id: number; readonly received: true }> {
    const publicAlbum = await this.#photoService.getPublicAlbum(options.slug, options.visitorToken);
    if (publicAlbum.view.accessRequired) {
      throw new AppError({
        code: "NOT_FOUND",
        message: "相册不存在或当前访问无效",
        statusCode: 404,
      });
    }

    const created = await this.#database.transaction(async (transaction) => {
      const [row] = await transaction
        .insert(schema.viewerFeedback)
        .values({
          albumId: publicAlbum.album.id,
          kind: options.kind,
          message: options.message.trim(),
          pagePath: options.pagePath,
        })
        .returning({ id: schema.viewerFeedback.id });
      if (row === undefined) throw new Error("Viewer feedback insert returned no row");
      await transaction.execute(sql`select pg_notify(${liveEventChannel}, ${viewerFeedbackTopic})`);
      return row;
    });

    return { id: created.id, received: true as const };
  }

  async latestId(): Promise<number> {
    const [row] = await this.#database
      .select({ id: schema.viewerFeedback.id })
      .from(schema.viewerFeedback)
      .orderBy(desc(schema.viewerFeedback.id))
      .limit(1);
    return row?.id ?? 0;
  }

  async listRecent(limit: number): Promise<ViewerFeedbackView[]> {
    const rows = await this.#database
      .select({
        id: schema.viewerFeedback.id,
        albumId: schema.viewerFeedback.albumId,
        albumTitle: schema.albums.title,
        kind: schema.viewerFeedback.kind,
        message: schema.viewerFeedback.message,
        pagePath: schema.viewerFeedback.pagePath,
        createdAt: schema.viewerFeedback.createdAt,
      })
      .from(schema.viewerFeedback)
      .innerJoin(schema.albums, eq(schema.albums.id, schema.viewerFeedback.albumId))
      .orderBy(desc(schema.viewerFeedback.id))
      .limit(limit);
    return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  }

  async listAfter(afterId: number, limit = 100): Promise<ViewerFeedbackView[]> {
    const rows = await this.#database
      .select({
        id: schema.viewerFeedback.id,
        albumId: schema.viewerFeedback.albumId,
        albumTitle: schema.albums.title,
        kind: schema.viewerFeedback.kind,
        message: schema.viewerFeedback.message,
        pagePath: schema.viewerFeedback.pagePath,
        createdAt: schema.viewerFeedback.createdAt,
      })
      .from(schema.viewerFeedback)
      .innerJoin(schema.albums, eq(schema.albums.id, schema.viewerFeedback.albumId))
      .where(gt(schema.viewerFeedback.id, afterId))
      .orderBy(asc(schema.viewerFeedback.id))
      .limit(limit);
    return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  }
}
