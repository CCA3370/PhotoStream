import {
  signLocalMultipartCompleteUrl,
  signLocalMultipartPartUrl,
  signLocalObjectUrl,
} from "@photostream/local-object-protocol";

export interface ObjectMetadata {
  readonly bytes: number;
  readonly contentType: string;
  readonly etag: string;
}

export interface SignedPut {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly expiresAt: Date;
}

export interface ObjectStorage {
  signPut(options: {
    readonly key: string;
    readonly contentType: string;
    readonly bytes: number;
    readonly expiresAt: Date;
  }): SignedPut;
  signRead(options: { readonly key: string; readonly expiresAt: Date }): string;
  signMultipartPart(options: {
    readonly uploadId: string;
    readonly partNumber: number;
    readonly contentType: string;
    readonly bytes: number;
    readonly expiresAt: Date;
  }): SignedPut;
  completeMultipart(options: {
    readonly uploadId: string;
    readonly key: string;
    readonly contentType: string;
    readonly parts: readonly { readonly partNumber: number; readonly etag: string }[];
  }): Promise<void>;
  delete(key: string): Promise<void>;
  head(key: string): Promise<ObjectMetadata | null>;
}

export class LocalObjectStorage implements ObjectStorage {
  readonly #baseUrl: string;
  readonly #secret: string;

  constructor(options: { readonly baseUrl: string; readonly secret: string }) {
    this.#baseUrl = options.baseUrl;
    this.#secret = options.secret;
  }

  signPut(options: {
    readonly key: string;
    readonly contentType: string;
    readonly bytes: number;
    readonly expiresAt: Date;
  }): SignedPut {
    return {
      url: signLocalObjectUrl({
        baseUrl: this.#baseUrl,
        key: options.key,
        method: "PUT",
        secret: this.#secret,
        expiresAt: options.expiresAt,
        contentType: options.contentType,
        contentLength: options.bytes,
      }),
      headers: { "content-type": options.contentType },
      expiresAt: options.expiresAt,
    };
  }

  signRead(options: { readonly key: string; readonly expiresAt: Date }): string {
    return signLocalObjectUrl({
      baseUrl: this.#baseUrl,
      key: options.key,
      method: "GET",
      secret: this.#secret,
      expiresAt: options.expiresAt,
    });
  }

  signMultipartPart(options: {
    readonly uploadId: string;
    readonly partNumber: number;
    readonly contentType: string;
    readonly bytes: number;
    readonly expiresAt: Date;
  }): SignedPut {
    return {
      url: signLocalMultipartPartUrl({
        baseUrl: this.#baseUrl,
        uploadId: options.uploadId,
        partNumber: options.partNumber,
        secret: this.#secret,
        expiresAt: options.expiresAt,
        contentType: options.contentType,
        contentLength: options.bytes,
      }),
      headers: { "content-type": options.contentType },
      expiresAt: options.expiresAt,
    };
  }

  async completeMultipart(options: {
    readonly uploadId: string;
    readonly key: string;
    readonly contentType: string;
    readonly parts: readonly { readonly partNumber: number; readonly etag: string }[];
  }): Promise<void> {
    const response = await fetch(
      signLocalMultipartCompleteUrl({
        baseUrl: this.#baseUrl,
        uploadId: options.uploadId,
        objectKey: options.key,
        contentType: options.contentType,
        manifest: options.parts,
        secret: this.#secret,
        expiresAt: new Date(Date.now() + 60_000),
      }),
      { method: "POST", signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) {
      throw new Error(`Multipart completion failed with status ${response.status}`);
    }
  }

  async delete(key: string): Promise<void> {
    const response = await fetch(
      signLocalObjectUrl({
        baseUrl: this.#baseUrl,
        key,
        method: "DELETE",
        secret: this.#secret,
        expiresAt: new Date(Date.now() + 60_000),
      }),
      { method: "DELETE", signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) throw new Error(`Object DELETE failed with status ${response.status}`);
  }

  async head(key: string): Promise<ObjectMetadata | null> {
    const response = await fetch(
      signLocalObjectUrl({
        baseUrl: this.#baseUrl,
        key,
        method: "HEAD",
        secret: this.#secret,
        expiresAt: new Date(Date.now() + 60_000),
      }),
      { method: "HEAD", signal: AbortSignal.timeout(5_000) },
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Object HEAD failed with status ${response.status}`);
    const bytes = Number(response.headers.get("content-length"));
    const contentType = response.headers.get("content-type");
    const etag = response.headers.get("etag");
    if (!Number.isSafeInteger(bytes) || bytes < 0 || contentType === null || etag === null) {
      throw new Error("Object HEAD returned invalid metadata");
    }
    return { bytes, contentType, etag };
  }
}
