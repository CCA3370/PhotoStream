import { type Database, schema } from "@photostream/db";
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";

import { AppError } from "../errors.js";
import { liveEventChannel } from "./live-event-broker.js";
import type { PhotoService } from "./service.js";

export const viewerFeedbackTopic = "viewer-feedback";

export type ViewerFeedbackKind = "problem" | "suggestion" | "other" | "report";
export type ViewerReportReason =
  | "privacy"
  | "inappropriate"
  | "copyright"
  | "inaccurate"
  | "other";

export interface ViewerFeedbackView {
  readonly id: number;
  readonly albumId: string;
  readonly albumTitle: string;
  readonly albumSlug: string;
  readonly mediaId: string | null;
  readonly mediaStatus: string | null;
  readonly kind: ViewerFeedbackKind;
  readonly reportReason: ViewerReportReason | null;
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
    readonly mediaId?: string | null;
    readonly reportReason?: ViewerReportReason | null;
  }): Promise<{ readonly id: number; readonly received: true }> {
    const publicAlbum = await this.#photoService.getPublicAlbum(options.slug, options.visitorToken);
    if (publicAlbum.view.accessRequired) {
      throw new AppError({
        code: "NOT_FOUND",
        message: "相册不存在或当前访问无效",
        statusCode: 404,
      });
    }

    const isReport = options.kind === "report";
    const mediaId = isReport ? (options.mediaId ?? null) : null;
    const reportReason = isReport ? (options.reportReason ?? null) : null;
    if (isReport && (mediaId === null || reportReason === null)) {
      throw new AppError({
        code: "BAD_REQUEST",
        message: "投诉信息不完整",
        statusCode: 400,
      });
    }

    if (mediaId !== null) {
      const [target] = await this.#database
        .select({ id: schema.media.id })
        .from(schema.media)
        .where(
          and(
            eq(schema.media.id, mediaId),
            eq(schema.media.albumId, publicAlbum.album.id),
            eq(schema.media.publicationStatus, "published"),
          ),
        )
        .limit(1);
      if (target === undefined) {
        throw new AppError({
          code: "NOT_FOUND",
          message: "图片不存在或已不可见",
          statusCode: 404,
        });
      }
    }

    const created = await this.#database.transaction(async (transaction) => {
      const [row] = await transaction
        .insert(schema.viewerFeedback)
        .values({
          albumId: publicAlbum.album.id,
          mediaId,
          kind: options.kind,
          reportReason,
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
        albumSlug: schema.albums.slug,
        mediaId: schema.viewerFeedback.mediaId,
        mediaStatus: schema.media.publicationStatus,
        kind: schema.viewerFeedback.kind,
        reportReason: schema.viewerFeedback.reportReason,
        message: schema.viewerFeedback.message,
        pagePath: schema.viewerFeedback.pagePath,
        createdAt: schema.viewerFeedback.createdAt,
      })
      .from(schema.viewerFeedback)
      .innerJoin(schema.albums, eq(schema.albums.id, schema.viewerFeedback.albumId))
      .leftJoin(schema.media, eq(schema.media.id, schema.viewerFeedback.mediaId))
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
        albumSlug: schema.albums.slug,
        mediaId: schema.viewerFeedback.mediaId,
        mediaStatus: schema.media.publicationStatus,
        kind: schema.viewerFeedback.kind,
        reportReason: schema.viewerFeedback.reportReason,
        message: schema.viewerFeedback.message,
        pagePath: schema.viewerFeedback.pagePath,
        createdAt: schema.viewerFeedback.createdAt,
      })
      .from(schema.viewerFeedback)
      .innerJoin(schema.albums, eq(schema.albums.id, schema.viewerFeedback.albumId))
      .leftJoin(schema.media, eq(schema.media.id, schema.viewerFeedback.mediaId))
      .where(gt(schema.viewerFeedback.id, afterId))
      .orderBy(asc(schema.viewerFeedback.id))
      .limit(limit);
    return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  }
}
