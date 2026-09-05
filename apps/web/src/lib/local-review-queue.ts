import type { ProcessedPhoto } from "@/lib/photo-processing";

export type LocalUploadState = "local" | "uploading" | "failed";

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
}

const databaseName = "photostream-local-review";
const storeName = "photos";
const databaseVersion = 1;

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

function notify(albumId: string): void {
  window.dispatchEvent(
    new CustomEvent("photostream:local-review-changed", { detail: { albumId } }),
  );
}

export function localQueueSupported(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
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
    return rows.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
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
    return row ?? null;
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

export async function patchLocalReviewPhoto(
  id: string,
  change: Partial<Omit<LocalReviewPhoto, "id" | "albumId">>,
): Promise<LocalReviewPhoto> {
  const current = await getLocalReviewPhoto(id);
  if (current === null) throw new Error("本地照片不存在");
  const next: LocalReviewPhoto = { ...current, ...change };
  await putLocalReviewPhoto(next);
  return next;
}

export async function deleteLocalReviewPhoto(id: string): Promise<void> {
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
}
