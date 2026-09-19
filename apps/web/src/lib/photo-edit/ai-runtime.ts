import type { PhotoEditRecipe } from "./recipe";
import type { PhotoEditRenderableSource } from "./runtime";

export type PhotoEditAiPhase = "downloading-model" | "initializing-model" | "processing";

export interface PhotoEditAiProgress {
  readonly progress: number;
  readonly phase: PhotoEditAiPhase;
  readonly operation?: "denoise" | "deblur";
  readonly loadedBytes?: number;
  readonly totalBytes?: number;
}

type AiWorkerResponse =
  | {
      readonly id: string;
      readonly type: "progress";
      readonly progress: number;
      readonly phase: PhotoEditAiPhase;
      readonly operation?: "denoise" | "deblur";
      readonly loadedBytes?: number;
      readonly totalBytes?: number;
    }
  | { readonly id: string; readonly type: "preview"; readonly blob: Blob }
  | { readonly id: string; readonly type: "full"; readonly bitmap: ImageBitmap }
  | { readonly id: string; readonly type: "cancelled" }
  | { readonly id: string; readonly type: "error"; readonly message: string };

let worker: Worker | null = null;
let queue: Promise<void> = Promise.resolve();

function aiWorker(): Worker {
  if (worker !== null) return worker;
  worker = new Worker(new URL("../../workers/photo-edit-ai.worker.ts", import.meta.url), {
    type: "module",
  });
  return worker;
}

function resetWorker(): void {
  worker?.terminate();
  worker = null;
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task, task);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function runAiWorker<T>(
  request: object,
  resolveResponse: (message: AiWorkerResponse) => T | undefined,
  options: {
    readonly signal?: AbortSignal;
    readonly transfer?: Transferable[];
    readonly onProgress?: (progress: PhotoEditAiProgress) => void;
  } = {},
): Promise<T> {
  return enqueue(
    () =>
      new Promise<T>((resolve, reject) => {
        if (options.signal?.aborted) {
          reject(new DOMException("AI 修复已取消", "AbortError"));
          return;
        }

        const current = aiWorker();
        const id = crypto.randomUUID();
        let settled = false;

        const cleanup = () => {
          current.removeEventListener("message", onMessage);
          current.removeEventListener("error", onWorkerError);
          current.removeEventListener("messageerror", onWorkerMessageError);
          options.signal?.removeEventListener("abort", onAbort);
        };
        const finishReject = (error: unknown) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        };
        const finishResolve = (value: T) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(value);
        };
        const onAbort = () => {
          current.postMessage({ type: "cancel", id });
        };
        const onWorkerError = (event: ErrorEvent) => {
          resetWorker();
          finishReject(new Error(event.message || "本地 AI Worker 失败"));
        };
        const onWorkerMessageError = () => {
          resetWorker();
          finishReject(new Error("本地 AI Worker 数据传输失败"));
        };
        const onMessage = (event: MessageEvent<AiWorkerResponse>) => {
          const message = event.data;
          if (message.id !== id) return;
          if (message.type === "progress") {
            options.onProgress?.({
              progress: message.progress,
              phase: message.phase,
              ...(message.operation === undefined ? {} : { operation: message.operation }),
              ...(message.loadedBytes === undefined ? {} : { loadedBytes: message.loadedBytes }),
              ...(message.totalBytes === undefined ? {} : { totalBytes: message.totalBytes }),
            });
            return;
          }
          if (message.type === "cancelled") {
            finishReject(new DOMException("AI 修复已取消", "AbortError"));
            return;
          }
          if (message.type === "error") {
            resetWorker();
            finishReject(new Error(message.message));
            return;
          }
          const value = resolveResponse(message);
          if (value !== undefined) finishResolve(value);
        };

        current.addEventListener("message", onMessage);
        current.addEventListener("error", onWorkerError);
        current.addEventListener("messageerror", onWorkerMessageError);
        options.signal?.addEventListener("abort", onAbort, { once: true });
        current.postMessage({ ...request, id }, options.transfer ?? []);
      }),
  );
}

export function photoEditAiAvailable(): boolean {
  return (
    typeof Worker !== "undefined" &&
    typeof createImageBitmap === "function" &&
    typeof OffscreenCanvas !== "undefined"
  );
}

export async function restoreMediaEditPreview(
  source: Blob,
  recipe: PhotoEditRecipe,
  options: {
    readonly signal?: AbortSignal;
    readonly onProgress?: (progress: PhotoEditAiProgress) => void;
  } = {},
): Promise<Blob> {
  const request = {
    type: "restore",
    mode: "preview",
    source,
    denoiseStrength: recipe.denoiseStrength,
    deblurStrength: recipe.deblurStrength,
  };
  const run = () =>
    runAiWorker(
      request,
      (message) => (message.type === "preview" ? message.blob : undefined),
      options,
    );

  try {
    return await run();
  } catch (error) {
    if (options.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw error;
    }
    // A WebGPU device/session can be lost transiently. The worker is reset on
    // runtime errors; retry the lightweight preview once in a fresh worker.
    return run();
  }
}

export function restoreMediaEditFull(
  source: PhotoEditRenderableSource,
  recipe: PhotoEditRecipe,
  options: {
    readonly signal?: AbortSignal;
    readonly onProgress?: (progress: PhotoEditAiProgress) => void;
  } = {},
): Promise<ImageBitmap> {
  return runAiWorker(
    {
      type: "restore",
      mode: "full",
      source,
      denoiseStrength: recipe.denoiseStrength,
      deblurStrength: recipe.deblurStrength,
    },
    (message) => (message.type === "full" ? message.bitmap : undefined),
    {
      ...options,
      ...(source instanceof ImageBitmap ? { transfer: [source] } : {}),
    },
  );
}
