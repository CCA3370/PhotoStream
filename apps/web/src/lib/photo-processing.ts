import type { PhotoVariantKind } from "@photostream/contracts";

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
  readonly file: File;
}

export type PhotoWorkerResponse =
  | { readonly id: string; readonly type: "metadata"; readonly metadata: ProcessedPhotoMetadata }
  | { readonly id: string; readonly type: "variant"; readonly variant: ProcessedPhotoVariant }
  | { readonly id: string; readonly type: "complete" }
  | { readonly id: string; readonly type: "error"; readonly message: string };

export interface PhotoProcessingHandlers {
  readonly onMetadata?: (metadata: ProcessedPhotoMetadata) => void | Promise<void>;
  readonly onVariant?: (variant: ProcessedPhotoVariant) => void | Promise<void>;
}

export async function processPhotoInWorkerStreaming(
  file: File,
  handlers: PhotoProcessingHandlers = {},
  options: { readonly signal?: AbortSignal } = {},
): Promise<ProcessedPhoto> {
  const worker = new Worker(new URL("../workers/photo-processor.worker.ts", import.meta.url), {
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
      worker.addEventListener("message", (event: MessageEvent<PhotoWorkerResponse>) => {
        if (event.data.id !== id) return;
        if (event.data.type === "error") {
          reject(new Error(event.data.message));
          return;
        }
        if (event.data.type === "metadata") {
          metadata = event.data.metadata;
          callbackTail = callbackTail.then(async () => {
            await handlers.onMetadata?.(event.data.metadata);
          });
          return;
        }
        if (event.data.type === "variant") {
          variants.push(event.data.variant);
          callbackTail = callbackTail.then(async () => {
            await handlers.onVariant?.(event.data.variant);
          });
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
      const request: PhotoWorkerRequest = { id, file };
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
