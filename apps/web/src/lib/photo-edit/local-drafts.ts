"use client";

import { photoEditAiModels } from "./ai-models";
import { type PhotoEditRecipe, photoEditPipelineVersion, photoEditRecipeVersion } from "./recipe";

export type LocalPhotoEditState = "draft" | "applied_local" | "syncing" | "synced" | "failed";

export interface LocalPhotoEditDraft {
  readonly localPhotoId: string;
  readonly mediaId: string | null;
  readonly recipe: PhotoEditRecipe;
  readonly pipelineVersion: string;
  readonly recipeVersion: number;
  readonly denoiseModel: string | null;
  readonly denoiseModelVersion: string | null;
  readonly deblurModel: string | null;
  readonly deblurModelVersion: string | null;
  readonly sourceFingerprint: string;
  readonly basedOnGeneration: number | null;
  readonly basedOnRevisionId: string | null;
  readonly editState: LocalPhotoEditState;
  readonly remoteRevisionId: string | null;
  readonly error: string | null;
  readonly updatedAt: string;
}

const databaseName = "photostream-local-photo-edit-drafts";
const storeName = "drafts";
const databaseVersion = 1;
const channelName = "photostream-local-photo-edit-drafts-events";
let channel: BroadcastChannel | null = null;

function supported(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function notify(localPhotoId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("photostream:local-photo-edit-draft-changed", {
      detail: { localPhotoId },
    }),
  );
  if (!("BroadcastChannel" in window)) return;
  channel ??= new BroadcastChannel(channelName);
  channel.postMessage({ localPhotoId });
}

function ensureChannel(): void {
  if (typeof window === "undefined" || !("BroadcastChannel" in window) || channel !== null) return;
  channel = new BroadcastChannel(channelName);
  channel.addEventListener("message", (event: MessageEvent<{ readonly localPhotoId?: string }>) => {
    if (typeof event.data.localPhotoId !== "string") return;
    window.dispatchEvent(
      new CustomEvent("photostream:local-photo-edit-draft-changed", {
        detail: { localPhotoId: event.data.localPhotoId },
      }),
    );
  });
}

function openDatabase(): Promise<IDBDatabase> {
  ensureChannel();
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(storeName)) {
        database.createObjectStore(storeName, { keyPath: "localPhotoId" });
      }
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("无法打开本地修图草稿存储")),
    );
  });
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("本地修图草稿操作失败")),
    );
  });
}

function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("abort", () =>
      reject(transaction.error ?? new Error("本地修图草稿事务已取消")),
    );
    transaction.addEventListener("error", () =>
      reject(transaction.error ?? new Error("本地修图草稿事务失败")),
    );
  });
}

export function photoEditSourceFingerprint(options: {
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
  readonly contentType: string;
}): string {
  return `${options.bytes}:${options.width}x${options.height}:${options.contentType}`;
}

export async function getLocalPhotoEditDraft(
  localPhotoId: string,
): Promise<LocalPhotoEditDraft | null> {
  if (!supported()) return null;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeName, "readonly");
    const row = await result(
      transaction.objectStore(storeName).get(localPhotoId) as IDBRequest<
        LocalPhotoEditDraft | undefined
      >,
    );
    await complete(transaction);
    return row ?? null;
  } finally {
    database.close();
  }
}

export async function putLocalPhotoEditDraft(options: {
  readonly localPhotoId: string;
  readonly mediaId: string | null;
  readonly recipe: PhotoEditRecipe;
  readonly sourceFingerprint: string;
  readonly basedOnGeneration: number | null;
  readonly basedOnRevisionId: string | null;
  readonly editState: "draft" | "applied_local";
}): Promise<LocalPhotoEditDraft> {
  if (!supported()) throw new Error("当前浏览器不支持本地修图草稿");
  const current = await getLocalPhotoEditDraft(options.localPhotoId);
  const draft: LocalPhotoEditDraft = {
    localPhotoId: options.localPhotoId,
    mediaId: options.mediaId,
    recipe: options.recipe,
    pipelineVersion: photoEditPipelineVersion,
    recipeVersion: photoEditRecipeVersion,
    denoiseModel: options.recipe.denoiseStrength > 0 ? photoEditAiModels.denoise.id : null,
    denoiseModelVersion:
      options.recipe.denoiseStrength > 0 ? photoEditAiModels.denoise.version : null,
    deblurModel: options.recipe.deblurStrength > 0 ? photoEditAiModels.deblur.id : null,
    deblurModelVersion: options.recipe.deblurStrength > 0 ? photoEditAiModels.deblur.version : null,
    sourceFingerprint: options.sourceFingerprint,
    basedOnGeneration: options.basedOnGeneration,
    basedOnRevisionId: options.basedOnRevisionId,
    editState: options.editState,
    remoteRevisionId: current?.remoteRevisionId ?? null,
    error: null,
    updatedAt: new Date().toISOString(),
  };
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(draft);
    await complete(transaction);
  } finally {
    database.close();
  }
  notify(options.localPhotoId);
  return draft;
}

export function putAppliedLocalPhotoEditDraft(options: {
  readonly localPhotoId: string;
  readonly mediaId: string | null;
  readonly recipe: PhotoEditRecipe;
  readonly sourceFingerprint: string;
  readonly basedOnGeneration: number | null;
  readonly basedOnRevisionId: string | null;
}): Promise<LocalPhotoEditDraft> {
  return putLocalPhotoEditDraft({ ...options, editState: "applied_local" });
}

export async function patchLocalPhotoEditDraft(
  localPhotoId: string,
  change: Partial<
    Pick<LocalPhotoEditDraft, "mediaId" | "editState" | "remoteRevisionId" | "error" | "updatedAt">
  >,
): Promise<LocalPhotoEditDraft | null> {
  if (!supported()) return null;
  const current = await getLocalPhotoEditDraft(localPhotoId);
  if (current === null) return null;
  const next: LocalPhotoEditDraft = {
    ...current,
    ...change,
    updatedAt: change.updatedAt ?? new Date().toISOString(),
  };
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(next);
    await complete(transaction);
  } finally {
    database.close();
  }
  notify(localPhotoId);
  return next;
}

export async function deleteLocalPhotoEditDraft(localPhotoId: string): Promise<void> {
  if (!supported()) return;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).delete(localPhotoId);
    await complete(transaction);
  } finally {
    database.close();
  }
  notify(localPhotoId);
}
