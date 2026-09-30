import { isAppleMobileWebKit, isAppleWebKit } from "../apple-webkit";
import { analyzePhotoPixels, type PhotoEditAnalysis } from "./analysis";
import type { PhotoEditRecipe } from "./recipe";
import { applyPhotoEditRecipeToPixels } from "./renderer";

export type PhotoEditOutputKind = "photo_480" | "photo_960" | "photo_1920" | "photo_download";

export type PhotoEditRenderableSource = Blob | ImageBitmap;

export interface PhotoEditRenderedOutput {
  readonly kind: PhotoEditOutputKind;
  readonly blob: Blob;
  readonly format: "webp" | "jpeg";
  readonly contentType: "image/webp" | "image/jpeg";
  readonly width: number;
  readonly height: number;
}

type WorkerResponse =
  | { readonly id: string; readonly type: "analysis"; readonly analysis: PhotoEditAnalysis }
  | { readonly id: string; readonly type: "progress"; readonly progress: number }
  | { readonly id: string; readonly type: "preview"; readonly blob: Blob }
  | {
      readonly id: string;
      readonly type: "rendered";
      readonly outputs: readonly PhotoEditRenderedOutput[];
    }
  | { readonly id: string; readonly type: "error"; readonly message: string };

interface DecodedSource {
  readonly width: number;
  readonly height: number;
  readonly jpeg: boolean;
  draw(context: CanvasRenderingContext2D, width: number, height: number): void;
  close(): void;
}

const stripeRows = 256;

function isImageBitmapSource(source: PhotoEditRenderableSource): source is ImageBitmap {
  return typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap;
}

function shouldUseMainThreadFallback(): boolean {
  return (
    isAppleWebKit() ||
    typeof Worker === "undefined" ||
    typeof OffscreenCanvas === "undefined" ||
    typeof createImageBitmap !== "function"
  );
}

function aborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw new DOMException("修图已取消", "AbortError");
}

function dimensions(width: number, height: number, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function safariRenderDimensions(width: number, height: number) {
  if (!isAppleWebKit()) return { width, height };
  return dimensions(width, height, isAppleMobileWebKit() ? 4_096 : 6_144);
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

async function decodeSource(
  source: PhotoEditRenderableSource,
  signal?: AbortSignal,
): Promise<DecodedSource> {
  aborted(signal);
  if (isImageBitmapSource(source)) {
    return {
      width: source.width,
      height: source.height,
      jpeg: false,
      draw: (context, width, height) => context.drawImage(source, 0, 0, width, height),
      close: () => source.close(),
    };
  }

  const url = URL.createObjectURL(source);
  const image = new Image();
  image.decoding = "async";
  const loaded = new Promise<void>((resolve, reject) => {
    image.addEventListener("load", () => resolve(), { once: true });
    image.addEventListener("error", () => reject(new Error("Safari 无法解码修图源")), {
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
      throw new Error("修图源尺寸无效");
    }
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      jpeg: source.type === "image/jpeg",
      draw: (context, width, height) => context.drawImage(image, 0, 0, width, height),
      close: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
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

async function encoded(
  canvas: HTMLCanvasElement,
  preferred: "webp" | "jpeg",
  quality: number,
): Promise<{
  readonly blob: Blob;
  readonly format: "webp" | "jpeg";
  readonly contentType: "image/webp" | "image/jpeg";
}> {
  const preferredType = preferred === "webp" ? "image/webp" : "image/jpeg";
  try {
    const blob = await canvasBlob(canvas, preferredType, quality);
    return { blob, format: preferred, contentType: preferredType };
  } catch {
    const blob = await canvasBlob(canvas, "image/jpeg", Math.min(0.96, quality));
    return { blob, format: "jpeg", contentType: "image/jpeg" };
  }
}

function processStripe(
  context: CanvasRenderingContext2D,
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

async function analyzeOnMainThread(
  source: Blob,
  options: { readonly signal?: AbortSignal } = {},
): Promise<PhotoEditAnalysis> {
  const decoded = await decodeSource(source, options.signal);
  const canvas = document.createElement("canvas");
  try {
    const size = dimensions(decoded.width, decoded.height, 768);
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
    if (context === null) throw new Error("Safari 无法创建修图分析画布");
    decoded.draw(context, size.width, size.height);
    aborted(options.signal);
    const pixels = context.getImageData(0, 0, size.width, size.height);
    return analyzePhotoPixels({ data: pixels.data, width: pixels.width, height: pixels.height });
  } finally {
    decoded.close();
    canvas.width = 1;
    canvas.height = 1;
  }
}

async function previewOnMainThread(
  source: PhotoEditRenderableSource,
  recipe: PhotoEditRecipe,
  options: { readonly signal?: AbortSignal } = {},
): Promise<Blob> {
  const decoded = await decodeSource(source, options.signal);
  const canvas = document.createElement("canvas");
  try {
    const size = dimensions(decoded.width, decoded.height, 960);
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
    if (context === null) throw new Error("Safari 无法创建修图预览画布");
    if (decoded.jpeg) {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, size.width, size.height);
    }
    decoded.draw(context, size.width, size.height);
    aborted(options.signal);
    const pixels = context.getImageData(0, 0, size.width, size.height);
    applyPhotoEditRecipeToPixels(
      { data: pixels.data, width: pixels.width, height: pixels.height },
      recipe,
    );
    context.putImageData(pixels, 0, 0);
    aborted(options.signal);
    return (await encoded(canvas, "webp", 0.84)).blob;
  } finally {
    decoded.close();
    canvas.width = 1;
    canvas.height = 1;
  }
}

async function renderOnMainThread(
  source: PhotoEditRenderableSource,
  recipe: PhotoEditRecipe,
  options: {
    readonly signal?: AbortSignal;
    readonly onProgress?: (progress: number) => void;
  } = {},
): Promise<readonly PhotoEditRenderedOutput[]> {
  const decoded = await decodeSource(source, options.signal);
  const canvas = document.createElement("canvas");
  try {
    const target = safariRenderDimensions(decoded.width, decoded.height);
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
    if (context === null) throw new Error("Safari 无法创建修图导出画布");
    if (decoded.jpeg) {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, target.width, target.height);
    }
    decoded.draw(context, target.width, target.height);

    const stripeCount = Math.ceil(target.height / stripeRows);
    for (let stripe = 0; stripe < stripeCount; stripe += 1) {
      aborted(options.signal);
      processStripe(context, target.width, target.height, stripe * stripeRows, recipe);
      options.onProgress?.(Math.min(0.72, ((stripe + 1) / stripeCount) * 0.72));
      await yieldToBrowser();
    }

    aborted(options.signal);
    const fullFormat = decoded.jpeg ? "jpeg" : "webp";
    const full = await encoded(canvas, fullFormat, fullFormat === "jpeg" ? 0.95 : 0.94);
    const outputs: PhotoEditRenderedOutput[] = [
      {
        kind: "photo_download",
        ...full,
        width: target.width,
        height: target.height,
      },
    ];
    options.onProgress?.(0.8);

    const specs = [
      ["photo_1920", 1_920, 0.86],
      ["photo_960", 960, 0.8],
      ["photo_480", 480, 0.74],
    ] as const;
    for (let index = 0; index < specs.length; index += 1) {
      aborted(options.signal);
      const [kind, maxEdge, quality] = specs[index] ?? specs[0];
      const size = dimensions(target.width, target.height, maxEdge);
      const derived = document.createElement("canvas");
      derived.width = size.width;
      derived.height = size.height;
      try {
        const derivedContext = derived.getContext("2d", { alpha: true });
        if (derivedContext === null) throw new Error("Safari 无法创建修图派生画布");
        derivedContext.drawImage(canvas, 0, 0, size.width, size.height);
        const encodedVariant = await encoded(derived, "webp", quality);
        outputs.push({
          kind,
          ...encodedVariant,
          width: size.width,
          height: size.height,
        });
      } finally {
        derived.width = 1;
        derived.height = 1;
      }
      options.onProgress?.(0.8 + ((index + 1) / specs.length) * 0.2);
      await yieldToBrowser();
    }
    return outputs;
  } finally {
    decoded.close();
    canvas.width = 1;
    canvas.height = 1;
  }
}

function createWorker(): Worker {
  return new Worker(new URL("../../workers/photo-edit.worker.ts", import.meta.url), {
    type: "module",
  });
}

function runWorker<T>(
  request: object,
  resolveResponse: (message: WorkerResponse) => T | undefined,
  options: {
    readonly signal?: AbortSignal;
    readonly onProgress?: (progress: number) => void;
    readonly transfer?: Transferable[];
  } = {},
): Promise<T> {
  const worker = createWorker();
  const id = crypto.randomUUID();
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      worker.terminate();
      options.signal?.removeEventListener("abort", abortedHandler);
    };
    const abortedHandler = () => {
      cleanup();
      reject(new DOMException("修图已取消", "AbortError"));
    };
    options.signal?.addEventListener("abort", abortedHandler, { once: true });
    worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.id !== id) return;
      if (message.type === "progress") {
        options.onProgress?.(message.progress);
        return;
      }
      if (message.type === "error") {
        cleanup();
        reject(new Error(message.message));
        return;
      }
      const value = resolveResponse(message);
      if (value === undefined) return;
      cleanup();
      resolve(value);
    });
    worker.addEventListener("error", (event) => {
      cleanup();
      reject(new Error(event.message || "照片处理 Worker 失败"));
    });
    worker.postMessage({ ...request, id }, options.transfer ?? []);
  });
}

export function analyzeMediaEditSource(
  source: Blob,
  options: { readonly signal?: AbortSignal } = {},
): Promise<PhotoEditAnalysis> {
  if (shouldUseMainThreadFallback()) return analyzeOnMainThread(source, options);
  return runWorker(
    { type: "analyze", source },
    (message) => (message.type === "analysis" ? message.analysis : undefined),
    options,
  );
}

export function renderMediaEditPreview(
  source: PhotoEditRenderableSource,
  recipe: PhotoEditRecipe,
  options: { readonly signal?: AbortSignal } = {},
): Promise<Blob> {
  if (shouldUseMainThreadFallback()) return previewOnMainThread(source, recipe, options);
  return runWorker(
    { type: "preview", source, recipe },
    (message) => (message.type === "preview" ? message.blob : undefined),
    {
      ...options,
      ...(isImageBitmapSource(source) ? { transfer: [source] } : {}),
    },
  );
}

export function renderMediaEditOutputs(
  source: PhotoEditRenderableSource,
  recipe: PhotoEditRecipe,
  options: {
    readonly signal?: AbortSignal;
    readonly onProgress?: (progress: number) => void;
  } = {},
): Promise<readonly PhotoEditRenderedOutput[]> {
  if (shouldUseMainThreadFallback()) return renderOnMainThread(source, recipe, options);
  return runWorker(
    { type: "render", source, recipe },
    (message) => (message.type === "rendered" ? message.outputs : undefined),
    {
      ...options,
      ...(isImageBitmapSource(source) ? { transfer: [source] } : {}),
    },
  );
}
