import { hasPermission, type UserRole } from "@photostream/contracts";
import type { DataSaverSettingView } from "@photostream/contracts/bandwidth";
import type { Database } from "@photostream/db";
import { schema } from "@photostream/db";
import { eq } from "drizzle-orm";

import { AppError } from "../errors.js";

interface AlbumSettingsActor {
  readonly id: string;
  readonly role: UserRole;
}

function requireAlbumConfigure(role: UserRole): void {
  if (!hasPermission(role, "album:configure")) {
    throw new AppError({ code: "FORBIDDEN", message: "当前角色无权修改活动设置", statusCode: 403 });
  }
}

export class AlbumDataSaverService {
  readonly #database: Database;

  constructor(options: { readonly database: Database }) {
    this.#database = options.database;
  }

  async getForAlbum(actor: AlbumSettingsActor, albumId: string): Promise<DataSaverSettingView> {
    requireAlbumConfigure(actor.role);
    const [row] = await this.#database
      .select({
        albumId: schema.albums.id,
        enabled: schema.albumDataSaverSettings.enabled,
      })
      .from(schema.albums)
      .leftJoin(
        schema.albumDataSaverSettings,
        eq(schema.albumDataSaverSettings.albumId, schema.albums.id),
      )
      .where(eq(schema.albums.id, albumId))
      .limit(1);
    if (row === undefined) {
      throw new AppError({ code: "ALBUM_NOT_FOUND", message: "活动不存在", statusCode: 404 });
    }
    return { enabled: row.enabled ?? false };
  }

  async getForSlug(slug: string): Promise<DataSaverSettingView> {
    const [row] = await this.#database
      .select({
        albumId: schema.albums.id,
        enabled: schema.albumDataSaverSettings.enabled,
      })
      .from(schema.albums)
      .leftJoin(
        schema.albumDataSaverSettings,
        eq(schema.albumDataSaverSettings.albumId, schema.albums.id),
      )
      .where(eq(schema.albums.slug, slug))
      .limit(1);
    if (row === undefined) {
      throw new AppError({ code: "ALBUM_NOT_FOUND", message: "活动不存在", statusCode: 404 });
    }
    return { enabled: row.enabled ?? false };
  }

  async update(options: {
    readonly actor: AlbumSettingsActor;
    readonly albumId: string;
    readonly enabled: boolean;
    readonly requestId: string;
  }): Promise<DataSaverSettingView> {
    requireAlbumConfigure(options.actor.role);
    return this.#database.transaction(async (transaction) => {
      const [album] = await transaction
        .select({ id: schema.albums.id })
        .from(schema.albums)
        .where(eq(schema.albums.id, options.albumId))
        .limit(1);
      if (album === undefined) {
        throw new AppError({ code: "ALBUM_NOT_FOUND", message: "活动不存在", statusCode: 404 });
      }

      const [existing] = await transaction
        .select({ enabled: schema.albumDataSaverSettings.enabled })
        .from(schema.albumDataSaverSettings)
        .where(eq(schema.albumDataSaverSettings.albumId, options.albumId))
        .limit(1);
      const changed = (existing?.enabled ?? false) !== options.enabled;

      await transaction
        .insert(schema.albumDataSaverSettings)
        .values({ albumId: options.albumId, enabled: options.enabled, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: schema.albumDataSaverSettings.albumId,
          set: { enabled: options.enabled, updatedAt: new Date() },
        });

      if (changed) {
        await transaction.insert(schema.auditLogs).values({
          actorUserId: options.actor.id,
          action: options.enabled ? "album.data_saver.enabled" : "album.data_saver.disabled",
          targetType: "album",
          targetId: options.albumId,
          result: "success",
          changedFields: ["dataSaverEnabled"],
          requestId: options.requestId,
        });
      }

      return { enabled: options.enabled };
    });
  }
}
