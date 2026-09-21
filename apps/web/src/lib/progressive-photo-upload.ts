import type { PhotoVariantKind, SignedUpload, UploadIntentView } from "@photostream/contracts";
import {
  type MicroPreviewUploadRequest,
  microPreviewDimensions,
} from "@photostream/contracts/micro-preview";

import { ClientApiError, clientMutation } from "@/lib/client-api";
import type { ProcessedPhotoMetadata, ProcessedPhotoVariant } from "@/lib/photo-processing";

function signalOptions(signal?: AbortSignal): { readonly signal?: AbortSignal } {
  return signal === undefined ? {} : { signal };
}

export type UploadProgressCallback = (uploadedBytes: number, totalBytes: number) => void;

interface UploadResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: { get(name: string): string | null };
}

function xhrPut(
  url: string,
  headers: Readonly<Record<string, string>>,
  blob: Blob,
  signal: AbortSignal | undefined,
  onProgress: UploadProgressCallback | undefined,
): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url, true);
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    const abort = () => request.abort();
    signal?.addEventListener("abort", abort, { once: true });
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total);
      else onProgress?.(event.loaded, blob.size);
    });
    request.addEventListener("load", () => {
      signal?.removeEventListener("abort", abort);
      onProgress?.(blob.size, blob.size);
      resolve({
        status: request.status,
        ok: request.status >= 200 && request.status < 300,
        headers: { get: (name) => request.getResponseHeader(name) },
      });
    });
    request.addEventListener("error", () => {
      signal?.removeEventListener("abort", abort);
      reject(new Error("对象上传网络连接失败"));
    });
    request.addEventListener("abort", () => {
      signal?.removeEventListener("abort", abort);
      reject(new DOMException("上传已取消", "AbortError"));
    });
    request.send(blob);
  });
}

async function putSigned(
  path: string,
  blob: Blob,
  signal?: AbortSignal,
  onProgress?: UploadProgressCallback,
): Promise<UploadResponse> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const signed = await clientMutation<SignedUpload>(path, signalOptions(signal));
      const response = await xhrPut(signed.url, signed.headers, blob, signal, onProgress);
      if (response.ok || response.status === 409) return response;
      if (
        response.status < 500 &&
        response.status !== 408 &&
        response.status !== 425 &&
        response.status !== 429
      ) {
        throw new Error(`对象上传失败（${response.status}）`);
      }
      lastError = new Error(`对象上传暂时失败（${response.status}）`);
    } catch (error) {
      if (signal?.aborted === true) throw new DOMException("上传已取消", "AbortError");
      if (error instanceof ClientApiError && error.response?.retryable !== true) throw error;
      lastError = error;
    }
    if (attempt < 2) {
      await new Promise((resolve) => window.setTimeout(resolve, 350 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("对象上传失败");
}

async function transferObject(
  intent: UploadIntentView,
  kind: PhotoVariantKind,
  blob: Blob,
  signal?: AbortSignal,
  onProgress?: UploadProgressCallback,
): Promise<UploadIntentView> {
  const object = intent.objects.find((candidate) => candidate.kind === kind);
  if (object === undefined) throw new Error(`上传任务缺少 ${kind}`);
  if (object.completed) return intent;

  if (object.uploadMode === "multipart") {
    const parts = [...object.parts].sort((left, right) => left.partNumber - right.partNumber);
    let offset = 0;
    let completedBytes = 0;
    for (const part of parts) {
      const start = offset;
      offset += part.expectedBytes;
      if (part.completed) {
        completedBytes += part.expectedBytes;
        onProgress?.(completedBytes, blob.size);
        continue;
      }
      const slice = blob.slice(start, offset, object.contentType);
      const baseUploaded = completedBytes;
      const response = await putSigned(
        `/api/v1/uploads/${intent.id}/objects/${kind}/parts/${part.partNumber}/sign`,
        slice,
        signal,
        (uploaded) => onProgress?.(baseUploaded + uploaded, blob.size),
      );
      completedBytes += part.expectedBytes;
      const etag = response.headers.get("etag");
      if (etag === null) throw new Error(`分片 ${part.partNumber} 缺少 ETag`);
      await clientMutation<UploadIntentView>(
        `/api/v1/uploads/${intent.id}/objects/${kind}/parts/${part.partNumber}/complete`,
        {
          body: { etag },
          idempotencyKey: `progressive-part-${intent.id}-${kind}-${part.partNumber}`,
          ...signalOptions(signal),
        },
      );
    }
    if (offset !== blob.size) throw new Error("分片规格与本地文件不一致");
  } else {
    await putSigned(
      `/api/v1/uploads/${intent.id}/objects/${kind}/sign`,
      blob,
      signal,
      onProgress,
    );
  }

  return clientMutation<UploadIntentView>(`/api/v1/uploads/${intent.id}/objects/${kind}/complete`, {
    idempotencyKey: `progressive-object-${intent.id}-${kind}`,
    ...signalOptions(signal),
  });
}

export async function createProgressiveUpload(options: {
  readonly localPhotoId: string;
  readonly albumId: string;
  readonly categoryId: string | null;
  readonly file: File;
  readonly metadata: ProcessedPhotoMetadata;
  readonly signal?: AbortSignal;
}): Promise<UploadIntentView> {
  return clientMutation<UploadIntentView>("/api/v1/uploads/progressive", {
    body: {
      albumId: options.albumId,
      categoryId: options.categoryId,
      width: options.metadata.width,
      height: options.metadata.height,
      totalBytes: options.file.size,
      capturedAt: options.metadata.capturedAt,
      original: {
        format: options.metadata.originalFormat,
        contentType: options.metadata.originalContentType,
        bytes: options.file.size,
      },
    },
    idempotencyKey: `progressive-${options.localPhotoId}`,
    ...signalOptions(options.signal),
  });
}

export async function uploadProgressiveOriginal(
  intent: UploadIntentView,
  file: File,
  signal?: AbortSignal,
  onProgress?: UploadProgressCallback,
): Promise<UploadIntentView> {
  return transferObject(intent, "photo_original", file, signal, onProgress);
}

export async function registerAndUploadProgressiveVariant(
  intentId: string,
  variant: ProcessedPhotoVariant,
  signal?: AbortSignal,
  onProgress?: UploadProgressCallback,
): Promise<UploadIntentView> {
  const intent = await clientMutation<UploadIntentView>(`/api/v1/uploads/${intentId}/variants`, {
    body: {
      kind: variant.kind,
      format: variant.format,
      contentType: variant.contentType,
      width: variant.width,
      height: variant.height,
      bytes: variant.blob.size,
    },
    ...signalOptions(signal),
  });
  return transferObject(intent, variant.kind, variant.blob, signal, onProgress);
}

function encodeCanvas(
  canvas: HTMLCanvasElement,
  contentType: "image/webp" | "image/jpeg",
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null || blob.size === 0 || blob.type !== contentType) {
          reject(new Error("极小缩略图编码失败"));
          return;
        }
        resolve(blob);
      },
      contentType,
      quality,
    );
  });
}

export async function uploadProgressiveMicroPreview(
  mediaId: string,
  source: ProcessedPhotoVariant,
  originalWidth: number,
  originalHeight: number,
  signal?: AbortSignal,
): Promise<void> {
  if (source.kind !== "photo_480") return;
  const bitmap = await createImageBitmap(source.blob);
  try {
    const size = microPreviewDimensions(originalWidth, originalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d", { alpha: source.format === "webp" });
    if (context === null) throw new Error("浏览器无法创建极小缩略图画布");
    if (source.format === "jpeg") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, size.width, size.height);
    }
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const contentType = source.format === "webp" ? "image/webp" : "image/jpeg";
    const blob = await encodeCanvas(canvas, contentType, source.format === "webp" ? 0.58 : 0.62);
    const input: MicroPreviewUploadRequest = {
      format: source.format,
      contentType,
      width: size.width,
      height: size.height,
      bytes: blob.size,
    };
    const signed = await clientMutation<SignedUpload>(
      `/api/v1/media/${encodeURIComponent(mediaId)}/micro-preview/sign`,
      { body: input, ...signalOptions(signal) },
    );
    const response = await fetch(signed.url, {
      method: "PUT",
      headers: signed.headers,
      body: blob,
      ...(signal === undefined ? {} : { signal }),
    });
    if (!response.ok && response.status !== 409) {
      throw new Error(`极小缩略图上传失败（${response.status}）`);
    }
    await clientMutation<{ readonly ok: true }>(
      `/api/v1/media/${encodeURIComponent(mediaId)}/micro-preview/complete`,
      signalOptions(signal),
    );
  } finally {
    bitmap.close();
  }
}
