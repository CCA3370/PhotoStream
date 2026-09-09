import { createHash, createHmac } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

const allowedEndpoint = "https://oss-cn-beijing.aliyuncs.com";
const allowedRegion = "cn-beijing";
const unsignedPayload = "UNSIGNED-PAYLOAD";
const bucketPattern = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u;
const objectKeyPattern = /^[A-Za-z0-9._/-]{1,512}$/u;
const unescapedUriCharacters = /[!'()*]/gu;

function uriEncode(value) {
  return encodeURIComponent(value).replace(unescapedUriCharacters, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function uriEncodePath(value) {
  return value
    .split("/")
    .map((segment) => uriEncode(segment))
    .join("/");
}

function ossTimestamp(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new Error("OSS signing date is invalid");
  return date.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
}

function normalizedHeaders(headers) {
  return new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value).trim()]),
  );
}

function hmac(key, data) {
  return createHmac("sha256", key).update(data).digest();
}

export function createOssAuthorization(options) {
  const headers = normalizedHeaders(options.headers);
  const timestamp = options.timestamp;
  if (headers.get("x-oss-content-sha256") !== unsignedPayload) {
    throw new Error("OSS V4 signing requires x-oss-content-sha256=UNSIGNED-PAYLOAD");
  }
  if (headers.get("x-oss-date") !== timestamp) {
    throw new Error("OSS V4 signing timestamp does not match x-oss-date");
  }

  const additionalHeaders = [...new Set(options.additionalHeaders ?? [])]
    .map((name) => name.toLowerCase())
    .sort();
  for (const name of additionalHeaders) {
    if (!headers.has(name)) throw new Error(`Missing signed OSS header: ${name}`);
  }

  const canonicalHeaderNames = new Set(additionalHeaders);
  for (const name of headers.keys()) {
    if (name === "content-type" || name === "content-md5" || name.startsWith("x-oss-")) {
      canonicalHeaderNames.add(name);
    }
  }
  const canonicalHeaders = [...canonicalHeaderNames]
    .sort()
    .map((name) => `${name}:${headers.get(name) ?? ""}\n`)
    .join("");
  const additionalHeaderValue = additionalHeaders.join(";");
  const canonicalUri = uriEncodePath(`/${options.bucket}/${options.objectKey}`);
  const canonicalRequest = [
    options.method,
    canonicalUri,
    "",
    canonicalHeaders,
    additionalHeaderValue,
    unsignedPayload,
  ].join("\n");
  const canonicalRequestHash = createHash("sha256").update(canonicalRequest).digest("hex");
  const signDate = timestamp.slice(0, 8);
  const scope = `${signDate}/${options.region}/oss/aliyun_v4_request`;
  const stringToSign = `OSS4-HMAC-SHA256\n${timestamp}\n${scope}\n${canonicalRequestHash}`;
  const dateKey = hmac(Buffer.from(`aliyun_v4${options.accessKeySecret}`, "utf8"), signDate);
  const dateRegionKey = hmac(dateKey, options.region);
  const dateRegionServiceKey = hmac(dateRegionKey, "oss");
  const signingKey = hmac(dateRegionServiceKey, "aliyun_v4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  const additional = additionalHeaderValue === "" ? "" : `,AdditionalHeaders=${additionalHeaderValue}`;

  return {
    authorization: `OSS4-HMAC-SHA256 Credential=${options.accessKeyId}/${scope}${additional},Signature=${signature}`,
    canonicalRequestHash,
    signature,
  };
}

export async function uploadPrivateBackup(options) {
  if (options.endpoint !== allowedEndpoint) {
    throw new Error("Backup uploads are restricted to the Beijing OSS endpoint");
  }
  if (!bucketPattern.test(options.bucket)) throw new Error("ALIYUN_OSS_BACKUP_BUCKET is invalid");
  if (!objectKeyPattern.test(options.objectKey) || options.objectKey.includes("..")) {
    throw new Error("Backup OSS object key is invalid");
  }
  if (typeof options.accessKeyId !== "string" || options.accessKeyId.length === 0) {
    throw new Error("ALIYUN_ACCESS_KEY_ID is required for backup upload");
  }
  if (typeof options.accessKeySecret !== "string" || options.accessKeySecret.length === 0) {
    throw new Error("ALIYUN_ACCESS_KEY_SECRET is required for backup upload");
  }
  if (!/^[a-f0-9]{64}$/u.test(options.sha256)) throw new Error("Backup SHA-256 is invalid");

  const file = await stat(options.filePath);
  if (!file.isFile() || file.size <= 0)
    throw new Error("Backup upload input must be a non-empty file");
  const timestamp = ossTimestamp(options.now ?? new Date());
  const headers = {
    "Content-Type": options.contentType ?? "application/octet-stream",
    "Content-Length": String(file.size),
    "x-oss-content-sha256": unsignedPayload,
    "x-oss-date": timestamp,
    "x-oss-object-acl": "private",
    "x-oss-meta-sha256": options.sha256,
  };
  const { authorization } = createOssAuthorization({
    method: "PUT",
    bucket: options.bucket,
    objectKey: options.objectKey,
    timestamp,
    region: allowedRegion,
    headers,
    additionalHeaders: ["content-length"],
    accessKeyId: options.accessKeyId,
    accessKeySecret: options.accessKeySecret,
  });
  const endpoint = new URL(options.endpoint);
  endpoint.hostname = `${options.bucket}.${endpoint.hostname}`;
  endpoint.pathname = `/${uriEncodePath(options.objectKey)}`;

  const response = await fetch(endpoint, {
    method: "PUT",
    headers: { ...headers, Authorization: authorization },
    body: createReadStream(options.filePath),
    duplex: "half",
    redirect: "error",
    signal: AbortSignal.timeout(10 * 60 * 1_000),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Backup OSS upload failed with HTTP ${response.status}`);
  }
  await response.body?.cancel().catch(() => undefined);
}

export const backupOssEndpoint = allowedEndpoint;
export const backupOssRegion = allowedRegion;
