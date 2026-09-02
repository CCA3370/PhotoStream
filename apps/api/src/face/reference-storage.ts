import OSS from "ali-oss";

import type { AppConfig } from "../config.js";

export interface FaceReferenceMetadata {
  readonly bytes: number;
  readonly contentType: string;
  readonly etag: string;
}

export interface FaceReferenceStorage {
  signPut(
    objectKey: string,
    expiresSeconds: number,
  ): Promise<{ url: string; headers: Record<string, string> }>;
  head(objectKey: string): Promise<FaceReferenceMetadata>;
  delete(objectKey: string): Promise<void>;
  uri(objectKey: string): string;
}

export class UnavailableFaceReferenceStorage implements FaceReferenceStorage {
  async signPut(): Promise<never> {
    throw new Error("face reference storage is disabled");
  }
  async head(): Promise<never> {
    throw new Error("face reference storage is disabled");
  }
  async delete(): Promise<never> {
    throw new Error("face reference storage is disabled");
  }
  uri(): never {
    throw new Error("face reference storage is disabled");
  }
}

export class AliyunFaceReferenceStorage implements FaceReferenceStorage {
  readonly #client: OSS;
  readonly #bucket: string;

  constructor(config: AppConfig) {
    if (
      config.ALIYUN_FACE_ACCESS_KEY_ID === undefined ||
      config.ALIYUN_FACE_ACCESS_KEY_SECRET === undefined ||
      config.ALIYUN_OSS_FACE_REFERENCE_BUCKET === undefined
    ) {
      throw new Error("Aliyun face reference storage is not configured");
    }
    this.#bucket = config.ALIYUN_OSS_FACE_REFERENCE_BUCKET;
    this.#client = new OSS({
      accessKeyId: config.ALIYUN_FACE_ACCESS_KEY_ID,
      accessKeySecret: config.ALIYUN_FACE_ACCESS_KEY_SECRET,
      bucket: this.#bucket,
      endpoint: config.ALIYUN_OSS_ENDPOINT,
      region: config.ALIYUN_OSS_REGION,
      secure: true,
      authorizationV4: true,
    });
  }

  async signPut(objectKey: string, expiresSeconds: number) {
    const headers = {
      "content-type": "image/jpeg",
      "x-oss-forbid-overwrite": "true",
    };
    return {
      url: await this.#client.signatureUrlV4(
        "PUT",
        expiresSeconds,
        { headers },
        objectKey,
        Object.keys(headers),
      ),
      headers,
    };
  }

  async head(objectKey: string): Promise<FaceReferenceMetadata> {
    const result = await this.#client.head(objectKey, { timeout: 5_000 });
    const headers = result.res.headers as Record<string, string | string[] | undefined>;
    const bytes = Number(headers["content-length"]);
    const contentType =
      String(headers["content-type"] ?? "")
        .split(";", 1)[0]
        ?.trim() ?? "";
    const etag = String(headers.etag ?? "").replaceAll('"', "");
    if (!Number.isSafeInteger(bytes) || bytes < 0 || etag === "") {
      throw new Error("OSS HEAD response is incomplete");
    }
    return { bytes, contentType, etag };
  }

  async delete(objectKey: string): Promise<void> {
    await this.#client.delete(objectKey);
  }

  uri(objectKey: string): string {
    return `oss://${this.#bucket}/${objectKey}`;
  }
}
