import { createHmac, timingSafeEqual } from "node:crypto";

export type LocalObjectMethod = "DELETE" | "GET" | "HEAD" | "PUT";

export interface SignLocalObjectOptions {
  readonly baseUrl: string;
  readonly key: string;
  readonly method: LocalObjectMethod;
  readonly secret: string;
  readonly expiresAt: Date;
  readonly contentType?: string;
  readonly contentLength?: number;
}

export interface VerifiedLocalObjectRequest {
  readonly key: string;
  readonly contentType: string | null;
  readonly contentLength: number | null;
  readonly expiresAt: Date;
}

function encodeObjectKey(key: string): string {
  const parts = key.split("/");
  if (
    parts.length === 0 ||
    parts.some(
      (part) =>
        part.length === 0 ||
        part === "." ||
        part === ".." ||
        part.includes("\\") ||
        part.includes("\0"),
    )
  ) {
    throw new Error("Invalid object key");
  }
  return parts.map((part) => encodeURIComponent(part)).join("/");
}

function decodeObjectKey(pathname: string): string {
  const prefix = "/objects/";
  if (!pathname.startsWith(prefix)) {
    throw new Error("Invalid object path");
  }
  const encoded = pathname.slice(prefix.length);
  const parts = encoded.split("/").map((part) => decodeURIComponent(part));
  if (
    parts.length === 0 ||
    parts.some(
      (part) =>
        part.length === 0 ||
        part === "." ||
        part === ".." ||
        part.includes("/") ||
        part.includes("\\") ||
        part.includes("\0"),
    )
  ) {
    throw new Error("Invalid object key");
  }
  return parts.join("/");
}

function canonicalValue(options: {
  readonly method: string;
  readonly pathname: string;
  readonly expires: string;
  readonly contentType: string;
  readonly contentLength: string;
  readonly objectKey?: string;
  readonly manifest?: string;
}): string {
  return [
    options.method,
    options.pathname,
    options.expires,
    options.contentType,
    options.contentLength,
    options.objectKey ?? "",
    options.manifest ?? "",
  ].join("\n");
}

function signature(secret: string, canonical: string): string {
  return createHmac("sha256", secret).update(canonical, "utf8").digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function signLocalObjectUrl(options: SignLocalObjectOptions): string {
  const url = new URL(options.baseUrl);
  url.pathname = `/objects/${encodeObjectKey(options.key)}`;
  const expires = Math.floor(options.expiresAt.getTime() / 1_000).toString();
  const contentType = options.contentType ?? "";
  const contentLength = options.contentLength?.toString() ?? "";
  const canonical = canonicalValue({
    method: options.method,
    pathname: url.pathname,
    expires,
    contentType,
    contentLength,
  });
  url.searchParams.set("expires", expires);
  if (contentType.length > 0) url.searchParams.set("contentType", contentType);
  if (contentLength.length > 0) url.searchParams.set("contentLength", contentLength);
  url.searchParams.set("signature", signature(options.secret, canonical));
  return url.href;
}

export function verifyLocalObjectRequest(options: {
  readonly url: URL;
  readonly method: string;
  readonly secret: string;
  readonly now?: Date;
}): VerifiedLocalObjectRequest {
  if (!(["DELETE", "GET", "HEAD", "PUT"] as const).includes(options.method as LocalObjectMethod)) {
    throw new Error("Unsupported method");
  }
  const expires = options.url.searchParams.get("expires") ?? "";
  const suppliedSignature = options.url.searchParams.get("signature") ?? "";
  const contentType = options.url.searchParams.get("contentType") ?? "";
  const contentLength = options.url.searchParams.get("contentLength") ?? "";
  if (!/^\d+$/u.test(expires)) throw new Error("Invalid expiry");
  const expiresAt = new Date(Number(expires) * 1_000);
  if (expiresAt <= (options.now ?? new Date())) throw new Error("Expired signature");
  const canonical = canonicalValue({
    method: options.method,
    pathname: options.url.pathname,
    expires,
    contentType,
    contentLength,
  });
  if (!safeEqual(signature(options.secret, canonical), suppliedSignature)) {
    throw new Error("Invalid signature");
  }
  const parsedLength = contentLength.length === 0 ? null : Number(contentLength);
  if (parsedLength !== null && (!Number.isSafeInteger(parsedLength) || parsedLength < 0)) {
    throw new Error("Invalid content length");
  }
  return {
    key: decodeObjectKey(options.url.pathname),
    contentType: contentType.length === 0 ? null : contentType,
    contentLength: parsedLength,
    expiresAt,
  };
}

function multipartPartPath(uploadId: string, partNumber: number): string {
  if (!/^[0-9a-f-]{36}$/u.test(uploadId) || !Number.isSafeInteger(partNumber) || partNumber < 1) {
    throw new Error("Invalid multipart part");
  }
  return `/multipart/${uploadId}/parts/${partNumber}`;
}

export function signLocalMultipartPartUrl(
  options: Omit<SignLocalObjectOptions, "key" | "method"> & {
    readonly uploadId: string;
    readonly partNumber: number;
    readonly method?: "HEAD" | "PUT";
  },
): string {
  const url = new URL(options.baseUrl);
  url.pathname = multipartPartPath(options.uploadId, options.partNumber);
  const method = options.method ?? "PUT";
  const expires = Math.floor(options.expiresAt.getTime() / 1_000).toString();
  const contentType = options.contentType ?? "";
  const contentLength = options.contentLength?.toString() ?? "";
  const canonical = canonicalValue({
    method,
    pathname: url.pathname,
    expires,
    contentType,
    contentLength,
  });
  url.searchParams.set("expires", expires);
  if (contentType.length > 0) url.searchParams.set("contentType", contentType);
  if (contentLength.length > 0) url.searchParams.set("contentLength", contentLength);
  url.searchParams.set("signature", signature(options.secret, canonical));
  return url.href;
}

export function verifyLocalMultipartPartRequest(options: {
  readonly url: URL;
  readonly method: string;
  readonly secret: string;
  readonly now?: Date;
}) {
  if (options.method !== "PUT" && options.method !== "HEAD") {
    throw new Error("Unsupported method");
  }
  const match = /^\/multipart\/([0-9a-f-]{36})\/parts\/([1-9]\d*)$/u.exec(options.url.pathname);
  if (match === null) throw new Error("Invalid multipart part path");
  const expires = options.url.searchParams.get("expires") ?? "";
  const suppliedSignature = options.url.searchParams.get("signature") ?? "";
  const contentType = options.url.searchParams.get("contentType") ?? "";
  const contentLength = options.url.searchParams.get("contentLength") ?? "";
  if (!/^\d+$/u.test(expires)) throw new Error("Invalid expiry");
  const expiresAt = new Date(Number(expires) * 1_000);
  if (expiresAt <= (options.now ?? new Date())) throw new Error("Expired signature");
  const canonical = canonicalValue({
    method: options.method,
    pathname: options.url.pathname,
    expires,
    contentType,
    contentLength,
  });
  if (!safeEqual(signature(options.secret, canonical), suppliedSignature)) {
    throw new Error("Invalid signature");
  }
  const parsedLength = contentLength.length === 0 ? null : Number(contentLength);
  if (parsedLength !== null && (!Number.isSafeInteger(parsedLength) || parsedLength < 0)) {
    throw new Error("Invalid content length");
  }
  return {
    uploadId: match[1] as string,
    partNumber: Number(match[2]),
    contentType: contentType.length === 0 ? null : contentType,
    contentLength: parsedLength,
    expiresAt,
  };
}

export interface MultipartManifestEntry {
  readonly partNumber: number;
  readonly etag: string;
}

export function signLocalMultipartCompleteUrl(options: {
  readonly baseUrl: string;
  readonly uploadId: string;
  readonly objectKey: string;
  readonly contentType: string;
  readonly manifest: readonly MultipartManifestEntry[];
  readonly secret: string;
  readonly expiresAt: Date;
}): string {
  const url = new URL(options.baseUrl);
  url.pathname = `/multipart/${options.uploadId}/complete`;
  if (!/^[0-9a-f-]{36}$/u.test(options.uploadId)) throw new Error("Invalid multipart upload");
  const objectKey = encodeObjectKey(options.objectKey);
  const manifest = Buffer.from(JSON.stringify(options.manifest), "utf8").toString("base64url");
  const expires = Math.floor(options.expiresAt.getTime() / 1_000).toString();
  const canonical = canonicalValue({
    method: "POST",
    pathname: url.pathname,
    expires,
    contentType: options.contentType,
    contentLength: "",
    objectKey,
    manifest,
  });
  url.searchParams.set("expires", expires);
  url.searchParams.set("contentType", options.contentType);
  url.searchParams.set("objectKey", objectKey);
  url.searchParams.set("manifest", manifest);
  url.searchParams.set("signature", signature(options.secret, canonical));
  return url.href;
}

export function verifyLocalMultipartCompleteRequest(options: {
  readonly url: URL;
  readonly method: string;
  readonly secret: string;
  readonly now?: Date;
}) {
  if (options.method !== "POST") throw new Error("Unsupported method");
  const match = /^\/multipart\/([0-9a-f-]{36})\/complete$/u.exec(options.url.pathname);
  if (match === null) throw new Error("Invalid multipart complete path");
  const expires = options.url.searchParams.get("expires") ?? "";
  const contentType = options.url.searchParams.get("contentType") ?? "";
  const objectKey = options.url.searchParams.get("objectKey") ?? "";
  const manifest = options.url.searchParams.get("manifest") ?? "";
  const suppliedSignature = options.url.searchParams.get("signature") ?? "";
  if (!/^\d+$/u.test(expires) || contentType.length === 0 || objectKey.length === 0) {
    throw new Error("Invalid multipart completion");
  }
  const expiresAt = new Date(Number(expires) * 1_000);
  if (expiresAt <= (options.now ?? new Date())) throw new Error("Expired signature");
  const canonical = canonicalValue({
    method: options.method,
    pathname: options.url.pathname,
    expires,
    contentType,
    contentLength: "",
    objectKey,
    manifest,
  });
  if (!safeEqual(signature(options.secret, canonical), suppliedSignature)) {
    throw new Error("Invalid signature");
  }
  const parsedManifest = JSON.parse(Buffer.from(manifest, "base64url").toString("utf8")) as unknown;
  if (
    !Array.isArray(parsedManifest) ||
    parsedManifest.length === 0 ||
    parsedManifest.some(
      (entry) =>
        typeof entry !== "object" ||
        entry === null ||
        !("partNumber" in entry) ||
        !("etag" in entry) ||
        !Number.isSafeInteger(entry.partNumber) ||
        (entry.partNumber as number) < 1 ||
        typeof entry.etag !== "string" ||
        !/^[a-f0-9]{64}$/u.test(entry.etag),
    )
  ) {
    throw new Error("Invalid multipart manifest");
  }
  return {
    uploadId: match[1] as string,
    objectKey: decodeObjectKey(`/objects/${objectKey}`),
    contentType,
    manifest: parsedManifest as MultipartManifestEntry[],
    expiresAt,
  };
}
