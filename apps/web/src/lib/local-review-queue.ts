import type { BibCandidateInput, BibMediaState, BibTagView } from "@photostream/contracts";
import { normalizeBibNumber } from "@photostream/contracts";

import type { ProcessedPhoto } from "@/lib/photo-processing";

export type LocalUploadState = "local" | "uploading" | "failed" | "published";
export type LocalBibOcrStatus =
  | "disabled"
  | "not_started"
  | "processing"
  | "completed"
  | "failed"
  | "unsupported";
export type LocalBibDecision = "pending" | "numbers_confirmed" | "no_number_confirmed";

export interface LocalBibState {
  readonly ocrStatus: LocalBibOcrStatus;
  readonly modelVersion: string | null;
  readonly ruleVersion: number | null;
  readonly candidates: readonly BibCandidateInput[];
  readonly ocrError: string | null;
  readonly ocrRevision: number;
  readonly ocrSyncedRevision: number;
  readonly decision: LocalBibDecision;
  readonly confirmedNumbers: readonly string[];
  readonly decidedAt: string | null;
  readonly manualRevision: number;
  readonly manualSyncedRevision: number;
}

export interface LocalReviewVariant {
  readonly kind: "photo_480" | "photo_960" | "photo_1920";
  readonly format: "webp" | "jpeg";
  readonly contentType: "image/webp" | "image/jpeg";
  readonly width: number;
  readonly height: number;
  readonly blob: Blob;
}

export interface LocalReviewPhoto {
  readonly id: string;
  readonly albumId: string;
  readonly fileName: string;
  readonly categoryId: string | null;
  readonly originalBlob: Blob;
  readonly originalFormat: "jpeg" | "png" | "webp";
  readonly originalContentType: "image/jpeg" | "image/png" | "image/webp";
  readonly width: number;
  readonly height: number;
  readonly totalBytes: number;
  readonly capturedAt: string | null;
  readonly variants: readonly LocalReviewVariant[];
  readonly featured: boolean;
  readonly createdAt: string;
  readonly intentId: string | null;
  readonly mediaId: string | null;
  readonly uploadState: LocalUploadState;
  readonly error: string | null;
  readonly bib: LocalBibState;
}

const databaseName = "photostream-local-review";
const storeName = "photos";
const databaseVersion = 1;
const broadcastChannelName = "photostream-local-review-events";
const mutationTails = new Map<string, Promise<void>>();
let broadcastChannel: BroadcastChannel | null = null;

function defaultBibState(): LocalBibState {
  return {
    ocrStatus: "not_started",
    modelVersion: null,
    ruleVersion: null,
    candidates: [],
    ocrError: null,
    ocrRevision: 0,
    ocrSyncedRevision: 0,
    decision: "pending",
    confirmedNumbers: [],
    decidedAt: null,
    manualRevision: 0,
    manualSyncedRevision: 0,
  };
}

function normalizeBibState(value: Partial<LocalBibState> | undefined): LocalBibState {
  return { ...defaultBibState(), ...value };
}

function normalizeStoredPhoto(photo: LocalReviewPhoto): LocalReviewPhoto {
  return { ...photo, bib: normalizeBibState(photo.bib) };
}

function dispatchChanged(albumId: string): void {
  window.dispatchEvent(
    new CustomEvent("photostream:local-review-changed", { detail: { albumId } }),
  );
}

function ensureBroadcastChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || !("BroadcastChannel" in window)) return null;
  if (broadcastChannel !== null) return broadcastChannel;
  broadcastChannel = new BroadcastChannel(broadcastChannelName);
  broadcastChannel.addEventListener("message", (event: MessageEvent<{ readonly albumId?: string }>) => {
    if (typeof event.data?.albumId === "string") dispatchChanged(event.data.albumId);
  });
  return broadcastChannel;
}

function notify(albumId: string): void {
  dispatchChanged(albumId);
  ensureBroadcastChannel()?.postMessage({ albumId });
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
      reject(request.error ?? new Error("无法打开本地审核队列")),
    );
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error ?? new Error("本地队列操作失败")));
  });
}

function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("abort", () =>
      reject(transaction.error ?? new Error("本地队列事务已取消")),
    );
    transaction.addEventListener("error", () =>
      reject(transaction.error ?? new Error("本地队列事务失败")),
    );
  });
}

async function serializePhotoMutation<T>(id: string, operation: () => Promise<T>): Promise<T> {
  const previous = mutationTails.get(id) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const turn = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => turn);
  mutationTails.set(id, tail);
  try {
    await previous;
    return await operation();
  } finally {
    release();
    void tail.finally(() => {
      if (mutationTails.get(id) === tail) mutationTails.delete(id);
    });
  }
}

export function localQueueSupported(): boolean {
  const supported = typeof window !== "undefined" && "indexedDB" in window;
  if (supported) ensureBroadcastChannel();
  return supported;
}

export function createLocalReviewPhoto(options: {
  readonly albumId: string;
  readonly categoryId: string | null;
  readonly file: File;
  readonly processed: ProcessedPhoto;
}): LocalReviewPhoto {
  return {
    id: crypto.randomUUID(),
    albumId: options.albumId,
    fileName: options.file.name,
    categoryId: options.categoryId,
    originalBlob: options.file,
    originalFormat: options.processed.originalFormat,
    originalContentType: options.processed.originalContentType,
    width: options.processed.width,
    height: options.processed.height,
    totalBytes: options.file.size,
    capturedAt: options.processed.capturedAt,
    variants: options.processed.variants.map((variant) => ({ ...variant })),
    featured: false,
    createdAt: new Date().toISOString(),
    intentId: null,
    mediaId: null,
    uploadState: "local",
    error: null,
    bib: defaultBibState(),
  };
}

export async function listLocalReviewPhotos(albumId: string): Promise<LocalReviewPhoto[]> {
  if (!localQueueSupported()) return [];
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeName, "readonly");
    const store = transaction.objectStore(storeName).index("albumId");
    const rows = await requestResult(
      store.getAll(IDBKeyRange.only(albumId)) as IDBRequest<LocalReviewPhoto[]>,
    );
    await complete(transaction);
    return rows
      .map(normalizeStoredPhoto)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  } finally {
    database.close();
  }
}

export async function getLocalReviewPhoto(id: string): Promise<LocalReviewPhoto | null> {
  if (!localQueueSupported()) return null;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeName, "readonly");
    const row = await requestResult(
      transaction.objectStore(storeName).get(id) as IDBRequest<LocalReviewPhoto | undefined>,
    );
    await complete(transaction);
    return row === undefined ? null : normalizeStoredPhoto(row);
  } finally {
    database.close();
  }
}

export async function putLocalReviewPhoto(photo: LocalReviewPhoto): Promise<void> {
  if (!localQueueSupported()) throw new Error("当前浏览器不支持本地审核队列");
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(photo);
    await complete(transaction);
  } finally {
    database.close();
  }
  notify(photo.albumId);
}

export async function updateLocalReviewPhoto(
  id: string,
  update: (current: LocalReviewPhoto) => LocalReviewPhoto,
): Promise<LocalReviewPhoto> {
  return serializePhotoMutation(id, async () => {
    const current = await getLocalReviewPhoto(id);
    if (current === null) throw new Error("本地照片不存在");
    const next = update(current);
    if (next.id !== current.id || next.albumId !== current.albumId) {
      throw new Error("不能修改本地照片标识");
    }
    await putLocalReviewPhoto(next);
    return next;
  });
}

export async function patchLocalReviewPhoto(
  id: string,
  change: Partial<Omit<LocalReviewPhoto, "id" | "albumId">>,
): Promise<LocalReviewPhoto> {
  return updateLocalReviewPhoto(id, (current) => ({ ...current, ...change }));
}

export async function confirmLocalBibNumbers(
  id: string,
  numbers: readonly string[],
): Promise<LocalReviewPhoto> {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of numbers) {
    const number = normalizeBibNumber(value);
    if (number === null) throw new Error("号码格式无效");
    if (!seen.has(number)) {
      seen.add(number);
      normalized.push(number);
    }
  }
  if (normalized.length === 0) throw new Error("请至少输入一个号码");
  return updateLocalReviewPhoto(id, (current) => ({
    ...current,
    bib: {
      ...current.bib,
      decision: "numbers_confirmed",
      confirmedNumbers: normalized,
      decidedAt: new Date().toISOString(),
      manualRevision: current.bib.manualRevision + 1,
    },
  }));
}

export async function confirmLocalBibNoNumber(id: string): Promise<LocalReviewPhoto> {
  return updateLocalReviewPhoto(id, (current) => ({
    ...current,
    bib: {
      ...current.bib,
      decision: "no_number_confirmed",
      confirmedNumbers: [],
      decidedAt: new Date().toISOString(),
      manualRevision: current.bib.manualRevision + 1,
    },
  }));
}

export function localBibOcrPending(photo: LocalReviewPhoto): boolean {
  return photo.bib.ocrStatus === "not_started" || photo.bib.ocrStatus === "processing";
}

function localTag(options: {
  readonly id: string;
  readonly mediaId: string;
  readonly number: string;
  readonly status: BibTagView["status"];
  readonly source: BibTagView["source"];
  readonly confidence: number | null;
  readonly quadrilateral: BibTagView["quadrilateral"];
  readonly ruleVersion: number;
  readonly modelVersion: string | null;
  readonly createdAt: string;
  readonly confirmedAt: string | null;
}): BibTagView {
  return {
    ...options,
    gradeOptionId: null,
    classOptionId: null,
    mappingVersion: 0,
  };
}

export function localBibMediaState(photo: LocalReviewPhoto): BibMediaState {
  const mediaId = photo.mediaId ?? photo.id;
  const ruleVersion = photo.bib.ruleVersion ?? 0;
  const confirmed = photo.bib.decision === "numbers_confirmed";
  const tags: BibTagView[] = confirmed
    ? photo.bib.confirmedNumbers.map((number, index) =>
        localTag({
          id: `local-manual-${photo.id}-${index}`,
          mediaId,
          number,
          status: "confirmed",
          source: "manual",
          confidence: null,
          quadrilateral: null,
          ruleVersion,
          modelVersion: null,
          createdAt: photo.bib.decidedAt ?? photo.createdAt,
          confirmedAt: photo.bib.decidedAt,
        }),
      )
    : photo.bib.decision === "pending"
      ? photo.bib.candidates.map((candidate, index) =>
          localTag({
            id: `local-ocr-${photo.id}-${index}`,
            mediaId,
            number: candidate.text,
            status: "suggested",
            source: "ocr",
            confidence: candidate.confidence,
            quadrilateral: candidate.quadrilateral,
            ruleVersion,
            modelVersion: candidate.modelVersion,
            createdAt: photo.createdAt,
            confirmedAt: null,
          }),
        )
      : [];
  return {
    tags,
    review: {
      mediaId,
      decision: photo.bib.decision,
      ocrStatus: photo.bib.ocrStatus === "disabled" ? "not_started" : photo.bib.ocrStatus,
      ocrModelVersion: photo.bib.modelVersion,
      decidedAt: photo.bib.decidedAt,
    },
  };
}

export function effectiveBibMediaState(
  photo: LocalReviewPhoto,
  remote: BibMediaState | null | undefined,
): BibMediaState {
  if (
    remote !== null &&
    remote !== undefined &&
    (remote.review.decision === "numbers_confirmed" ||
      remote.review.decision === "no_number_confirmed")
  ) {
    return remote;
  }
  if (photo.bib.ocrRevision > photo.bib.ocrSyncedRevision || remote === null || remote === undefined) {
    return localBibMediaState(photo);
  }
  return remote;
}

export async function deleteLocalReviewPhoto(id: string): Promise<void> {
  await serializePhotoMutation(id, async () => {
    const current = await getLocalReviewPhoto(id);
    if (current === null) return;
    const database = await openDatabase();
    try {
      const transaction = database.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).delete(id);
      await complete(transaction);
    } finally {
      database.close();
    }
    notify(current.albumId);
  });
}
