import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { link, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, resolve, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  type MultipartManifestEntry,
  verifyLocalMultipartCompleteRequest,
  verifyLocalMultipartPartRequest,
  verifyLocalObjectRequest,
} from "@photostream/local-object-protocol";

export interface LocalObjectStoreConfig {
  readonly appOrigin: string;
  readonly secret: string;
  readonly storageRoot: string;
}

interface ObjectMetadata {
  readonly contentType: string;
  readonly etag: string;
  readonly bytes: number;
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function setCors(request: IncomingMessage, response: ServerResponse, appOrigin: string): boolean {
  const origin = request.headers.origin;
  if (origin !== undefined && origin !== appOrigin) {
    sendJson(response, 403, { code: "ORIGIN_FORBIDDEN" });
    return false;
  }
  if (origin === appOrigin) {
    response.setHeader("access-control-allow-origin", appOrigin);
    response.setHeader("vary", "Origin");
    response.setHeader("access-control-expose-headers", "etag, content-length, content-range");
  }
  return true;
}

function objectPath(storageRoot: string, key: string): string {
  const root = resolve(storageRoot);
  const candidate = resolve(root, key);
  if (!candidate.startsWith(`${root}${sep}`)) {
    throw new Error("Object escaped storage root");
  }
  return candidate;
}

function metadataPath(path: string): string {
  return `${path}.metadata.json`;
}

async function removeIfPresent(path: string): Promise<void> {
  await unlink(path).catch((error: unknown) => {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  });
}

async function handlePut(options: {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly path: string;
  readonly expectedBytes: number;
  readonly contentType: string;
}): Promise<void> {
  const declaredBytes = Number(options.request.headers["content-length"] ?? -1);
  if (declaredBytes !== options.expectedBytes) {
    sendJson(options.response, 400, { code: "CONTENT_LENGTH_MISMATCH" });
    return;
  }
  if (options.request.headers["content-type"] !== options.contentType) {
    sendJson(options.response, 400, { code: "CONTENT_TYPE_MISMATCH" });
    return;
  }

  await mkdir(dirname(options.path), { recursive: true });
  const temporaryPath = `${options.path}.upload-${randomUUID()}`;
  const temporaryMetadataPath = `${temporaryPath}.metadata.json`;
  const digest = createHash("sha256");
  let received = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (received > options.expectedBytes) {
        callback(new Error("Object exceeds signed content length"));
        return;
      }
      digest.update(chunk);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(options.request, counter, createWriteStream(temporaryPath, { flags: "wx" }));
    if (received !== options.expectedBytes) {
      throw new Error("Object shorter than signed content length");
    }
    const etag = digest.digest("hex");
    const metadata: ObjectMetadata = {
      contentType: options.contentType,
      etag,
      bytes: received,
    };
    await writeFile(temporaryMetadataPath, JSON.stringify(metadata), { flag: "wx" });
    await link(temporaryPath, options.path);
    try {
      await link(temporaryMetadataPath, metadataPath(options.path));
    } catch (error) {
      await removeIfPresent(options.path);
      throw error;
    }
    options.response.writeHead(201, { etag, "cache-control": "no-store" });
    options.response.end();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      const existing = await existingObjectMetadata(options.path);
      if (
        existing !== null &&
        existing.bytes === options.expectedBytes &&
        existing.contentType === options.contentType
      ) {
        options.response.writeHead(409, {
          etag: existing.etag,
          "cache-control": "no-store",
        });
        options.response.end();
      } else {
        sendJson(options.response, 409, { code: "OBJECT_ALREADY_EXISTS" });
      }
    } else {
      sendJson(options.response, 400, { code: "OBJECT_WRITE_FAILED" });
    }
  } finally {
    await Promise.all([removeIfPresent(temporaryPath), removeIfPresent(temporaryMetadataPath)]);
  }
}

async function readMetadata(path: string): Promise<ObjectMetadata> {
  return JSON.parse(await readFile(metadataPath(path), "utf8")) as ObjectMetadata;
}

function multipartPartPath(storageRoot: string, uploadId: string, partNumber: number): string {
  return objectPath(storageRoot, `.multipart/${uploadId}/${partNumber}`);
}

function sendObjectMetadata(
  response: ServerResponse,
  status: number,
  metadata: ObjectMetadata,
): void {
  response.writeHead(status, {
    etag: metadata.etag,
    "content-length": "0",
    "cache-control": "no-store",
  });
  response.end();
}

async function existingObjectMetadata(path: string): Promise<ObjectMetadata | null> {
  try {
    const [file, metadata] = await Promise.all([stat(path), readMetadata(path)]);
    return file.size === metadata.bytes ? metadata : null;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

async function handleMultipartComplete(options: {
  readonly response: ServerResponse;
  readonly storageRoot: string;
  readonly uploadId: string;
  readonly objectKey: string;
  readonly contentType: string;
  readonly manifest: readonly MultipartManifestEntry[];
}): Promise<void> {
  const finalPath = objectPath(options.storageRoot, options.objectKey);
  const existing = await existingObjectMetadata(finalPath);
  if (existing !== null) {
    sendObjectMetadata(options.response, 200, existing);
    return;
  }
  const ordered = [...options.manifest].sort((left, right) => left.partNumber - right.partNumber);
  if (ordered.some((part, index) => part.partNumber !== index + 1)) {
    sendJson(options.response, 400, { code: "INVALID_MULTIPART_MANIFEST" });
    return;
  }
  const partPaths = ordered.map((part) =>
    multipartPartPath(options.storageRoot, options.uploadId, part.partNumber),
  );
  let partMetadata: ObjectMetadata[];
  try {
    partMetadata = await Promise.all(partPaths.map((path) => readMetadata(path)));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      sendJson(options.response, 409, { code: "MULTIPART_PART_MISSING" });
      return;
    }
    throw error;
  }
  if (
    partMetadata.some(
      (metadata, index) =>
        metadata.etag !== ordered[index]?.etag || metadata.contentType !== options.contentType,
    )
  ) {
    sendJson(options.response, 409, { code: "MULTIPART_ETAG_MISMATCH" });
    return;
  }

  await mkdir(dirname(finalPath), { recursive: true });
  const temporaryPath = `${finalPath}.upload-${randomUUID()}`;
  const temporaryMetadataPath = `${temporaryPath}.metadata.json`;
  const digest = createHash("sha256");
  let bytes = 0;
  const source = Readable.from(
    (async function* parts() {
      for (const path of partPaths) {
        for await (const chunk of createReadStream(path)) yield chunk;
      }
    })(),
  );
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      digest.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(source, counter, createWriteStream(temporaryPath, { flags: "wx" }));
    const metadata: ObjectMetadata = {
      contentType: options.contentType,
      etag: digest.digest("hex"),
      bytes,
    };
    await writeFile(temporaryMetadataPath, JSON.stringify(metadata), { flag: "wx" });
    await link(temporaryPath, finalPath);
    try {
      await link(temporaryMetadataPath, metadataPath(finalPath));
    } catch (error) {
      await removeIfPresent(finalPath);
      throw error;
    }
    await Promise.all(
      partPaths.flatMap((path) => [removeIfPresent(path), removeIfPresent(metadataPath(path))]),
    );
    sendObjectMetadata(options.response, 201, metadata);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      const raced = await existingObjectMetadata(finalPath);
      if (raced !== null) {
        sendObjectMetadata(options.response, 200, raced);
        return;
      }
    }
    sendJson(options.response, 400, { code: "MULTIPART_COMPLETE_FAILED" });
  } finally {
    await Promise.all([removeIfPresent(temporaryPath), removeIfPresent(temporaryMetadataPath)]);
  }
}

function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null {
  if (header === undefined) return null;
  const match = /^bytes=(\d+)-(\d*)$/u.exec(header);
  if (match === null) throw new Error("Invalid range");
  const start = Number(match[1]);
  const end = match[2] === "" ? size - 1 : Number(match[2]);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    end >= size
  ) {
    throw new Error("Unsatisfiable range");
  }
  return { start, end };
}

async function handleRead(options: {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly path: string;
  readonly headOnly: boolean;
}): Promise<void> {
  try {
    const [file, metadata] = await Promise.all([stat(options.path), readMetadata(options.path)]);
    const range = parseRange(options.request.headers.range, file.size);
    const status = range === null ? 200 : 206;
    const start = range?.start ?? 0;
    const end = range?.end ?? file.size - 1;
    const headers: Record<string, string | number> = {
      "accept-ranges": "bytes",
      "cache-control": "private, max-age=7200",
      "content-length": end - start + 1,
      "content-type": metadata.contentType,
      etag: metadata.etag,
      "x-content-type-options": "nosniff",
    };
    if (range !== null) headers["content-range"] = `bytes ${start}-${end}/${file.size}`;
    options.response.writeHead(status, headers);
    if (options.headOnly) {
      options.response.end();
      return;
    }
    await pipeline(createReadStream(options.path, { start, end }), options.response);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      sendJson(options.response, 404, { code: "OBJECT_NOT_FOUND" });
      return;
    }
    if (error instanceof Error && error.message.includes("range")) {
      options.response.writeHead(416, { "content-range": "bytes */*" });
      options.response.end();
      return;
    }
    sendJson(options.response, 500, { code: "OBJECT_READ_FAILED" });
  }
}

export function createObjectStoreServer(config: LocalObjectStoreConfig) {
  return createServer(async (request, response) => {
    try {
      if (!setCors(request, response, config.appOrigin)) return;
      if (request.method === "OPTIONS") {
        response.writeHead(204, {
          "access-control-allow-origin": config.appOrigin,
          "access-control-allow-methods": "PUT, GET, HEAD, POST, OPTIONS",
          "access-control-allow-headers": "content-type",
          "access-control-max-age": "600",
        });
        response.end();
        return;
      }
      if (request.url === undefined || request.method === undefined) {
        sendJson(response, 400, { code: "INVALID_REQUEST" });
        return;
      }
      const url = new URL(request.url, "http://local-object-store.invalid");
      if (url.pathname.startsWith("/multipart/")) {
        if (url.pathname.endsWith("/complete")) {
          const verified = verifyLocalMultipartCompleteRequest({
            url,
            method: request.method,
            secret: config.secret,
          });
          if (Number(request.headers["content-length"] ?? 0) !== 0) {
            sendJson(response, 400, { code: "UNEXPECTED_REQUEST_BODY" });
            return;
          }
          await handleMultipartComplete({
            response,
            storageRoot: config.storageRoot,
            uploadId: verified.uploadId,
            objectKey: verified.objectKey,
            contentType: verified.contentType,
            manifest: verified.manifest,
          });
          return;
        }
        const verified = verifyLocalMultipartPartRequest({
          url,
          method: request.method,
          secret: config.secret,
        });
        const path = multipartPartPath(config.storageRoot, verified.uploadId, verified.partNumber);
        if (request.method === "PUT") {
          if (verified.contentLength === null || verified.contentType === null) {
            sendJson(response, 400, { code: "MISSING_SIGNED_UPLOAD_METADATA" });
            return;
          }
          await handlePut({
            request,
            response,
            path,
            expectedBytes: verified.contentLength,
            contentType: verified.contentType,
          });
          return;
        }
        await handleRead({ request, response, path, headOnly: true });
        return;
      }
      const verified = verifyLocalObjectRequest({
        url,
        method: request.method,
        secret: config.secret,
      });
      const path = objectPath(config.storageRoot, verified.key);
      if (request.method === "PUT") {
        if (verified.contentLength === null || verified.contentType === null) {
          sendJson(response, 400, { code: "MISSING_SIGNED_UPLOAD_METADATA" });
          return;
        }
        await handlePut({
          request,
          response,
          path,
          expectedBytes: verified.contentLength,
          contentType: verified.contentType,
        });
        return;
      }
      await handleRead({ request, response, path, headOnly: request.method === "HEAD" });
    } catch {
      sendJson(response, 403, { code: "INVALID_SIGNATURE" });
    }
  });
}
