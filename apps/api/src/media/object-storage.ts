import { createHash, randomBytes } from "node:crypto";
import {
  signLocalMultipartAbortUrl,
  signLocalMultipartCompleteUrl,
  signLocalMultipartPartUrl,
  signLocalObjectUrl,
} from "@photostream/local-object-protocol";
import OSS from "ali-oss";

import type { AliyunOssRegion } from "../config.js";

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
  }): SignedPut | Promise<SignedPut>;
  signRead(options: { readonly key: string; readonly expiresAt: Date }): string;
  createMultipartUpload?(options: {
    readonly key: string;
    readonly contentType: string;
    readonly clientUploadId: string;
  }): Promise<string>;
  signMultipartPart(options: {
    readonly key?: string;
    readonly uploadId: string;
    readonly partNumber: number;
    readonly contentType: string;
    readonly bytes: number;
    readonly expiresAt: Date;
  }): SignedPut | Promise<SignedPut>;
  completeMultipart(options: {
    readonly uploadId: string;
    readonly key: string;
    readonly contentType: string;
    readonly parts: readonly { readonly partNumber: number; readonly etag: string }[];
  }): Promise<void>;
  abortMultipart(uploadId: string, key?: string): Promise<void>;
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

  async signPut(options: {
    readonly key: string;
    readonly contentType: string;
    readonly bytes: number;
    readonly expiresAt: Date;
  }): Promise<SignedPut> {
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

  async createMultipartUpload(options: { readonly clientUploadId: string }): Promise<string> {
    return options.clientUploadId;
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

  async signMultipartPart(options: {
    readonly uploadId: string;
    readonly partNumber: number;
    readonly contentType: string;
    readonly bytes: number;
    readonly expiresAt: Date;
  }): Promise<SignedPut> {
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

  async abortMultipart(uploadId: string): Promise<void> {
    const response = await fetch(
      signLocalMultipartAbortUrl({
        baseUrl: this.#baseUrl,
        uploadId,
        secret: this.#secret,
        expiresAt: new Date(Date.now() + 60_000),
      }),
      { method: "DELETE", signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) throw new Error(`Multipart abort failed with status ${response.status}`);
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

interface AliyunObjectStorageOptions {
  readonly accessKeyId: string;
  readonly accessKeySecret: string;
  readonly bucket: string;
  readonly cdnAuthKey: string;
  readonly cdnAuthValiditySeconds: number;
  readonly endpoint: string;
  readonly mediaBaseUrl: string;
  readonly region: AliyunOssRegion;
}

interface AliyunErrorLike {
  readonly code?: unknown;
  readonly status?: unknown;
  readonly statusCode?: unknown;
}

function aliyunError(error: unknown): AliyunErrorLike {
  return typeof error === "object" && error !== null ? (error as AliyunErrorLike) : {};
}

function isMissingObject(error: unknown): boolean {
  const candidate = aliyunError(error);
  return (
    candidate.status === 404 ||
    candidate.statusCode === 404 ||
    candidate.code === "NoSuchKey" ||
    candidate.code === "NoSuchUpload"
  );
}

function encodedObjectPath(key: string): string {
  const parts = key.split("/");
  if (
    parts.length === 0 ||
    parts.some((part) => part.length === 0 || part === "." || part === ".." || part.includes("\\"))
  ) {
    throw new Error("Invalid object key");
  }
  return `/${parts.map((part) => encodeURIComponent(part)).join("/")}`;
}

export function signAliyunCdnUrl(options: {
  readonly authKey: string;
  readonly authValiditySeconds: number;
  readonly baseUrl: string;
  readonly expiresAt: Date;
  readonly key: string;
  readonly nonce?: string;
}): string {
  const baseUrl = new URL(options.baseUrl);
  if (baseUrl.protocol !== "https:" || baseUrl.username.length > 0 || baseUrl.password.length > 0) {
    throw new Error("Aliyun CDN base URL must be an HTTPS origin without credentials");
  }
  const pathname = encodedObjectPath(options.key);
  const timestamp = Math.floor(options.expiresAt.getTime() / 1_000) - options.authValiditySeconds;
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) throw new Error("Invalid CDN expiry");
  const nonce = options.nonce ?? randomBytes(16).toString("hex");
  if (!/^[A-Za-z0-9]+$/u.test(nonce)) throw new Error("Invalid CDN nonce");
  const uid = "0";
  const digest = createHash("md5")
    .update(`${pathname}-${timestamp}-${nonce}-${uid}-${options.authKey}`, "utf8")
    .digest("hex");
  baseUrl.pathname = pathname;
  baseUrl.search = "";
  baseUrl.hash = "";
  baseUrl.searchParams.set("auth_key", `${timestamp}-${nonce}-${uid}-${digest}`);
  return baseUrl.href;
}

export class AliyunObjectStorage implements ObjectStorage {
  readonly #cdnAuthKey: string;
  readonly #cdnAuthValiditySeconds: number;
  readonly #client: OSS;
  readonly #mediaBaseUrl: string;

  constructor(options: AliyunObjectStorageOptions) {
    this.#client = new OSS({
      accessKeyId: options.accessKeyId,
      accessKeySecret: options.accessKeySecret,
      authorizationV4: true,
      bucket: options.bucket,
      endpoint: options.endpoint,
      region: options.region,
      secure: true,
      timeout: 10_000,
    });
    this.#cdnAuthKey = options.cdnAuthKey;
    this.#cdnAuthValiditySeconds = options.cdnAuthValiditySeconds;
    this.#mediaBaseUrl = options.mediaBaseUrl;
  }

  async signPut(options: {
    readonly key: string;
    readonly contentType: string;
    readonly expiresAt: Date;
  }): Promise<SignedPut> {
    const headers = {
      "content-type": options.contentType,
      "x-oss-forbid-overwrite": "true",
    };
    return {
      url: await this.#client.signatureUrlV4(
        "PUT",
        this.#ttlSeconds(options.expiresAt),
        { headers },
        options.key,
        Object.keys(headers),
      ),
      headers,
      expiresAt: options.expiresAt,
    };
  }

  signRead(options: { readonly key: string; readonly expiresAt: Date }): string {
    return signAliyunCdnUrl({
      authKey: this.#cdnAuthKey,
      authValiditySeconds: this.#cdnAuthValiditySeconds,
      baseUrl: this.#mediaBaseUrl,
      expiresAt: options.expiresAt,
      key: options.key,
    });
  }

  async createMultipartUpload(options: {
    readonly key: string;
    readonly contentType: string;
  }): Promise<string> {
    const result = await this.#client.initMultipartUpload(options.key, {
      headers: { "x-oss-forbid-overwrite": "true" },
      mime: options.contentType,
    });
    return result.uploadId;
  }

  async signMultipartPart(options: {
    readonly key?: string;
    readonly uploadId: string;
    readonly partNumber: number;
    readonly contentType: string;
    readonly expiresAt: Date;
  }): Promise<SignedPut> {
    if (options.key === undefined) throw new Error("OSS multipart signing requires an object key");
    const headers = { "content-type": options.contentType };
    return {
      url: await this.#client.signatureUrlV4(
        "PUT",
        this.#ttlSeconds(options.expiresAt),
        {
          headers,
          queries: {
            partNumber: options.partNumber.toString(),
            uploadId: options.uploadId,
          },
        },
        options.key,
        Object.keys(headers),
      ),
      headers,
      expiresAt: options.expiresAt,
    };
  }

  async completeMultipart(options: {
    readonly uploadId: string;
    readonly key: string;
    readonly parts: readonly { readonly partNumber: number; readonly etag: string }[];
  }): Promise<void> {
    await this.#client.completeMultipartUpload(
      options.key,
      options.uploadId,
      options.parts.map((part) => ({ number: part.partNumber, etag: part.etag })),
      { headers: { "x-oss-forbid-overwrite": "true" } },
    );
  }

  async abortMultipart(uploadId: string, key?: string): Promise<void> {
    if (key === undefined) throw new Error("OSS multipart abort requires an object key");
    try {
      await this.#client.abortMultipartUpload(key, uploadId);
    } catch (error) {
      if (!isMissingObject(error)) throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.#client.delete(key);
    } catch (error) {
      if (!isMissingObject(error)) throw error;
    }
  }

  async head(key: string): Promise<ObjectMetadata | null> {
    try {
      const result = await this.#client.head(key);
      const headers = result.res.headers as Record<string, string | undefined>;
      const bytes = Number(headers["content-length"]);
      const contentType = headers["content-type"];
      const etag = headers.etag;
      if (
        !Number.isSafeInteger(bytes) ||
        bytes < 0 ||
        contentType === undefined ||
        etag === undefined
      ) {
        throw new Error("OSS HEAD response is incomplete");
      }
      return { bytes, contentType, etag: etag.replace(/^"|"$/gu, "") };
    } catch (error) {
      if (isMissingObject(error)) return null;
      throw error;
    }
  }

  #ttlSeconds(expiresAt: Date): number {
    const ttl = Math.floor((expiresAt.getTime() - Date.now()) / 1_000);
    if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > 7 * 24 * 60 * 60) {
      throw new Error("OSS signature expiry is outside the supported range");
    }
    return ttl;
  }
}
