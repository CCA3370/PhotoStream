"use client";

import type { BibConfigView, UploadIntentView } from "@photostream/contracts";

import { clientMutation } from "@/lib/client-api";
import { startLocalBibOcr } from "@/lib/local-bib-ocr";
import {
  createLocalReviewPhoto,
  deleteLocalReviewPhoto,
  getLocalReviewPhoto,
  listLocalReviewPhotos,
  patchLocalReviewPhoto,
  putLocalReviewPhoto,
  updateLocalReviewPhoto,
} from "@/lib/local-review-queue";
import { syncLocalPhotoEditDraft } from "@/lib/photo-edit/local-draft-sync";
import { deleteLocalPhotoEditDraft, getLocalPhotoEditDraft } from "@/lib/photo-edit/local-drafts";
import { type ProcessedPhotoMetadata, processPhotoInWorkerStreaming } from "@/lib/photo-processing";
import {
  createProgressiveUpload,
  registerAndUploadProgressiveVariant,
  uploadProgressiveMicroPreview,
  uploadProgressiveOriginal,
} from "@/lib/progressive-photo-upload";
import { type PreparedUploadInput, sha256Blob } from "@/lib/upload-input";

export type LocalProcessingTaskStatus = "queued" | "processing" | "staged" | "failed" | "cancelled";

export interface LocalProcessingTaskView {
  readonly id: string;
  readonly fileName: string;
  readonly bytes: number;
  readonly uploadedBytes: number;
  readonly totalUploadBytes: number;
  readonly bytesPerSecond: number;
  readonly status: LocalProcessingTaskStatus;
  readonly error: string | null;
}

export interface LocalProcessingSnapshot {
  readonly tasks: readonly LocalProcessingTaskView[];
  readonly paused: boolean;
}

type PersistedProcessingStatus = Exclude<LocalProcessingTaskStatus, "staged" | "cancelled">;

interface ProcessingTask {
  readonly id: string;
  readonly albumId: string;
  readonly localPhotoId: string;
  readonly file: File;
  readonly sourceFileName: string;
  readonly sourceHash: string;
  readonly allowDuplicate: boolean;
  readonly categoryId: string | null;
  readonly createdAt: string;
  status: LocalProcessingTaskStatus;
  error: string | null;
  uploadedBytes: number;
  totalUploadBytes: number;
  uploadStartedAt: number | null;
}

interface PersistedProcessingTask extends Omit<ProcessingTask, "status"> {
  readonly status: PersistedProcessingStatus;
}

interface AdaptiveProcessingProfile {
  readonly initial: number;
  readonly max: number;
  readonly inputByteBudget: number;
}

interface NavigatorWithDeviceMemory extends Navigator {
  readonly deviceMemory?: number;
}

interface PerformanceMemorySnapshot {
  readonly jsHeapSizeLimit: number;
  readonly usedJSHeapSize: number;
}

interface PerformanceWithMemory extends Performance {
  readonly memory?: PerformanceMemorySnapshot;
}

const databaseName = "photostream-local-processing";
const storeName = "tasks";
const databaseVersion = 1;
const mebibyte = 1024 ** 2;
const adaptiveSampleIntervalMs = 2_000;
const eventLoopPressureMs = 180;
const eventLoopHealthyMs = 60;
const heapPressureThreshold = 0.82;
const heapHealthyThreshold = 0.68;
const defaultProcessingProfile: AdaptiveProcessingProfile = {
  initial: 3,
  max: 4,
  inputByteBudget: 96 * mebibyte,
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function adaptiveProcessingProfile(): AdaptiveProcessingProfile {
  if (typeof navigator === "undefined") return defaultProcessingProfile;

  const cores = Math.max(1, navigator.hardwareConcurrency || 4);
  const memoryGb = (navigator as NavigatorWithDeviceMemory).deviceMemory;
  const likelyMobile =
    typeof window !== "undefined" &&
    window.matchMedia("(pointer: coarse)").matches &&
    Math.min(window.screen.width, window.screen.height) < 900;
  const platformMax = likelyMobile ? 4 : 8;

  const cpuInitial =
    cores <= 2 ? 1 : cores <= 4 ? 2 : cores <= 6 ? 3 : cores <= 8 ? 4 : cores <= 12 ? 5 : 6;
  const cpuMax = clamp(Math.ceil(cores * 0.75), 1, platformMax);
  const memoryMax =
    memoryGb === undefined
      ? platformMax
      : memoryGb <= 2
        ? 1
        : memoryGb <= 4
          ? 2
          : memoryGb <= 8
            ? 5
            : memoryGb <= 16
              ? 7
              : platformMax;
  const max = clamp(Math.min(platformMax, cpuMax, memoryMax), 1, platformMax);
  const initial = clamp(Math.min(cpuInitial, max), 1, max);
  const inputByteBudget = clamp(
    Math.round((memoryGb ?? 8) * 16 * mebibyte),
    48 * mebibyte,
    likelyMobile ? 96 * mebibyte : 256 * mebibyte,
  );

  return { initial, max, inputByteBudget };
}

function heapPressureRatio(): number | null {
  if (typeof performance === "undefined") return null;
  const memory = (performance as PerformanceWithMemory).memory;
  if (memory === undefined || memory.jsHeapSizeLimit <= 0) return null;
  return memory.usedJSHeapSize / memory.jsHeapSizeLimit;
}

function isResourcePressureError(error: unknown): boolean {
  if (error instanceof RangeError) return true;
  if (!(error instanceof Error)) return false;
  const message = `${error.name} ${error.message}`.toLowerCase();
  return ["memory", "allocation", "out of memory", "imagebitmap", "canvas"].some((token) =>
    message.includes(token),
  );
}

function processingQueueSupported(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (database.objectStoreNames.contains(storeName)) return;
      const store = database.createObjectStore(storeName, { keyPath: "id" });
      store.createIndex("albumId", "albumId", { unique: false });
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("无法打开本地处理队列")),
    );
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("本地处理队列操作失败")),
    );
  });
}

function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("abort", () =>
      reject(transaction.error ?? new Error("本地处理队列事务已取消")),
    );
    transaction.addEventListener("error", () =>
      reject(transaction.error ?? new Error("本地处理队列事务失败")),
    );
  });
}

async function listPersistedTasks(albumId: string): Promise<PersistedProcessingTask[]> {
  if (!processingQueueSupported()) return [];
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeName, "readonly");
    const store = transaction.objectStore(storeName).index("albumId");
    const rows = await requestResult(
      store.getAll(IDBKeyRange.only(albumId)) as IDBRequest<PersistedProcessingTask[]>,
    );
    await complete(transaction);
    return rows.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  } finally {
    database.close();
  }
}

async function putPersistedTasks(tasks: readonly PersistedProcessingTask[]): Promise<void> {
  if (tasks.length === 0) return;
  if (!processingQueueSupported()) throw new Error("当前浏览器不支持本地处理队列");
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    for (const task of tasks) store.put(task);
    await complete(transaction);
  } finally {
    database.close();
  }
}

async function deletePersistedTask(id: string): Promise<void> {
  if (!processingQueueSupported()) return;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).delete(id);
    await complete(transaction);
  } finally {
    database.close();
  }
}

function persistedTask(task: ProcessingTask): PersistedProcessingTask {
  if (task.status === "staged" || task.status === "cancelled") {
    throw new Error("已结束任务不应写回处理队列");
  }
  return {
    id: task.id,
    albumId: task.albumId,
    localPhotoId: task.localPhotoId,
    file: task.file,
    sourceFileName: task.sourceFileName,
    sourceHash: task.sourceHash,
    allowDuplicate: task.allowDuplicate,
    categoryId: task.categoryId,
    createdAt: task.createdAt,
    status: task.status,
    error: task.error,
    uploadedBytes: task.uploadedBytes,
    totalUploadBytes: task.totalUploadBytes,
    uploadStartedAt: task.uploadStartedAt,
  };
}

type Listener = (snapshot: LocalProcessingSnapshot) => void;

class LocalProcessingRuntime {
  readonly #albumId: string;
  readonly #tasks = new Map<string, ProcessingTask>();
  readonly #listeners = new Set<Listener>();
  readonly #abortControllers = new Map<string, AbortController>();
  readonly #intentPromises = new Map<string, Promise<UploadIntentView>>();
  readonly #uploadProgress = new Map<string, Map<string, number>>();
  #bibConfig: BibConfigView | null = null;
  #initialized: Promise<void> | null = null;
  #paused = false;
  #runningTasks = 0;
  #runningInputBytes = 0;
  #profile = defaultProcessingProfile;
  #processingLimit = defaultProcessingProfile.initial;
  #healthySamples = 0;
  #adaptiveTimer: number | null = null;
  #purged = false;

  constructor(albumId: string) {
    this.#albumId = albumId;
  }

  configure(bibConfig: BibConfigView): void {
    this.#bibConfig = bibConfig;
  }

  snapshot(): LocalProcessingSnapshot {
    return {
      paused: this.#paused,
      tasks: [...this.#tasks.values()].map((task) => ({
        id: task.id,
        fileName: task.sourceFileName,
        bytes: task.file.size,
        uploadedBytes: task.uploadedBytes,
        totalUploadBytes: task.totalUploadBytes,
        bytesPerSecond:
          task.uploadStartedAt === null || task.uploadedBytes <= 0
            ? 0
            : Math.round(
                task.uploadedBytes / Math.max(0.25, (Date.now() - task.uploadStartedAt) / 1_000),
              ),
        status: task.status,
        error: task.error,
      })),
    };
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    listener(this.snapshot());
    return () => this.#listeners.delete(listener);
  }

  async initialize(): Promise<void> {
    if (this.#initialized !== null) return this.#initialized;
    this.#initialized = this.#hydrate();
    return this.#initialized;
  }

  async enqueue(inputs: readonly PreparedUploadInput[], categoryId: string | null): Promise<void> {
    if (inputs.length === 0) return;
    await this.initialize();
    const now = Date.now();
    const created = inputs.map<ProcessingTask>((input, index) => ({
      id: crypto.randomUUID(),
      albumId: this.#albumId,
      localPhotoId: crypto.randomUUID(),
      file: input.file,
      sourceFileName: input.sourceFileName,
      sourceHash: input.sourceHash,
      allowDuplicate: input.allowDuplicate === true,
      categoryId,
      createdAt: new Date(now + index).toISOString(),
      status: "queued",
      error: null,
      uploadedBytes: 0,
      totalUploadBytes: input.file.size,
      uploadStartedAt: null,
    }));
    await putPersistedTasks(created.map(persistedTask));
    for (const task of created) this.#tasks.set(task.id, task);
    this.#emit();
    this.#pump();
  }

  togglePause(): void {
    this.#paused = !this.#paused;
    this.#emit();
    if (!this.#paused) this.#pump();
  }

  async cancelTask(taskId: string): Promise<void> {
    await this.initialize();
    const task = this.#tasks.get(taskId);
    if (task === undefined || task.status === "staged" || task.status === "cancelled") return;

    task.status = "cancelled";
    task.error = null;
    this.#abortControllers.get(taskId)?.abort();
    this.#emit();

    let intentId: string | null = null;
    try {
      const localPhoto = await getLocalReviewPhoto(task.localPhotoId);
      intentId = localPhoto?.intentId ?? null;
      if (intentId === null) {
        const pendingIntent = this.#intentPromises.get(taskId);
        if (pendingIntent !== undefined) {
          try {
            intentId = (await pendingIntent).id;
          } catch {
            // The intent was never established, so there is no remote upload to cancel.
          }
        }
      }
      if (intentId !== null) {
        await clientMutation(`/api/v1/uploads/${encodeURIComponent(intentId)}/cancel`);
      }
      await Promise.all([
        deletePersistedTask(task.id),
        deleteLocalReviewPhoto(task.localPhotoId),
        deleteLocalPhotoEditDraft(task.localPhotoId),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "取消上传失败";
      task.status = "failed";
      task.error = message;
      await patchLocalReviewPhoto(task.localPhotoId, {
        uploadState: "failed",
        error: message,
      }).catch(() => undefined);
      await putPersistedTasks([persistedTask(task)]).catch(() => undefined);
      this.#emit();
      throw error;
    }

    this.#emit();
    this.#pump();
  }

  async retryFailed(): Promise<void> {
    await this.initialize();
    const retrying: ProcessingTask[] = [];
    for (const task of this.#tasks.values()) {
      if (task.status !== "failed") continue;
      task.status = "queued";
      task.error = null;
      retrying.push(task);
    }
    await putPersistedTasks(retrying.map(persistedTask));
    if (retrying.length === 0) return;
    this.#paused = false;
    this.#emit();
    this.#pump();
  }

  clearCompleted(): void {
    for (const [id, task] of this.#tasks) {
      if (task.status === "staged" || task.status === "cancelled") this.#tasks.delete(id);
    }
    this.#emit();
  }

  async purgeLocalData(): Promise<void> {
    this.#purged = true;
    this.#paused = true;
    for (const controller of this.#abortControllers.values()) controller.abort();

    const [persisted, localPhotos] = await Promise.all([
      listPersistedTasks(this.#albumId),
      listLocalReviewPhotos(this.#albumId),
    ]);
    const localPhotoIds = new Set([
      ...persisted.map((task) => task.localPhotoId),
      ...localPhotos.map((photo) => photo.id),
      ...[...this.#tasks.values()].map((task) => task.localPhotoId),
    ]);

    await Promise.all([
      ...persisted.map((task) => deletePersistedTask(task.id)),
      ...localPhotoIds.values().flatMap((localPhotoId) => [
        deleteLocalReviewPhoto(localPhotoId),
        deleteLocalPhotoEditDraft(localPhotoId),
      ]),
    ]);

    this.#tasks.clear();
    this.#intentPromises.clear();
    this.#uploadProgress.clear();
    this.#emit();
  }

  async #hydrate(): Promise<void> {
    if (!processingQueueSupported()) throw new Error("当前浏览器不支持本地处理队列");
    this.#profile = adaptiveProcessingProfile();
    this.#processingLimit = this.#profile.initial;
    this.#healthySamples = 0;

    const stored = await listPersistedTasks(this.#albumId);
    const recovered: ProcessingTask[] = await Promise.all(
      stored.map(async (task) => ({
        ...task,
        sourceFileName: task.sourceFileName ?? task.file.name,
        sourceHash:
          typeof task.sourceHash === "string" && /^[a-f0-9]{64}$/u.test(task.sourceHash)
            ? task.sourceHash
            : await sha256Blob(task.file),
        allowDuplicate: task.allowDuplicate ?? false,
        status: task.status === "processing" ? "queued" : task.status,
        error: task.status === "processing" ? null : task.error,
        uploadedBytes: 0,
        totalUploadBytes: task.file.size,
        uploadStartedAt: null,
      })),
    );
    for (const task of recovered) this.#tasks.set(task.id, task);
    const reset = recovered.filter((task) => task.status === "queued");
    if (reset.length > 0) await putPersistedTasks(reset.map(persistedTask));
    this.#ensureAdaptiveTimer();
    this.#emit();
    this.#pump();
  }

  #emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.#listeners) listener(snapshot);
  }

  #reportUploadProgress(
    task: ProcessingTask,
    key: string,
    uploadedBytes: number,
    totalBytes: number,
  ): void {
    if (task.uploadStartedAt === null) task.uploadStartedAt = Date.now();
    const progress = this.#uploadProgress.get(task.id) ?? new Map<string, number>();
    progress.set(key, Math.min(totalBytes, Math.max(0, uploadedBytes)));
    this.#uploadProgress.set(task.id, progress);
    task.uploadedBytes = [...progress.values()].reduce((sum, value) => sum + value, 0);
    this.#emit();
  }

  #pump(): void {
    if (this.#paused || this.#bibConfig === null) return;
    while (this.#runningTasks < this.#processingLimit) {
      const queued = [...this.#tasks.values()].filter((task) => task.status === "queued");
      if (queued.length === 0) break;
      const next =
        queued.find(
          (task) => this.#runningInputBytes + task.file.size <= this.#profile.inputByteBudget,
        ) ?? (this.#runningTasks === 0 ? queued[0] : undefined);
      if (next === undefined) break;
      void this.#runTask(next);
    }
  }

  async #runTask(task: ProcessingTask): Promise<void> {
    const bibConfig = this.#bibConfig;
    if (bibConfig === null || task.status !== "queued") return;
    task.status = "processing";
    task.error = null;
    task.uploadedBytes = 0;
    task.totalUploadBytes = task.file.size;
    task.uploadStartedAt = null;
    this.#uploadProgress.set(task.id, new Map());
    const controller = new AbortController();
    this.#abortControllers.set(task.id, controller);
    this.#runningTasks += 1;
    this.#runningInputBytes += task.file.size;
    this.#emit();

    const uploads: Promise<unknown>[] = [];
    let intentPromise: ReturnType<typeof createProgressiveUpload> | null = null;
    let metadata: ProcessedPhotoMetadata | null = null;

    try {
      await putPersistedTasks([persistedTask(task)]);
      await processPhotoInWorkerStreaming(
        task.file,
        {
          onMetadata: async (nextMetadata) => {
            metadata = nextMetadata;
            const created = createLocalReviewPhoto({
              albumId: this.#albumId,
              categoryId: task.categoryId,
              file: task.file,
              sourceFileName: task.sourceFileName,
              sourceHash: task.sourceHash,
              processed: { ...nextMetadata, variants: [] },
            });
            const localPhoto = {
              ...created,
              id: task.localPhotoId,
              createdAt: task.createdAt,
              uploadState: "uploading" as const,
              bib: {
                ...created.bib,
                ocrStatus: bibConfig.recognitionEnabled
                  ? ("not_started" as const)
                  : ("disabled" as const),
                modelVersion: bibConfig.modelVersion,
                ruleVersion: bibConfig.ruleVersion,
              },
            };
            await putLocalReviewPhoto(localPhoto);
            if (controller.signal.aborted) throw new DOMException("上传已取消", "AbortError");
            intentPromise = createProgressiveUpload({
              localPhotoId: task.localPhotoId,
              albumId: this.#albumId,
              categoryId: task.categoryId,
              file: task.file,
              metadata: nextMetadata,
              sourceHash: task.sourceHash,
              allowDuplicate: task.allowDuplicate,
            });
            this.#intentPromises.set(task.id, intentPromise);
            const intent = await intentPromise;
            if (controller.signal.aborted) throw new DOMException("上传已取消", "AbortError");
            await patchLocalReviewPhoto(task.localPhotoId, {
              intentId: intent.id,
              mediaId: intent.mediaId,
              uploadState: "uploading",
              error: null,
            });

            const editDraft = await getLocalPhotoEditDraft(task.localPhotoId);
            if (
              editDraft !== null &&
              ["applied_local", "syncing", "failed"].includes(editDraft.editState) &&
              editDraft.sourceFingerprint.length > 0
            ) {
              let reserved = false;
              let releaseReservation: () => void = () => {};
              const reservationReady = new Promise<void>((resolve) => {
                releaseReservation = resolve;
              });
              const syncPromise = syncLocalPhotoEditDraft(task.localPhotoId, undefined, () => {
                reserved = true;
                releaseReservation();
              });
              void syncPromise.catch(() => undefined);
              await Promise.race([
                reservationReady,
                syncPromise.then(() => {
                  if (!reserved) {
                    throw new Error("修图版本未能在基础预览上传前建立发布门禁");
                  }
                }),
              ]);
            }

            if (controller.signal.aborted) throw new DOMException("上传已取消", "AbortError");
            uploads.push(
              uploadProgressiveOriginal(intent, task.file, controller.signal, (uploaded, total) =>
                this.#reportUploadProgress(task, "photo_original", uploaded, total),
              ),
            );
          },
          onVariant: async (variant) => {
            if (controller.signal.aborted) throw new DOMException("上传已取消", "AbortError");
            task.totalUploadBytes += variant.blob.size;
            this.#emit();
            await updateLocalReviewPhoto(task.localPhotoId, (current) => ({
              ...current,
              variants: [
                ...current.variants.filter((existing) => existing.kind !== variant.kind),
                { ...variant },
              ],
            }));
            const intent = await intentPromise;
            if (intent === null) throw new Error("原图上传任务尚未创建");
            if (controller.signal.aborted) throw new DOMException("上传已取消", "AbortError");
            const uploaded = registerAndUploadProgressiveVariant(
              intent.id,
              variant,
              controller.signal,
              (uploadedBytes, totalBytes) =>
                this.#reportUploadProgress(task, variant.kind, uploadedBytes, totalBytes),
            );
            uploads.push(uploaded);
            if (variant.kind === "photo_480") {
              const currentMetadata = metadata;
              if (currentMetadata !== null) {
                uploads.push(
                  uploaded.then((latest) =>
                    uploadProgressiveMicroPreview(
                      latest.mediaId,
                      variant,
                      currentMetadata.width,
                      currentMetadata.height,
                      controller.signal,
                    ),
                  ),
                );
              }
            }
          },
        },
        { signal: controller.signal },
      );
      await Promise.all(uploads);
      if (controller.signal.aborted) throw new DOMException("上传已取消", "AbortError");
      await patchLocalReviewPhoto(task.localPhotoId, {
        uploadState: "published",
        error: null,
      });
      startLocalBibOcr(task.localPhotoId, bibConfig);
      await deletePersistedTask(task.id);
      task.status = "staged";
      task.error = null;
      task.uploadedBytes = task.totalUploadBytes;
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : "本地处理或上传失败";
      task.status = "failed";
      task.error = message;
      await patchLocalReviewPhoto(task.localPhotoId, {
        uploadState: "failed",
        error: message,
      }).catch(() => undefined);
      if (isResourcePressureError(error) && this.#processingLimit > 1) {
        this.#healthySamples = 0;
        this.#processingLimit -= 1;
      }
      try {
        await putPersistedTasks([persistedTask(task)]);
      } catch {
        // Keep the in-memory failure visible even if the persistence layer is unavailable.
      }
    } finally {
      if (this.#purged) {
        await Promise.all([
          deletePersistedTask(task.id).catch(() => undefined),
          deleteLocalReviewPhoto(task.localPhotoId).catch(() => undefined),
          deleteLocalPhotoEditDraft(task.localPhotoId).catch(() => undefined),
        ]);
        this.#tasks.delete(task.id);
      }
      this.#abortControllers.delete(task.id);
      this.#intentPromises.delete(task.id);
      this.#uploadProgress.delete(task.id);
      this.#runningTasks = Math.max(0, this.#runningTasks - 1);
      this.#runningInputBytes = Math.max(0, this.#runningInputBytes - task.file.size);
      this.#emit();
      this.#pump();
    }
  }

  #ensureAdaptiveTimer(): void {
    if (this.#adaptiveTimer !== null || typeof window === "undefined") return;
    let expected = performance.now() + adaptiveSampleIntervalMs;
    this.#adaptiveTimer = window.setInterval(() => {
      const now = performance.now();
      const lag = Math.max(0, now - expected);
      expected = now + adaptiveSampleIntervalMs;
      if (document.visibilityState !== "visible" || this.#paused) {
        this.#healthySamples = 0;
        return;
      }

      const heapRatio = heapPressureRatio();
      const current = this.#processingLimit;
      const hasQueued = [...this.#tasks.values()].some((task) => task.status === "queued");
      const saturated = this.#runningTasks >= current;
      const underPressure =
        lag >= eventLoopPressureMs || (heapRatio !== null && heapRatio >= heapPressureThreshold);

      if (underPressure && current > 1) {
        this.#healthySamples = 0;
        this.#processingLimit = current - 1;
        return;
      }

      const healthy =
        lag <= eventLoopHealthyMs && (heapRatio === null || heapRatio <= heapHealthyThreshold);
      if (!hasQueued || !saturated || !healthy || current >= this.#profile.max) {
        this.#healthySamples = 0;
        return;
      }

      this.#healthySamples += 1;
      if (this.#healthySamples < 2) return;
      this.#healthySamples = 0;
      this.#processingLimit = current + 1;
      this.#pump();
    }, adaptiveSampleIntervalMs);
  }
}

const runtimes = new Map<string, LocalProcessingRuntime>();

export function getLocalProcessingRuntime(albumId: string): LocalProcessingRuntime {
  let runtime = runtimes.get(albumId);
  if (runtime === undefined) {
    runtime = new LocalProcessingRuntime(albumId);
    runtimes.set(albumId, runtime);
  }
  return runtime;
}

export async function purgeLocalProcessingAlbum(albumId: string): Promise<void> {
  const runtime = runtimes.get(albumId);
  if (runtime !== undefined) {
    await runtime.purgeLocalData();
    runtimes.delete(albumId);
    return;
  }

  const [persisted, localPhotos] = await Promise.all([
    listPersistedTasks(albumId),
    listLocalReviewPhotos(albumId),
  ]);
  const localPhotoIds = new Set([
    ...persisted.map((task) => task.localPhotoId),
    ...localPhotos.map((photo) => photo.id),
  ]);
  await Promise.all([
    ...persisted.map((task) => deletePersistedTask(task.id)),
    ...localPhotoIds.values().flatMap((localPhotoId) => [
      deleteLocalReviewPhoto(localPhotoId),
      deleteLocalPhotoEditDraft(localPhotoId),
    ]),
  ]);
}
