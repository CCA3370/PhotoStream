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

async function encodeAll(
  bitmap: ImageBitmap,
  format: "webp" | "jpeg",
): Promise<ProcessedPhotoVariant[]> {
  const qualities =
    format === "webp"
      ? ([
          ["photo_480", 480, 0.7],
          ["photo_960", 960, 0.76],
          ["photo_1920", 1_920, 0.82],
        ] as const)
      : ([
          ["photo_480", 480, 0.72],
          ["photo_960", 960, 0.78],
          ["photo_1920", 1_920, 0.84],
        ] as const);
  const output: ProcessedPhotoVariant[] = [];
  for (const [kind, maxEdge, quality] of qualities) {
    output.push(await encode(bitmap, kind, maxEdge, format, quality));
  }
  return output;
}

async function process(file: File) {
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
    let variants: ProcessedPhotoVariant[];
    try {
      variants = await encodeAll(bitmap, "webp");
    } catch {
      variants = await encodeAll(bitmap, "jpeg");
    }
    return {
      width: bitmap.width,
      height: bitmap.height,
      originalFormat: detected.format,
      originalContentType: detected.contentType,
      capturedAt: detected.capturedAt,
      variants,
    };
  } finally {
    bitmap.close();
  }
}

worker.addEventListener("message", (event: MessageEvent<PhotoWorkerRequest>) => {
  void process(event.data.file)
    .then((photo) => {
      const response: PhotoWorkerResponse = { id: event.data.id, ok: true, photo };
      worker.postMessage(response);
    })
    .catch((error: unknown) => {
      const response: PhotoWorkerResponse = {
        id: event.data.id,
        ok: false,
        message: error instanceof Error ? error.message : "照片处理失败",
      };
      worker.postMessage(response);
    });
});
