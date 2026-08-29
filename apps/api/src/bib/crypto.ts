import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

import type { AppConfig } from "../config.js";

export interface EncryptedBibNumber {
  readonly ciphertext: string;
  readonly iv: string;
  readonly authTag: string;
  readonly keyVersion: string;
  readonly blindIndex: string;
}

function additionalData(options: {
  readonly albumId: string;
  readonly mediaId: string;
  readonly tagId: string;
  readonly keyVersion: string;
}): Buffer {
  return Buffer.from(
    `${options.albumId}\n${options.mediaId}\n${options.tagId}\n${options.keyVersion}`,
    "utf8",
  );
}

export class BibCrypto {
  readonly #dataKey: Buffer;
  readonly #searchKey: string;
  readonly #keyVersion: string;

  constructor(options: {
    readonly dataKey: string;
    readonly searchKey: string;
    readonly keyVersion: string;
  }) {
    this.#dataKey = Buffer.from(options.dataKey, "base64url");
    if (this.#dataKey.byteLength !== 32) throw new Error("Bib data key must contain 32 bytes");
    if (options.searchKey.length < 32) throw new Error("Bib search key must contain 32 characters");
    this.#searchKey = options.searchKey;
    this.#keyVersion = options.keyVersion;
  }

  static fromConfig(config: AppConfig): BibCrypto | null {
    if (config.BIB_DATA_KEY === undefined || config.BIB_SEARCH_KEY === undefined) return null;
    return new BibCrypto({
      dataKey: config.BIB_DATA_KEY,
      searchKey: config.BIB_SEARCH_KEY,
      keyVersion: config.BIB_KEY_VERSION,
    });
  }

  encrypt(options: {
    readonly albumId: string;
    readonly mediaId: string;
    readonly tagId: string;
    readonly number: string;
  }): EncryptedBibNumber {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#dataKey, iv);
    cipher.setAAD(additionalData({ ...options, keyVersion: this.#keyVersion }));
    const ciphertext = Buffer.concat([cipher.update(options.number, "utf8"), cipher.final()]);
    return {
      ciphertext: ciphertext.toString("base64url"),
      iv: iv.toString("base64url"),
      authTag: cipher.getAuthTag().toString("base64url"),
      keyVersion: this.#keyVersion,
      blindIndex: this.blindIndex(options.albumId, options.number),
    };
  }

  decrypt(options: {
    readonly albumId: string;
    readonly mediaId: string;
    readonly tagId: string;
    readonly ciphertext: string;
    readonly iv: string;
    readonly authTag: string;
    readonly keyVersion: string;
  }): string {
    if (options.keyVersion !== this.#keyVersion) throw new Error("Bib key version unavailable");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.#dataKey,
      Buffer.from(options.iv, "base64url"),
    );
    decipher.setAAD(additionalData(options));
    decipher.setAuthTag(Buffer.from(options.authTag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(options.ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }

  blindIndex(albumId: string, number: string): string {
    return createHmac("sha256", this.#searchKey)
      .update(`${albumId}\n${number}`, "utf8")
      .digest("hex");
  }

  requestHash(value: unknown): string {
    return createHmac("sha256", this.#searchKey)
      .update("photostream:bib-idempotency:v1\n", "utf8")
      .update(JSON.stringify(value), "utf8")
      .digest("hex");
  }
}
