import { createHmac } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

const allowedEndpoint = "https://oss-cn-beijing.aliyuncs.com";
const bucketPattern = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u;
const objectKeyPattern = /^[A-Za-z0-9._/-]{1,512}$/u;

function normalizeOssHeaders(headers) {
  return Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase(), String(value).trim()])
    .filter(([name]) => name.startsWith("x-oss-"))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}:${value}\n`)
    .join("");
}

export function createOssAuthorization(options) {
  const canonicalResource = `/${options.bucket}/${options.objectKey}`;
  const canonicalHeaders = normalizeOssHeaders(options.headers);
  const canonical = [
    options.method,
    options.contentMd5 ?? "",
    options.contentType ?? "",
    options.date,
    `${canonicalHeaders}${canonicalResource}`,
  ].join("\n");
  const signature = createHmac("sha1", options.accessKeySecret).update(canonical).digest("base64");
  return `OSS ${options.accessKeyId}:${signature}`;
}

function encodedObjectPath(objectKey) {
  return objectKey
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
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
  const date = (options.now ?? new Date()).toUTCString();
  const headers = {
    "Content-Type": options.contentType ?? "application/octet-stream",
    "Content-Length": String(file.size),
    Date: date,
    "x-oss-object-acl": "private",
    "x-oss-meta-sha256": options.sha256,
  };
  const authorization = createOssAuthorization({
    method: "PUT",
    bucket: options.bucket,
    objectKey: options.objectKey,
    date,
    contentType: headers["Content-Type"],
    headers,
    accessKeyId: options.accessKeyId,
    accessKeySecret: options.accessKeySecret,
  });
  const endpoint = new URL(options.endpoint);
  endpoint.hostname = `${options.bucket}.${endpoint.hostname}`;
  endpoint.pathname = `/${encodedObjectPath(options.objectKey)}`;

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
