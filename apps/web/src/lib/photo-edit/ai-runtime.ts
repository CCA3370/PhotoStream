import type { PhotoEditRecipe } from "./recipe";
import type { PhotoEditRenderableSource } from "./runtime";

export type PhotoEditAiPhase = "loading-model" | "processing";

interface AiProgress {
  readonly progress: number;
  readonly phase: PhotoEditAiPhase;
}

type AiWorkerResponse =
  | {
      readonly id: string;
      readonly type: "progress";
      readonly progress: number;
      readonly phase: PhotoEditAiPhase;
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
    readonly onProgress?: (progress: AiProgress) => void;
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
        const onMessage = (event: MessageEvent<AiWorkerResponse>) => {
          const message = event.data;
          if (message.id !== id) return;
          if (message.type === "progress") {
            options.onProgress?.({
              progress: message.progress,
              phase: message.phase,
            });
            return;
          }
          if (message.type === "cancelled") {
            finishReject(new DOMException("AI 修复已取消", "AbortError"));
            return;
          }
          if (message.type === "error") {
            finishReject(new Error(message.message));
            return;
          }
          const value = resolveResponse(message);
          if (value !== undefined) finishResolve(value);
        };

        current.addEventListener("message", onMessage);
        current.addEventListener("error", onWorkerError);
        options.signal?.addEventListener("abort", onAbort, { once: true });
        current.postMessage({ ...request, id }, options.transfer ?? []);
      }),
  );
}

export function photoEditAiAvailable(): boolean {
  return typeof Worker !== "undefined" && typeof navigator !== "undefined" && "gpu" in navigator;
}

export function restoreMediaEditPreview(
  source: Blob,
  recipe: PhotoEditRecipe,
  options: {
    readonly signal?: AbortSignal;
    readonly onProgress?: (progress: AiProgress) => void;
  } = {},
): Promise<Blob> {
  return runAiWorker(
    {
      type: "restore",
      mode: "preview",
      source,
      denoiseStrength: recipe.denoiseStrength,
      deblurStrength: recipe.deblurStrength,
    },
    (message) => (message.type === "preview" ? message.blob : undefined),
    options,
  );
}

export function restoreMediaEditFull(
  source: PhotoEditRenderableSource,
  recipe: PhotoEditRecipe,
  options: {
    readonly signal?: AbortSignal;
    readonly onProgress?: (progress: AiProgress) => void;
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
