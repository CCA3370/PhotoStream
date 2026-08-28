import type { PhotoVariantKind } from "@photostream/contracts";

export interface ProcessedPhotoVariant {
  readonly kind: Exclude<PhotoVariantKind, "photo_original">;
  readonly format: "webp" | "jpeg";
  readonly contentType: "image/webp" | "image/jpeg";
  readonly width: number;
  readonly height: number;
  readonly blob: Blob;
}

export interface ProcessedPhoto {
  readonly width: number;
  readonly height: number;
  readonly originalFormat: "jpeg" | "png" | "webp";
  readonly originalContentType: "image/jpeg" | "image/png" | "image/webp";
  readonly capturedAt: string | null;
  readonly variants: readonly ProcessedPhotoVariant[];
}

export interface PhotoWorkerRequest {
  readonly id: string;
  readonly file: File;
}

export type PhotoWorkerResponse =
  | { readonly id: string; readonly ok: true; readonly photo: ProcessedPhoto }
  | { readonly id: string; readonly ok: false; readonly message: string };

export async function processPhotoInWorker(
  file: File,
  options: { readonly signal?: AbortSignal } = {},
): Promise<ProcessedPhoto> {
  const worker = new Worker(new URL("../workers/photo-processor.worker.ts", import.meta.url), {
    type: "module",
  });
  const id = crypto.randomUUID();
  const aborted = () => new DOMException("照片处理已取消", "AbortError");
  let rejectOnAbort: (() => void) | undefined;
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
        if (event.data.ok) resolve(event.data.photo);
        else reject(new Error(event.data.message));
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
