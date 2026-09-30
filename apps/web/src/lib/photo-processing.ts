import type { PhotoVariantKind } from "@photostream/contracts";

import { isAppleWebKit } from "./apple-webkit";
import { inspectPhoto, validatePhotoDeclaration } from "./photo-inspection";
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

function aborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw new DOMException("照片处理已取消", "AbortError");
}

function dimensions(width: number, height: number, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function canvasBlob(
  canvas: HTMLCanvasElement,
  contentType: "image/webp" | "image/jpeg",
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null || blob.size === 0 || blob.type !== contentType) {
          reject(new Error(`浏览器无法编码 ${contentType}`));
          return;
        }
        resolve(blob);
      },
      contentType,
      quality,
    );
  });
}

async function decodeWithImageElement(
  file: File,
  signal?: AbortSignal,
): Promise<{
  readonly width: number;
  readonly height: number;
  draw(context: CanvasRenderingContext2D, width: number, height: number): void;
  close(): void;
}> {
  aborted(signal);
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  const loaded = new Promise<void>((resolve, reject) => {
    image.addEventListener("load", () => resolve(), { once: true });
    image.addEventListener("error", () => reject(new Error("Safari 无法解码这张照片")), {
      once: true,
    });
  });
  image.src = url;
  try {
    if (typeof image.decode === "function") {
      await Promise.race([image.decode(), loaded]).catch(async () => {
        await loaded;
      });
    } else {
      await loaded;
    }
    aborted(signal);
    if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
      throw new Error("照片尺寸无效");
    }
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      draw: (context, width, height) => context.drawImage(image, 0, 0, width, height),
      close: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

async function yieldToBrowser(): Promise<void> {
  if (typeof window === "undefined") return;
  await new Promise<void>((resolve) => {
    if (document.visibilityState === "visible") {
      window.requestAnimationFrame(() => resolve());
    } else {
      window.setTimeout(resolve, 0);
    }
  });
}

async function processPhotoOnMainThreadStreaming(
  file: File,
  handlers: PhotoProcessingHandlers,
  signal?: AbortSignal,
): Promise<ProcessedPhoto> {
  if (file.size <= 0 || file.size > 50 * 1024 * 1024) {
    throw new Error("单张照片必须大于 0 且不超过 50MB");
  }
  aborted(signal);
  const bytes = new Uint8Array(await file.slice(0, Math.min(file.size, 256 * 1024)).arrayBuffer());
  const detected = inspectPhoto(bytes);
  validatePhotoDeclaration(file, detected);
  if (detected.animated) throw new Error("首版不支持动态 WebP 或 APNG");

  // Safari is deliberately kept on DOM image/canvas primitives. They use WebKit's mature
  // decode path and avoid OffscreenCanvas/worker process crashes seen under memory pressure.
  const source = await decodeWithImageElement(file, signal);
  try {
    if (source.width * source.height > 100_000_000) {
      throw new Error("照片总像素不能超过 100MP");
    }
    const metadata: ProcessedPhotoMetadata = {
      width: source.width,
      height: source.height,
      originalFormat: detected.format,
      originalContentType: detected.contentType,
      capturedAt: detected.capturedAt,
    };
    await handlers.onMetadata?.(metadata);
    aborted(signal);

    const specs = [
      ["photo_480", 480, 0.7, 0.72],
      ["photo_960", 960, 0.76, 0.78],
      ["photo_1920", 1_920, 0.82, 0.84],
    ] as const;
    const variants: ProcessedPhotoVariant[] = [];
    let preferWebp = true;

    for (const [kind, maxEdge, webpQuality, jpegQuality] of specs) {
      aborted(signal);
      const size = dimensions(source.width, source.height, maxEdge);
      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      try {
        const context = canvas.getContext("2d", { alpha: false });
        if (context === null) throw new Error("Safari 无法创建图片处理画布");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, size.width, size.height);
        source.draw(context, size.width, size.height);

        let blob: Blob;
        let format: "webp" | "jpeg";
        let contentType: "image/webp" | "image/jpeg";
        if (preferWebp) {
          try {
            blob = await canvasBlob(canvas, "image/webp", webpQuality);
            format = "webp";
            contentType = "image/webp";
          } catch {
            preferWebp = false;
            blob = await canvasBlob(canvas, "image/jpeg", jpegQuality);
            format = "jpeg";
            contentType = "image/jpeg";
          }
        } else {
          blob = await canvasBlob(canvas, "image/jpeg", jpegQuality);
          format = "jpeg";
          contentType = "image/jpeg";
        }
        aborted(signal);
        const variant: ProcessedPhotoVariant = {
          kind,
          format,
          contentType,
          width: size.width,
          height: size.height,
          blob,
        };
        variants.push(variant);
        await handlers.onVariant?.(variant);
      } finally {
        // Explicitly release Safari's backing store before moving to the next variant.
        canvas.width = 1;
        canvas.height = 1;
      }
      await yieldToBrowser();
    }

    return { ...metadata, variants };
  } finally {
    source.close();
  }
}

async function processPhotoInDedicatedWorkerStreaming(
  file: File,
  handlers: PhotoProcessingHandlers = {},
  options: { readonly signal?: AbortSignal } = {},
): Promise<ProcessedPhoto> {
  const worker = new Worker(new URL("../workers/photo-processor-v2.worker.ts", import.meta.url), {
    type: "module",
  });
  const id = crypto.randomUUID();
  const abortError = () => new DOMException("照片处理已取消", "AbortError");
  let rejectOnAbort: (() => void) | undefined;
  let metadata: ProcessedPhotoMetadata | null = null;
  const variants: ProcessedPhotoVariant[] = [];
  let callbackTail: Promise<void> = Promise.resolve();

  try {
    return await new Promise<ProcessedPhoto>((resolve, reject) => {
      if (options.signal?.aborted === true) {
        reject(abortError());
        return;
      }
      rejectOnAbort = () => reject(abortError());
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

export async function processPhotoInWorkerStreaming(
  file: File,
  handlers: PhotoProcessingHandlers = {},
  options: { readonly signal?: AbortSignal } = {},
): Promise<ProcessedPhoto> {
  const workerPipelineAvailable =
    typeof Worker !== "undefined" &&
    typeof createImageBitmap === "function" &&
    typeof OffscreenCanvas === "function";
  if (isAppleWebKit() || !workerPipelineAvailable) {
    return processPhotoOnMainThreadStreaming(file, handlers, options.signal);
  }
  return processPhotoInDedicatedWorkerStreaming(file, handlers, options);
}

export async function processPhotoInWorker(
  file: File,
  options: { readonly signal?: AbortSignal } = {},
): Promise<ProcessedPhoto> {
  return processPhotoInWorkerStreaming(file, {}, options);
}
