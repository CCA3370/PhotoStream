import type { Database } from "@photostream/db";
import { schema } from "@photostream/db";
import { eq } from "drizzle-orm";

import type { AppConfig } from "../config.js";
import type { PhotoService } from "../media/service.js";

export interface PublicFaceState {
  readonly enabled: boolean;
  readonly noticeVersion: string;
  readonly indexState:
    | "disabled"
    | "provisioning"
    | "indexing"
    | "ready"
    | "degraded"
    | "deleting"
    | "failed";
}

/**
 * Public read model for the face-search switch. `enabled` mirrors only the
 * per-album switch; index/provider state is reported separately so runtime
 * readiness can never become an enablement gate.
 */
export class FacePublicStateService {
  readonly #database: Database;
  readonly #config: AppConfig;
  readonly #photoService: PhotoService;

  constructor(options: { database: Database; config: AppConfig; photoService: PhotoService }) {
    this.#database = options.database;
    this.#config = options.config;
    this.#photoService = options.photoService;
  }

  async get(slug: string, visitorToken: string | undefined): Promise<PublicFaceState> {
    const album = await this.#photoService.getAuthorizedPublicAlbum(slug, visitorToken);
    const [index] = await this.#database
      .select({
        enabled: schema.albumFaceIndexes.enabled,
        indexState: schema.albumFaceIndexes.indexState,
      })
      .from(schema.albumFaceIndexes)
      .where(eq(schema.albumFaceIndexes.albumId, album.id))
      .limit(1);

    return {
      enabled: index?.enabled === true,
      noticeVersion: this.#config.FACE_SEARCH_NOTICE_VERSION,
      indexState: index?.indexState ?? "disabled",
    };
  }
}
