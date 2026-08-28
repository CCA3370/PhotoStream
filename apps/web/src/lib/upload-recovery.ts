import type { PhotoVariantKind } from "@photostream/contracts";

export interface UploadRecoveryRecord {
  readonly intentId: string;
  readonly albumId: string;
  readonly fingerprint: string;
  readonly completed: readonly PhotoVariantKind[];
  readonly multipartParts: readonly {
    readonly kind: PhotoVariantKind;
    readonly partNumber: number;
    readonly etag: string;
  }[];
  readonly retryCount: number;
  readonly lastError: string | null;
  readonly updatedAt: string;
}

const databaseName = "photostream-upload-queue";
const storeName = "uploads";

export async function fileFingerprint(file: File): Promise<string> {
  const sampleBytes = 64 * 1024;
  const [first, last] = await Promise.all([
    file.slice(0, Math.min(file.size, sampleBytes)).arrayBuffer(),
    file.slice(Math.max(0, file.size - sampleBytes)).arrayBuffer(),
  ]);
  const metadata = new TextEncoder().encode(`${file.size}:${file.lastModified}:${file.type}:`);
  const input = new Uint8Array(metadata.byteLength + first.byteLength + last.byteLength);
  input.set(metadata);
  input.set(new Uint8Array(first), metadata.byteLength);
  input.set(new Uint8Array(last), metadata.byteLength + first.byteLength);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  const hash = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${file.size}:${file.lastModified}:${file.type}:${hash}`;
}

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.addEventListener("upgradeneeded", () => {
      if (!request.result.objectStoreNames.contains(storeName)) {
        request.result.createObjectStore(storeName, { keyPath: "intentId" });
      }
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}

async function transaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const request = operation(tx.objectStore(storeName));
      let result: T;
      request.addEventListener("success", () => {
        result = request.result;
      });
      request.addEventListener("error", () => reject(request.error));
      tx.addEventListener("abort", () => reject(tx.error));
      tx.addEventListener("complete", () => resolve(result));
    });
  } finally {
    db.close();
  }
}

export async function listUploadRecoveries(): Promise<UploadRecoveryRecord[]> {
  const records = await transaction<UploadRecoveryRecord[]>("readonly", (store) => store.getAll());
  return records.map((record) => ({
    ...record,
    retryCount: Number.isSafeInteger(record.retryCount) ? record.retryCount : 0,
    lastError: typeof record.lastError === "string" ? record.lastError : null,
    multipartParts: Array.isArray(record.multipartParts) ? record.multipartParts : [],
  }));
}

export async function saveUploadRecovery(record: UploadRecoveryRecord): Promise<void> {
  await transaction("readwrite", (store) => store.put(record));
}

export async function deleteUploadRecovery(intentId: string): Promise<void> {
  await transaction("readwrite", (store) => store.delete(intentId));
}
