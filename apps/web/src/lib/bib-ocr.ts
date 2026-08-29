import type { BibCandidateInput } from "@photostream/contracts";

export const BIB_OCR_ASSET_VERSION = "ppocrv6-tiny-0.4.2-ff6ab415-1e13b227";
const assetBase = `/assets/models/bib-ocr/${BIB_OCR_ASSET_VERSION}`;

interface OcrItem {
  readonly poly: readonly [number, number][];
  readonly text: string;
  readonly score: number;
}

interface OcrResult {
  readonly image: { readonly width: number; readonly height: number };
  readonly items: readonly OcrItem[];
}

interface OcrRunner {
  predict(input: unknown): Promise<readonly OcrResult[]>;
  dispose(): Promise<void>;
}

let runnerPromise: Promise<OcrRunner> | null = null;
let queueTail: Promise<void> = Promise.resolve();
let runtimePromise: Promise<PhotostreamBibOcrRuntime> | null = null;

function clamped(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function normalizeOcrItems(result: OcrResult): BibCandidateInput[] {
  if (result.image.width <= 0 || result.image.height <= 0) return [];
  return result.items.flatMap((item) => {
    if (item.poly.length !== 4 || !Number.isFinite(item.score)) return [];
    return [
      {
        text: item.text,
        confidence: clamped(item.score),
        quadrilateral: item.poly.map(([x, y]) => ({
          x: clamped(x / result.image.width),
          y: clamped(y / result.image.height),
        })) as BibCandidateInput["quadrilateral"],
        modelVersion: BIB_OCR_ASSET_VERSION,
      },
    ];
  });
}

export function bibOcrSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof Worker !== "undefined" &&
    typeof createImageBitmap === "function"
  );
}

async function createRunner(): Promise<OcrRunner> {
  const runtime = await loadRuntime();
  return runtime.create({
    worker: true,
    textDetectionModelName: "PP-OCRv6_tiny_det",
    textDetectionModelAsset: { url: `${assetBase}/det.tar` },
    textRecognitionModelName: "PP-OCRv6_tiny_rec",
    textRecognitionModelAsset: { url: `${assetBase}/rec.tar` },
    textDetectionBatchSize: 1,
    textRecognitionBatchSize: 4,
    ortOptions: {
      backend: "auto",
      wasmPaths: `${assetBase}/ort/`,
      numThreads: globalThis.crossOriginIsolated
        ? Math.max(1, Math.min(2, navigator.hardwareConcurrency || 1))
        : 1,
      simd: true,
      proxy: false,
    },
  }) as Promise<OcrRunner>;
}

function loadRuntime(): Promise<PhotostreamBibOcrRuntime> {
  if (runtimePromise !== null) return runtimePromise;
  const pending = new Promise<PhotostreamBibOcrRuntime>((resolve, reject) => {
    if (globalThis.__photostreamBibOcrRuntime !== undefined) {
      resolve(globalThis.__photostreamBibOcrRuntime);
      return;
    }
    const script = document.createElement("script");
    script.type = "module";
    script.src = `${assetBase}/sdk/runtime.mjs`;
    script.addEventListener(
      "load",
      () => {
        if (globalThis.__photostreamBibOcrRuntime === undefined) {
          reject(new Error("OCR runtime 加载后未注册"));
          return;
        }
        resolve(globalThis.__photostreamBibOcrRuntime);
      },
      { once: true },
    );
    script.addEventListener("error", () => reject(new Error("OCR runtime 加载失败")), {
      once: true,
    });
    document.head.append(script);
  });
  runtimePromise = pending;
  void pending.catch(() => {
    if (runtimePromise === pending) runtimePromise = null;
  });
  return pending;
}

async function runner(): Promise<OcrRunner> {
  if (runnerPromise !== null) return runnerPromise;
  const pending = createRunner();
  runnerPromise = pending;
  void pending.catch(() => {
    if (runnerPromise === pending) runnerPromise = null;
  });
  return pending;
}

export async function recognizeBibCandidates(
  image: Blob,
  signal?: AbortSignal,
): Promise<BibCandidateInput[]> {
  let release: () => void = () => undefined;
  const turn = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previous = queueTail;
  queueTail = previous.then(() => turn);
  await previous;
  try {
    if (signal?.aborted) throw new DOMException("OCR 已取消", "AbortError");
    const [result] = await (await runner()).predict(image);
    if (signal?.aborted) throw new DOMException("OCR 已取消", "AbortError");
    return result === undefined ? [] : normalizeOcrItems(result);
  } finally {
    release();
  }
}

export async function disposeBibOcr(): Promise<void> {
  const current = runnerPromise;
  runnerPromise = null;
  const initialized = current === null ? null : await current.catch(() => null);
  if (initialized !== null) await initialized.dispose();
}
