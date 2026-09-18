/// <reference lib="webworker" />

import type { InferenceSession } from "onnxruntime-web";

import {
  PHOTO_EDIT_MODEL_ASSET_VERSION,
  PHOTO_EDIT_MODEL_BASE,
  type PhotoEditAiModelSpec,
  type PhotoEditAiOperation,
  photoEditAiModels,
} from "../lib/photo-edit/ai-models";
import {
  createPhotoEditTiles,
  type PhotoEditTile,
  photoEditFeatherWeight,
  reflectPhotoEditIndex,
} from "../lib/photo-edit/ai-tiling";

type RestoreRequest = {
  readonly id: string;
  readonly type: "restore";
  readonly mode: "preview" | "full";
  readonly source: Blob | ImageBitmap;
  readonly denoiseStrength: number;
  readonly deblurStrength: number;
};

type CancelRequest = {
  readonly id: string;
  readonly type: "cancel";
};

type Request = RestoreRequest | CancelRequest;

const scope = self as DedicatedWorkerGlobalScope;
const sessions = new Map<PhotoEditAiOperation, InferenceSession>();
const recoveryAttempts = new Map<PhotoEditAiOperation, number>();
const cancelled = new Set<string>();
let disabledReason: string | null = null;
let ortPromise: Promise<typeof import("onnxruntime-web/webgpu")> | null = null;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(value: number): number {
  const clamped = clamp01(value);
  return clamped * clamped * (3 - 2 * clamped);
}

function previewDimensions(width: number, height: number) {
  const scale = Math.min(1, 960 / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function assertNotCancelled(id: string): void {
  if (cancelled.has(id)) throw new DOMException("AI 修复已取消", "AbortError");
}

async function ortRuntime() {
  if (ortPromise !== null) return ortPromise;
  ortPromise = import("onnxruntime-web/webgpu").then((ort) => {
    ort.env.wasm.wasmPaths = `${PHOTO_EDIT_MODEL_BASE}/ort/`;
    ort.env.wasm.numThreads = 1;
    return ort;
  });
  return ortPromise;
}

async function cachedBytes(options: {
  readonly url: string;
  readonly expectedBytes: number;
  readonly onProgress: (loadedBytes: number) => void;
}): Promise<Uint8Array> {
  const absolute = new URL(options.url, scope.location.origin).toString();
  const cacheName = `photostream-photo-edit-${PHOTO_EDIT_MODEL_ASSET_VERSION}`;
  let cache: Cache | null = null;

  try {
    cache = await caches.open(cacheName);
    const cached = await cache.match(absolute);
    if (cached !== undefined) {
      const bytes = new Uint8Array(await cached.arrayBuffer());
      if (bytes.byteLength === options.expectedBytes) {
        options.onProgress(bytes.byteLength);
        return bytes;
      }
      await cache.delete(absolute).catch(() => false);
    }
  } catch {
    cache = null;
  }

  const response = await fetch(absolute, {
    cache: "force-cache",
    credentials: "same-origin",
  });
  if (!response.ok || response.body === null) {
    throw new Error(`模型资源读取失败（HTTP ${response.status}）`);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loadedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loadedBytes += value.byteLength;
    options.onProgress(loadedBytes);
  }

  if (loadedBytes !== options.expectedBytes) {
    throw new Error(
      `模型资源大小不匹配：期望 ${options.expectedBytes} bytes，实际 ${loadedBytes} bytes`,
    );
  }

  const bytes = new Uint8Array(loadedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  if (cache !== null) {
    try {
      const headers = new Headers(response.headers);
      headers.delete("content-encoding");
      headers.set("content-length", String(bytes.byteLength));
      await cache.put(
        absolute,
        new Response(bytes, {
          status: response.status,
          statusText: response.statusText,
          headers,
        }),
      );
    } catch {
      // Cache API is an optimization only; a successful model download must remain usable.
    }
  }
  return bytes;
}

function releaseSession(operation: PhotoEditAiOperation): void {
  const session = sessions.get(operation);
  if (session === undefined) return;
  sessions.delete(operation);
  try {
    session.release();
  } catch {
    // The worker will rebuild the session on the next attempt.
  }
}

function postModelProgress(options: {
  readonly id: string;
  readonly operation: PhotoEditAiOperation;
  readonly loadedBytes: number;
  readonly totalBytes: number;
}): void {
  scope.postMessage({
    id: options.id,
    type: "progress",
    phase: "downloading-model",
    operation: options.operation,
    progress: options.totalBytes <= 0 ? 0 : Math.min(1, options.loadedBytes / options.totalBytes),
    loadedBytes: options.loadedBytes,
    totalBytes: options.totalBytes,
  });
}

async function createSession(
  spec: PhotoEditAiModelSpec,
  requestId: string,
): Promise<InferenceSession> {
  if (disabledReason !== null) throw new Error(disabledReason);
  if (!("gpu" in navigator)) {
    disabledReason = "当前浏览器或设备不支持 WebGPU，本地 AI 修复不可用。";
    throw new Error(disabledReason);
  }

  const totalBytes = spec.modelBytes + (spec.externalData?.bytes ?? 0);
  let modelLoadedBytes = 0;
  let externalLoadedBytes = 0;
  const report = () =>
    postModelProgress({
      id: requestId,
      operation: spec.operation,
      loadedBytes: modelLoadedBytes + externalLoadedBytes,
      totalBytes,
    });

  report();
  const model = await cachedBytes({
    url: spec.modelUrl,
    expectedBytes: spec.modelBytes,
    onProgress: (loadedBytes) => {
      modelLoadedBytes = loadedBytes;
      report();
    },
  });
  const externalData =
    spec.externalData === null
      ? undefined
      : [
          {
            path: spec.externalData.path,
            data: await cachedBytes({
              url: spec.externalData.url,
              expectedBytes: spec.externalData.bytes,
              onProgress: (loadedBytes) => {
                externalLoadedBytes = loadedBytes;
                report();
              },
            }),
          },
        ];

  scope.postMessage({
    id: requestId,
    type: "progress",
    phase: "initializing-model",
    operation: spec.operation,
    progress: 1,
    loadedBytes: totalBytes,
    totalBytes,
  });

  const ort = await ortRuntime();
  try {
    const session = await ort.InferenceSession.create(model, {
      executionProviders: ["webgpu"],
      graphOptimizationLevel: "all",
      ...(externalData === undefined ? {} : { externalData }),
    } as InferenceSession.SessionOptions);
    sessions.set(spec.operation, session);
    return session;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    disabledReason = `WebGPU AI 模型初始化失败：${message}`;
    throw new Error(disabledReason);
  }
}

async function sessionFor(
  operation: PhotoEditAiOperation,
  requestId?: string,
): Promise<InferenceSession> {
  const existing = sessions.get(operation);
  if (existing !== undefined) return existing;
  if (requestId === undefined) {
    throw new Error("AI 模型尚未初始化");
  }
  return createSession(photoEditAiModels[operation], requestId);
}

interface PreparedTile {
  readonly tensorData: Float32Array;
  readonly area: number;
}

function preparedTile(
  context: OffscreenCanvasRenderingContext2D,
  tile: PhotoEditTile,
  width: number,
  height: number,
): PreparedTile {
  const xMap = new Int32Array(tile.inputSize);
  const yMap = new Int32Array(tile.inputSize);
  let minX = width - 1;
  let maxX = 0;
  let minY = height - 1;
  let maxY = 0;

  for (let index = 0; index < tile.inputSize; index += 1) {
    const x = reflectPhotoEditIndex(tile.inputX + index, width);
    const y = reflectPhotoEditIndex(tile.inputY + index, height);
    xMap[index] = x;
    yMap[index] = y;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

  const rectangle = context.getImageData(minX, minY, maxX - minX + 1, maxY - minY + 1);
  const rectangleWidth = rectangle.width;
  const area = tile.inputSize * tile.inputSize;
  const tensorData = new Float32Array(area * 3);

  for (let y = 0; y < tile.inputSize; y += 1) {
    const sourceY = (yMap[y] ?? minY) - minY;
    for (let x = 0; x < tile.inputSize; x += 1) {
      const sourceX = (xMap[x] ?? minX) - minX;
      const sourceOffset = (sourceY * rectangleWidth + sourceX) * 4;
      const destination = y * tile.inputSize + x;
      tensorData[destination] = (rectangle.data[sourceOffset] ?? 0) / 255;
      tensorData[area + destination] = (rectangle.data[sourceOffset + 1] ?? 0) / 255;
      tensorData[area * 2 + destination] = (rectangle.data[sourceOffset + 2] ?? 0) / 255;
    }
  }

  return { tensorData, area };
}

async function inferTile(
  operation: PhotoEditAiOperation,
  prepared: PreparedTile,
  tileSize: number,
): Promise<Float32Array> {
  const spec = photoEditAiModels[operation];
  const ort = await ortRuntime();
  const session = await sessionFor(operation);
  const inputName = spec.inputName ?? session.inputNames[0];
  const outputName = spec.outputName ?? session.outputNames[0];
  if (inputName === undefined || outputName === undefined) {
    throw new Error(`${spec.id} 缺少 ONNX 输入或输出定义`);
  }

  try {
    const tensor = new ort.Tensor("float32", prepared.tensorData, [1, 3, tileSize, tileSize]);
    const outputs = await session.run({ [inputName]: tensor });
    const output = outputs[outputName];
    if (output === undefined || !(output.data instanceof Float32Array)) {
      throw new Error(`${spec.id} 返回了不支持的输出类型`);
    }
    return output.data;
  } catch (error) {
    releaseSession(operation);
    const attempts = recoveryAttempts.get(operation) ?? 0;
    const message = error instanceof Error ? error.message : String(error);
    if (attempts === 0) {
      recoveryAttempts.set(operation, 1);
      throw new Error(`WebGPU AI 推理中断，模型会话已释放；请重试本次操作：${message}`);
    }
    disabledReason = `WebGPU AI 再次失败，本次页面会话已禁用 AI：${message}`;
    throw new Error(disabledReason);
  }
}

function writeRowSegment(options: {
  readonly destination: OffscreenCanvasRenderingContext2D;
  readonly source: OffscreenCanvasRenderingContext2D;
  readonly rowAccum: Float32Array;
  readonly rowWeights: Float32Array;
  readonly previousCarry: Float32Array | null;
  readonly rowY: number;
  readonly width: number;
  readonly localStart: number;
  readonly count: number;
  readonly topOverlap: number;
}): void {
  const {
    destination,
    source,
    rowAccum,
    rowWeights,
    previousCarry,
    rowY,
    width,
    localStart,
    count,
    topOverlap,
  } = options;
  if (count <= 0) return;

  const rgba = new Uint8ClampedArray(width * count * 4);
  const sourceAlpha = source.getImageData(0, rowY + localStart, width, count).data;

  for (let localY = 0; localY < count; localY += 1) {
    const rowLocalY = localStart + localY;
    const blend =
      previousCarry !== null && rowLocalY < topOverlap
        ? smoothstep((rowLocalY + 0.5) / topOverlap)
        : 1;
    for (let x = 0; x < width; x += 1) {
      const sourceIndex = rowLocalY * width + x;
      const weight = Math.max(0.0001, rowWeights[sourceIndex] ?? 0);
      const previousIndex = (rowLocalY * width + x) * 3;
      const targetIndex = (localY * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const current = (rowAccum[sourceIndex * 3 + channel] ?? 0) / weight;
        const previous =
          previousCarry === null ? current : (previousCarry[previousIndex + channel] ?? current);
        rgba[targetIndex + channel] = Math.round(
          clamp01(previous * (1 - blend) + current * blend) * 255,
        );
      }
      rgba[targetIndex + 3] = sourceAlpha[targetIndex + 3] ?? 255;
    }
  }

  destination.putImageData(new ImageData(rgba, width, count), 0, rowY + localStart);
}

function bottomCarry(options: {
  readonly rowAccum: Float32Array;
  readonly rowWeights: Float32Array;
  readonly width: number;
  readonly rowHeight: number;
  readonly count: number;
}): Float32Array | null {
  const { rowAccum, rowWeights, width, rowHeight, count } = options;
  if (count <= 0) return null;
  const carry = new Float32Array(width * count * 3);
  const start = rowHeight - count;
  for (let y = 0; y < count; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceIndex = (start + y) * width + x;
      const weight = Math.max(0.0001, rowWeights[sourceIndex] ?? 0);
      const targetIndex = (y * width + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        carry[targetIndex + channel] = (rowAccum[sourceIndex * 3 + channel] ?? 0) / weight;
      }
    }
  }
  return carry;
}

async function runOperation(options: {
  readonly id: string;
  readonly source: OffscreenCanvas;
  readonly operation: PhotoEditAiOperation;
  readonly strength: number;
  readonly progressStart: number;
  readonly progressSpan: number;
}): Promise<OffscreenCanvas> {
  const { id, source, operation, strength, progressStart, progressSpan } = options;
  const spec = photoEditAiModels[operation];
  const sourceContext = source.getContext("2d", { alpha: true, willReadFrequently: true });
  if (sourceContext === null) throw new Error("无法读取 AI 修复画布");

  await sessionFor(operation, id);
  assertNotCancelled(id);

  const tiles = createPhotoEditTiles({
    width: source.width,
    height: source.height,
    tileSize: spec.tileSize,
    overlap: spec.overlap,
  });
  const rows = new Map<number, PhotoEditTile[]>();
  for (const tile of tiles) {
    const row = rows.get(tile.contributionY) ?? [];
    row.push(tile);
    rows.set(tile.contributionY, row);
  }

  const destination = new OffscreenCanvas(source.width, source.height);
  const destinationContext = destination.getContext("2d", { alpha: true });
  if (destinationContext === null) throw new Error("无法创建 AI 修复输出画布");

  let completedTiles = 0;
  let previousCarry: Float32Array | null = null;

  for (const [rowY, rowTiles] of [...rows.entries()].sort(([a], [b]) => a - b)) {
    assertNotCancelled(id);
    rowTiles.sort((a, b) => a.contributionX - b.contributionX);
    const rowHeight = Math.max(...rowTiles.map((tile) => tile.contributionHeight));
    const rowAccum = new Float32Array(source.width * rowHeight * 3);
    const rowWeights = new Float32Array(source.width * rowHeight);

    for (const tile of rowTiles) {
      assertNotCancelled(id);
      const prepared = preparedTile(sourceContext, tile, source.width, source.height);
      const restored = await inferTile(operation, prepared, spec.tileSize);
      assertNotCancelled(id);

      for (let y = 0; y < tile.contributionHeight; y += 1) {
        const globalY = tile.contributionY + y;
        if (globalY >= source.height) continue;
        for (let x = 0; x < tile.contributionWidth; x += 1) {
          const globalX = tile.contributionX + x;
          if (globalX >= source.width) continue;
          const tileIndex = (y + tile.cropOffset) * spec.tileSize + (x + tile.cropOffset);
          const rowIndex = y * source.width + globalX;
          const weight = photoEditFeatherWeight({
            local: x,
            start: tile.contributionX,
            size: tile.contributionWidth,
            total: source.width,
            overlap: spec.overlap,
          });
          rowWeights[rowIndex] = (rowWeights[rowIndex] ?? 0) + weight;
          for (let channel = 0; channel < 3; channel += 1) {
            const original = prepared.tensorData[channel * prepared.area + tileIndex] ?? 0;
            const enhanced = restored[channel * prepared.area + tileIndex] ?? original;
            const blended = original * (1 - strength) + clamp01(enhanced) * strength;
            const accumulator = rowIndex * 3 + channel;
            rowAccum[accumulator] = (rowAccum[accumulator] ?? 0) + blended * weight;
          }
        }
      }

      completedTiles += 1;
      scope.postMessage({
        id,
        type: "progress",
        progress: progressStart + (completedTiles / tiles.length) * progressSpan,
        phase: "processing",
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    const topOverlap = rowY === 0 ? 0 : Math.min(spec.overlap, rowHeight);
    const bottomOverlap = rowY + rowHeight >= source.height ? 0 : Math.min(spec.overlap, rowHeight);
    const writeCount = rowHeight - bottomOverlap;

    writeRowSegment({
      destination: destinationContext,
      source: sourceContext,
      rowAccum,
      rowWeights,
      previousCarry,
      rowY,
      width: source.width,
      localStart: 0,
      count: writeCount,
      topOverlap,
    });

    previousCarry = bottomCarry({
      rowAccum,
      rowWeights,
      width: source.width,
      rowHeight,
      count: bottomOverlap,
    });
  }

  return destination;
}

async function bitmapFromSource(source: Blob | ImageBitmap): Promise<ImageBitmap> {
  return source instanceof Blob ? createImageBitmap(source) : source;
}

async function restore(request: RestoreRequest): Promise<void> {
  if (disabledReason !== null) throw new Error(disabledReason);
  assertNotCancelled(request.id);

  const sourceBitmap = await bitmapFromSource(request.source);
  try {
    const size =
      request.mode === "preview"
        ? previewDimensions(sourceBitmap.width, sourceBitmap.height)
        : { width: sourceBitmap.width, height: sourceBitmap.height };
    let current = new OffscreenCanvas(size.width, size.height);
    const context = current.getContext("2d", { alpha: true });
    if (context === null) throw new Error("无法创建本地 AI 画布");
    context.drawImage(sourceBitmap, 0, 0, size.width, size.height);

    const operations = [
      ["denoise", clamp01(request.denoiseStrength)],
      ["deblur", Math.min(0.6, clamp01(request.deblurStrength))],
    ] as const;
    const enabled = operations.filter(([, strength]) => strength > 0);
    if (enabled.length === 0) {
      if (request.mode === "preview") {
        const blob = await current.convertToBlob({ type: "image/webp", quality: 0.9 });
        scope.postMessage({ id: request.id, type: "preview", blob });
      } else {
        const bitmap = current.transferToImageBitmap();
        scope.postMessage({ id: request.id, type: "full", bitmap }, [bitmap]);
      }
      return;
    }

    for (let index = 0; index < enabled.length; index += 1) {
      const selected = enabled[index];
      if (selected === undefined) continue;
      const [operation, strength] = selected;
      current = await runOperation({
        id: request.id,
        source: current,
        operation,
        strength,
        progressStart: index / enabled.length,
        progressSpan: 1 / enabled.length,
      });
    }

    assertNotCancelled(request.id);
    if (request.mode === "preview") {
      const blob = await current.convertToBlob({ type: "image/webp", quality: 0.9 });
      scope.postMessage({ id: request.id, type: "preview", blob });
    } else {
      const bitmap = current.transferToImageBitmap();
      scope.postMessage({ id: request.id, type: "full", bitmap }, [bitmap]);
    }
  } finally {
    sourceBitmap.close();
  }
}

scope.addEventListener("message", (event: MessageEvent<Request>) => {
  const request = event.data;
  if (request.type === "cancel") {
    cancelled.add(request.id);
    return;
  }

  cancelled.delete(request.id);
  void restore(request)
    .then(() => {
      cancelled.delete(request.id);
    })
    .catch((error: unknown) => {
      const wasCancelled = cancelled.has(request.id) || error instanceof DOMException;
      cancelled.delete(request.id);
      if (wasCancelled) {
        scope.postMessage({ id: request.id, type: "cancelled" });
        return;
      }
      scope.postMessage({
        id: request.id,
        type: "error",
        message: error instanceof Error ? error.message : "本地 AI 修复失败",
      });
    });
});
