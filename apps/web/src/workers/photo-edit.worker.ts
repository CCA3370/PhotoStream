/// <reference lib="webworker" />

import { analyzePhotoPixels } from "../lib/photo-edit/analysis";
import type { PhotoEditRecipe } from "../lib/photo-edit/recipe";
import { applyPhotoEditRecipeToPixels } from "../lib/photo-edit/renderer";

type Request =
  | { readonly id: string; readonly type: "analyze"; readonly source: Blob }
  | {
      readonly id: string;
      readonly type: "preview";
      readonly source: Blob | ImageBitmap;
      readonly recipe: PhotoEditRecipe;
    }
  | {
      readonly id: string;
      readonly type: "intermediate";
      readonly source: Blob | ImageBitmap;
      readonly recipe: PhotoEditRecipe;
    }
  | {
      readonly id: string;
      readonly type: "render";
      readonly source: Blob | ImageBitmap;
      readonly recipe: PhotoEditRecipe;
    };

const scope = self as DedicatedWorkerGlobalScope;
const stripeRows = 256;

async function sourceBitmap(source: Blob | ImageBitmap): Promise<ImageBitmap> {
  return source instanceof Blob ? createImageBitmap(source) : source;
}

function sourceIsJpeg(source: Blob | ImageBitmap): boolean {
  return source instanceof Blob && source.type === "image/jpeg";
}

function dimensions(width: number, height: number, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function encoded(
  canvas: OffscreenCanvas,
  preferred: "webp" | "jpeg",
  quality: number,
): Promise<{ blob: Blob; format: "webp" | "jpeg"; contentType: "image/webp" | "image/jpeg" }> {
  const preferredType = preferred === "webp" ? "image/webp" : "image/jpeg";
  try {
    const blob = await canvas.convertToBlob({ type: preferredType, quality });
    if (blob.size > 0 && blob.type === preferredType) {
      return { blob, format: preferred, contentType: preferredType };
    }
  } catch {
    // Use JPEG fallback below.
  }
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: Math.min(0.96, quality) });
  if (blob.size === 0 || blob.type !== "image/jpeg") throw new Error("修图结果编码失败");
  return { blob, format: "jpeg", contentType: "image/jpeg" };
}

async function analyze(id: string, source: Blob): Promise<void> {
  const bitmap = await sourceBitmap(source);
  try {
    const size = dimensions(bitmap.width, bitmap.height, 768);
    const canvas = new OffscreenCanvas(size.width, size.height);
    const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
    if (context === null) throw new Error("浏览器无法创建修图分析画布");
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const pixels = context.getImageData(0, 0, size.width, size.height);
    scope.postMessage({
      id,
      type: "analysis",
      analysis: analyzePhotoPixels({
        data: pixels.data,
        width: pixels.width,
        height: pixels.height,
      }),
    });
  } finally {
    bitmap.close();
  }
}

function processStripe(
  context: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  startY: number,
  recipe: PhotoEditRecipe,
): void {
  const outputRows = Math.min(stripeRows, height - startY);
  const sourceY = Math.max(0, startY - 1);
  const sourceEnd = Math.min(height, startY + outputRows + 1);
  const rows = sourceEnd - sourceY;
  const pixels = context.getImageData(0, sourceY, width, rows);
  applyPhotoEditRecipeToPixels(
    { data: pixels.data, width: pixels.width, height: pixels.height },
    recipe,
  );
  const centerOffset = startY - sourceY;
  context.putImageData(pixels, 0, sourceY, 0, centerOffset, width, outputRows);
}

async function preview(
  id: string,
  source: Blob | ImageBitmap,
  recipe: PhotoEditRecipe,
): Promise<void> {
  const bitmap = await sourceBitmap(source);
  try {
    const size = dimensions(bitmap.width, bitmap.height, 960);
    const canvas = new OffscreenCanvas(size.width, size.height);
    const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
    if (context === null) throw new Error("浏览器无法创建修图预览画布");
    if (sourceIsJpeg(source)) {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, size.width, size.height);
    }
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const pixels = context.getImageData(0, 0, size.width, size.height);
    applyPhotoEditRecipeToPixels(
      { data: pixels.data, width: pixels.width, height: pixels.height },
      recipe,
    );
    context.putImageData(pixels, 0, 0);
    const result = await encoded(canvas, "webp", 0.84);
    scope.postMessage({ id, type: "preview", blob: result.blob });
  } finally {
    bitmap.close();
  }
}

async function intermediate(
  id: string,
  source: Blob | ImageBitmap,
  recipe: PhotoEditRecipe,
): Promise<void> {
  const bitmap = await sourceBitmap(source);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
    if (context === null) throw new Error("浏览器无法创建修图中间画布");
    if (sourceIsJpeg(source)) {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, bitmap.width, bitmap.height);
    }
    context.drawImage(bitmap, 0, 0);
    const stripeCount = Math.ceil(bitmap.height / stripeRows);
    for (let stripe = 0; stripe < stripeCount; stripe += 1) {
      processStripe(context, bitmap.width, bitmap.height, stripe * stripeRows, recipe);
      scope.postMessage({
        id,
        type: "progress",
        progress: (stripe + 1) / stripeCount,
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    const result = canvas.transferToImageBitmap();
    scope.postMessage({ id, type: "intermediate", bitmap: result }, [result]);
  } finally {
    bitmap.close();
  }
}

async function render(
  id: string,
  source: Blob | ImageBitmap,
  recipe: PhotoEditRecipe,
): Promise<void> {
  const bitmap = await createImageBitmap(source);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
    if (context === null) throw new Error("浏览器无法创建修图导出画布");
    if (sourceIsJpeg(source)) {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, bitmap.width, bitmap.height);
    }
    context.drawImage(bitmap, 0, 0);

    const stripeCount = Math.ceil(bitmap.height / stripeRows);
    for (let stripe = 0; stripe < stripeCount; stripe += 1) {
      processStripe(context, bitmap.width, bitmap.height, stripe * stripeRows, recipe);
      scope.postMessage({
        id,
        type: "progress",
        progress: Math.min(0.72, ((stripe + 1) / stripeCount) * 0.72),
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    const fullFormat = sourceIsJpeg(source) ? "jpeg" : "webp";
    const full = await encoded(canvas, fullFormat, fullFormat === "jpeg" ? 0.95 : 0.94);
    const outputs: Array<{
      kind: "photo_480" | "photo_960" | "photo_1920" | "photo_download";
      blob: Blob;
      format: "webp" | "jpeg";
      contentType: "image/webp" | "image/jpeg";
      width: number;
      height: number;
    }> = [
      {
        kind: "photo_download",
        ...full,
        width: bitmap.width,
        height: bitmap.height,
      },
    ];
    scope.postMessage({ id, type: "progress", progress: 0.8 });

    const specs = [
      ["photo_1920", 1_920, 0.86],
      ["photo_960", 960, 0.8],
      ["photo_480", 480, 0.74],
    ] as const;
    for (let index = 0; index < specs.length; index += 1) {
      const [kind, maxEdge, quality] = specs[index] ?? specs[0];
      const size = dimensions(bitmap.width, bitmap.height, maxEdge);
      const derived = new OffscreenCanvas(size.width, size.height);
      const derivedContext = derived.getContext("2d", { alpha: true });
      if (derivedContext === null) throw new Error("浏览器无法创建修图派生画布");
      derivedContext.drawImage(canvas, 0, 0, size.width, size.height);
      const encodedVariant = await encoded(derived, "webp", quality);
      outputs.push({
        kind,
        ...encodedVariant,
        width: size.width,
        height: size.height,
      });
      scope.postMessage({
        id,
        type: "progress",
        progress: 0.8 + ((index + 1) / specs.length) * 0.2,
      });
    }

    scope.postMessage({ id, type: "rendered", outputs });
  } finally {
    bitmap.close();
  }
}

scope.addEventListener("message", (event: MessageEvent<Request>) => {
  const request = event.data;
  const task =
    request.type === "analyze"
      ? analyze(request.id, request.source)
      : request.type === "preview"
        ? preview(request.id, request.source, request.recipe)
        : request.type === "intermediate"
          ? intermediate(request.id, request.source, request.recipe)
          : render(request.id, request.source, request.recipe);
  void task.catch((error: unknown) => {
    scope.postMessage({
      id: request.id,
      type: "error",
      message: error instanceof Error ? error.message : "照片处理失败",
    });
  });
});
