/// <reference lib="webworker" />

import { inspectPhoto, validatePhotoDeclaration } from "../lib/photo-inspection";
import type {
  PhotoWorkerRequest,
  PhotoWorkerResponse,
  ProcessedPhotoVariant,
} from "../lib/photo-processing";

const worker = self as unknown as DedicatedWorkerGlobalScope;

function dimensions(width: number, height: number, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function encode(
  bitmap: ImageBitmap,
  kind: ProcessedPhotoVariant["kind"],
  maxEdge: number,
  format: "webp" | "jpeg",
  quality: number,
): Promise<ProcessedPhotoVariant> {
  const size = dimensions(bitmap.width, bitmap.height, maxEdge);
  const canvas = new OffscreenCanvas(size.width, size.height);
  const context = canvas.getContext("2d", { alpha: format === "webp" });
  if (context === null) throw new Error("浏览器无法创建图片处理画布");
  if (format === "jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size.width, size.height);
  }
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  const contentType = format === "webp" ? "image/webp" : "image/jpeg";
  const blob = await canvas.convertToBlob({ type: contentType, quality });
  if (blob.type !== contentType || blob.size === 0) throw new Error("浏览器图片编码失败");
  return { kind, format, contentType, width: size.width, height: size.height, blob };
}

async function process(id: string, file: File): Promise<void> {
  if (file.size <= 0 || file.size > 50 * 1024 * 1024) {
    throw new Error("单张照片必须大于 0 且不超过 50MB");
  }
  const bytes = new Uint8Array(await file.slice(0, Math.min(file.size, 256 * 1024)).arrayBuffer());
  const detected = inspectPhoto(bytes);
  validatePhotoDeclaration(file, detected);
  if (detected.animated) throw new Error("首版不支持动态 WebP 或 APNG");
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    if (bitmap.width * bitmap.height > 100_000_000) {
      throw new Error("照片总像素不能超过 100MP");
    }
    const metadata: PhotoWorkerResponse = {
      id,
      type: "metadata",
      metadata: {
        width: bitmap.width,
        height: bitmap.height,
        originalFormat: detected.format,
        originalContentType: detected.contentType,
        capturedAt: detected.capturedAt,
      },
    };
    worker.postMessage(metadata);

    const qualities = {
      webp: [
        ["photo_480", 480, 0.7],
        ["photo_960", 960, 0.76],
        ["photo_1920", 1_920, 0.82],
      ],
      jpeg: [
        ["photo_480", 480, 0.72],
        ["photo_960", 960, 0.78],
        ["photo_1920", 1_920, 0.84],
      ],
    } as const;

    let format: "webp" | "jpeg" = "webp";
    for (let index = 0; index < qualities.webp.length; index += 1) {
      let variant: ProcessedPhotoVariant;
      const [webpKind, webpEdge, webpQuality] = qualities.webp[index];
      try {
        variant = await encode(bitmap, webpKind, webpEdge, "webp", webpQuality);
      } catch {
        format = "jpeg";
        break;
      }
      worker.postMessage({ id, type: "variant", variant } satisfies PhotoWorkerResponse);
    }

    if (format === "jpeg") {
      for (const [kind, maxEdge, quality] of qualities.jpeg) {
        const variant = await encode(bitmap, kind, maxEdge, "jpeg", quality);
        worker.postMessage({ id, type: "variant", variant } satisfies PhotoWorkerResponse);
      }
    }
    worker.postMessage({ id, type: "complete" } satisfies PhotoWorkerResponse);
  } finally {
    bitmap.close();
  }
}

worker.addEventListener("message", (event: MessageEvent<PhotoWorkerRequest>) => {
  void process(event.data.id, event.data.file).catch((error: unknown) => {
    const response: PhotoWorkerResponse = {
      id: event.data.id,
      type: "error",
      message: error instanceof Error ? error.message : "照片处理失败",
    };
    worker.postMessage(response);
  });
});
