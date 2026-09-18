import type { PhotoEditAnalysis } from "./analysis";
import type { PhotoEditRecipe } from "./recipe";

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
  | { readonly id: string; readonly type: "intermediate"; readonly bitmap: ImageBitmap }
  | {
      readonly id: string;
      readonly type: "rendered";
      readonly outputs: readonly PhotoEditRenderedOutput[];
    }
  | { readonly id: string; readonly type: "error"; readonly message: string };

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
      options.signal?.removeEventListener("abort", aborted);
    };
    const aborted = () => {
      cleanup();
      reject(new DOMException("修图已取消", "AbortError"));
    };
    options.signal?.addEventListener("abort", aborted, { once: true });
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
  return runWorker(
    { type: "preview", source, recipe },
    (message) => (message.type === "preview" ? message.blob : undefined),
    {
      ...options,
      ...(source instanceof ImageBitmap ? { transfer: [source] } : {}),
    },
  );
}

export function renderMediaEditIntermediate(
  source: PhotoEditRenderableSource,
  recipe: PhotoEditRecipe,
  options: {
    readonly signal?: AbortSignal;
    readonly onProgress?: (progress: number) => void;
  } = {},
): Promise<ImageBitmap> {
  return runWorker(
    { type: "intermediate", source, recipe },
    (message) => (message.type === "intermediate" ? message.bitmap : undefined),
    {
      ...options,
      ...(source instanceof ImageBitmap ? { transfer: [source] } : {}),
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
  return runWorker(
    { type: "render", source, recipe },
    (message) => (message.type === "rendered" ? message.outputs : undefined),
    {
      ...options,
      ...(source instanceof ImageBitmap ? { transfer: [source] } : {}),
    },
  );
}
