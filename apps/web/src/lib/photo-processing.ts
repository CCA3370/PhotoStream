import type { PhotoVariantKind } from "@photostream/contracts";

import { PHOTO_WORKER_PROTOCOL_VERSION } from "./photo-worker-protocol";

export interface ProcessedPhotoVariant {
  readonly kind: Exclude<PhotoVariantKind, "photo_original">;
  readonly format: "webp" | "jpeg";
  readonly contentType: "image/webp" | "image/jpeg";
  readonly width: number;
  readonly height: number;
  readonly blob: Blob;
}

export interface ProcessedPhotoMetadata {
  readonly width: number;
  readonly height: number;
  readonly originalFormat: "jpeg" | "png" | "webp";
  readonly originalContentType: "image/jpeg" | "image/png" | "image/webp";
  readonly capturedAt: string | null;
}

export interface ProcessedPhoto extends ProcessedPhotoMetadata {
  readonly variants: readonly ProcessedPhotoVariant[];
}

export interface PhotoWorkerRequest {
  readonly id: string;
  readonly protocolVersion: typeof PHOTO_WORKER_PROTOCOL_VERSION;
  readonly file: File;
}

type VersionedPhotoWorkerResponse<T extends object> = T & {
  readonly id: string;
  readonly protocolVersion: typeof PHOTO_WORKER_PROTOCOL_VERSION;
};

export type PhotoWorkerResponse =
  | VersionedPhotoWorkerResponse<{
      readonly type: "metadata";
      readonly metadata: ProcessedPhotoMetadata;
    }>
  | VersionedPhotoWorkerResponse<{
      readonly type: "variant";
      readonly variant: ProcessedPhotoVariant;
    }>
  | VersionedPhotoWorkerResponse<{ readonly type: "complete" }>
  | VersionedPhotoWorkerResponse<{ readonly type: "error"; readonly message: string }>;

export interface PhotoProcessingHandlers {
  readonly onMetadata?: (metadata: ProcessedPhotoMetadata) => void | Promise<void>;
  readonly onVariant?: (variant: ProcessedPhotoVariant) => void | Promise<void>;
}

function workerVersionError(): Error {
  return new Error("照片处理组件版本已过期，请刷新页面后重试");
}

export async function processPhotoInWorkerStreaming(
  file: File,
  handlers: PhotoProcessingHandlers = {},
  options: { readonly signal?: AbortSignal } = {},
): Promise<ProcessedPhoto> {
  const worker = new Worker(new URL("../workers/photo-processor-v2.worker.ts", import.meta.url), {
    type: "module",
  });
  const id = crypto.randomUUID();
  const aborted = () => new DOMException("照片处理已取消", "AbortError");
  let rejectOnAbort: (() => void) | undefined;
  let metadata: ProcessedPhotoMetadata | null = null;
  const variants: ProcessedPhotoVariant[] = [];
  let callbackTail: Promise<void> = Promise.resolve();

  try {
    return await new Promise<ProcessedPhoto>((resolve, reject) => {
      if (options.signal?.aborted === true) {
        reject(aborted());
        return;
      }
      rejectOnAbort = () => reject(aborted());
      options.signal?.addEventListener("abort", rejectOnAbort, { once: true });
      worker.addEventListener("message", (event: MessageEvent<unknown>) => {
        if (typeof event.data !== "object" || event.data === null) {
          reject(new Error("照片处理 Worker 返回了无效响应"));
          return;
        }
        const envelope = event.data as {
          readonly id?: unknown;
          readonly protocolVersion?: unknown;
          readonly type?: unknown;
        };
        if (envelope.id !== id) return;
        if (envelope.protocolVersion !== PHOTO_WORKER_PROTOCOL_VERSION) {
          reject(workerVersionError());
          return;
        }
        const response = event.data as PhotoWorkerResponse;
        if (response.type === "error") {
          reject(new Error(response.message));
          return;
        }
        if (response.type === "metadata") {
          const nextMetadata = response.metadata;
          metadata = nextMetadata;
          callbackTail = callbackTail.then(async () => {
            await handlers.onMetadata?.(nextMetadata);
          });
          return;
        }
        if (response.type === "variant") {
          const nextVariant = response.variant;
          variants.push(nextVariant);
          callbackTail = callbackTail.then(async () => {
            await handlers.onVariant?.(nextVariant);
          });
          return;
        }
        if (response.type !== "complete") {
          reject(new Error("照片处理 Worker 协议无效"));
          return;
        }
        void callbackTail
          .then(() => {
            if (metadata === null) throw new Error("照片处理 Worker 未返回元数据");
            resolve({ ...metadata, variants });
          })
          .catch(reject);
      });
      worker.addEventListener("error", () => reject(new Error("照片处理 Worker 运行失败")));
      const request: PhotoWorkerRequest = {
        id,
        protocolVersion: PHOTO_WORKER_PROTOCOL_VERSION,
        file,
      };
      worker.postMessage(request);
    });
  } finally {
    if (rejectOnAbort !== undefined) options.signal?.removeEventListener("abort", rejectOnAbort);
    worker.terminate();
  }
}

export async function processPhotoInWorker(
  file: File,
  options: { readonly signal?: AbortSignal } = {},
): Promise<ProcessedPhoto> {
  return processPhotoInWorkerStreaming(file, {}, options);
}
