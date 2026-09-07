import type { Database } from "@photostream/db";
import { schema } from "@photostream/db";
import { eq } from "drizzle-orm";

import type { AppConfig } from "../config.js";
import type { PhotoService } from "../media/service.js";

export interface PublicFaceAvailability {
  readonly available: boolean;
  readonly noticeVersion: string;
}

export class FaceAvailabilityService {
  readonly #database: Database;
  readonly #config: AppConfig;
  readonly #photoService: PhotoService;

  constructor(options: { database: Database; config: AppConfig; photoService: PhotoService }) {
    this.#database = options.database;
    this.#config = options.config;
    this.#photoService = options.photoService;
  }

  async get(slug: string, visitorToken: string | undefined): Promise<PublicFaceAvailability> {
    const album = await this.#photoService.getAuthorizedPublicAlbum(slug, visitorToken);
    const [index] = await this.#database
      .select({
        enabled: schema.albumFaceIndexes.enabled,
        indexState: schema.albumFaceIndexes.indexState,
        datasetName: schema.albumFaceIndexes.datasetName,
      })
      .from(schema.albumFaceIndexes)
      .where(eq(schema.albumFaceIndexes.albumId, album.id))
      .limit(1);

    return {
      available:
        index?.enabled === true &&
        index.datasetName !== null &&
        (index.indexState === "ready" || index.indexState === "degraded"),
      noticeVersion: this.#config.FACE_SEARCH_NOTICE_VERSION,
    };
  }
}
