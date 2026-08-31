import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

import type { AppConfig } from "../config.js";

export interface EncryptedBibNumber {
  readonly ciphertext: string;
  readonly iv: string;
  readonly authTag: string;
  readonly keyVersion: string;
  readonly blindIndex: string;
}

interface BibKeyMaterial {
  readonly dataKey: Buffer;
  readonly searchKey: string;
  readonly version: string;
}

function keyMaterial(options: {
  readonly dataKey: string;
  readonly searchKey: string;
  readonly keyVersion: string;
}): BibKeyMaterial {
  const dataKey = Buffer.from(options.dataKey, "base64url");
  if (dataKey.byteLength !== 32) throw new Error("Bib data key must contain 32 bytes");
  if (options.searchKey.length < 32) throw new Error("Bib search key must contain 32 characters");
  return { dataKey, searchKey: options.searchKey, version: options.keyVersion };
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
  readonly #current: BibKeyMaterial;
  readonly #previous: BibKeyMaterial | null;
  readonly #byVersion: ReadonlyMap<string, BibKeyMaterial>;

  constructor(options: {
    readonly dataKey: string;
    readonly searchKey: string;
    readonly keyVersion: string;
    readonly previous?: {
      readonly dataKey: string;
      readonly searchKey: string;
      readonly keyVersion: string;
    };
  }) {
    this.#current = keyMaterial(options);
    const previous = options.previous === undefined ? null : keyMaterial(options.previous);
    if (previous?.version === this.#current.version) {
      throw new Error("Bib key versions must be unique");
    }
    this.#previous = previous;
    this.#byVersion = new Map([
      [this.#current.version, this.#current],
      ...(previous === null ? [] : ([[previous.version, previous]] as const)),
    ]);
  }

  static fromConfig(config: AppConfig): BibCrypto | null {
    if (config.BIB_DATA_KEY === undefined || config.BIB_SEARCH_KEY === undefined) return null;
    return new BibCrypto({
      dataKey: config.BIB_DATA_KEY,
      searchKey: config.BIB_SEARCH_KEY,
      keyVersion: config.BIB_KEY_VERSION,
      ...(config.BIB_DATA_KEY_PREVIOUS === undefined ||
      config.BIB_SEARCH_KEY_PREVIOUS === undefined ||
      config.BIB_KEY_VERSION_PREVIOUS === undefined
        ? {}
        : {
            previous: {
              dataKey: config.BIB_DATA_KEY_PREVIOUS,
              searchKey: config.BIB_SEARCH_KEY_PREVIOUS,
              keyVersion: config.BIB_KEY_VERSION_PREVIOUS,
            },
          }),
    });
  }

  get currentKeyVersion(): string {
    return this.#current.version;
  }

  get hasPreviousKey(): boolean {
    return this.#previous !== null;
  }

  get previousKeyVersion(): string | null {
    return this.#previous?.version ?? null;
  }

  supportsKeyVersion(version: string): boolean {
    return this.#byVersion.has(version);
  }

  encrypt(options: {
    readonly albumId: string;
    readonly mediaId: string;
    readonly tagId: string;
    readonly number: string;
  }): EncryptedBibNumber {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#current.dataKey, iv);
    cipher.setAAD(additionalData({ ...options, keyVersion: this.#current.version }));
    const ciphertext = Buffer.concat([cipher.update(options.number, "utf8"), cipher.final()]);
    return {
      ciphertext: ciphertext.toString("base64url"),
      iv: iv.toString("base64url"),
      authTag: cipher.getAuthTag().toString("base64url"),
      keyVersion: this.#current.version,
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
    const key = this.#byVersion.get(options.keyVersion);
    if (key === undefined) throw new Error("Bib key version unavailable");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key.dataKey,
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
    return this.#blindIndex(this.#current, albumId, number);
  }

  blindIndexes(albumId: string, number: string): readonly string[] {
    return [
      ...new Set(
        [...this.#byVersion.values()].map((key) => this.#blindIndex(key, albumId, number)),
      ),
    ];
  }

  requestHashes(value: unknown): readonly [string, ...string[]] {
    const hashes = [
      ...new Set([...this.#byVersion.values()].map((key) => this.#requestHash(key, value))),
    ];
    return hashes as [string, ...string[]];
  }

  requestHash(value: unknown): string {
    return this.#requestHash(this.#current, value);
  }

  #blindIndex(key: BibKeyMaterial, albumId: string, number: string): string {
    return createHmac("sha256", key.searchKey)
      .update(`${albumId}\n${number}`, "utf8")
      .digest("hex");
  }

  #requestHash(key: BibKeyMaterial, value: unknown): string {
    return createHmac("sha256", key.searchKey)
      .update("photostream:bib-idempotency:v1\n", "utf8")
      .update(JSON.stringify(value), "utf8")
      .digest("hex");
  }
}
