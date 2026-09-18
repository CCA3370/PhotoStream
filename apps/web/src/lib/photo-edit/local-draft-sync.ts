"use client";

import { getLocalReviewPhoto } from "../local-review-queue";
import {
  getLocalPhotoEditDraft,
  patchLocalPhotoEditDraft,
  photoEditSourceFingerprint,
} from "./local-drafts";
import {
  applyMediaEditRecipe,
  cancelPendingMediaEditRevision,
  getMediaEditContext,
} from "./revision-client";

const syncTails = new Map<string, Promise<void>>();

async function syncOnce(localPhotoId: string, signal?: AbortSignal): Promise<void> {
  const photo = await getLocalReviewPhoto(localPhotoId);
  const draft = await getLocalPhotoEditDraft(localPhotoId);
  if (photo === null || draft === null || photo.mediaId === null) return;
  if (draft.editState === "synced" && draft.mediaId === photo.mediaId) return;

  const fingerprint = photoEditSourceFingerprint({
    bytes: photo.totalBytes,
    width: photo.width,
    height: photo.height,
    contentType: photo.originalContentType,
  });
  if (draft.sourceFingerprint !== fingerprint) {
    await patchLocalPhotoEditDraft(localPhotoId, {
      mediaId: photo.mediaId,
      editState: "failed",
      error: "本地原图与修图草稿不匹配，请重新打开照片应用修图。",
    });
    return;
  }

  let context = await getMediaEditContext(photo.mediaId, signal);
  if (context.state.pendingRevisionId !== null) {
    if (
      draft.remoteRevisionId !== null &&
      draft.remoteRevisionId === context.state.pendingRevisionId
    ) {
      context = await cancelPendingMediaEditRevision({
        mediaId: photo.mediaId,
        revisionId: draft.remoteRevisionId,
        ...(signal === undefined ? {} : { signal }),
      });
      await patchLocalPhotoEditDraft(localPhotoId, { remoteRevisionId: null });
    } else {
      await patchLocalPhotoEditDraft(localPhotoId, {
        mediaId: photo.mediaId,
        editState: "failed",
        error: "此照片正在另一台设备处理修图版本，请稍后重试。",
      });
      return;
    }
  }

  await patchLocalPhotoEditDraft(localPhotoId, {
    mediaId: photo.mediaId,
    editState: "syncing",
    error: null,
  });

  try {
    const applied = await applyMediaEditRecipe({
      mediaId: photo.mediaId,
      recipe: draft.recipe,
      source: photo.originalBlob,
      basedOnGeneration: context.state.generation,
      basedOnRevisionId: context.state.activeRevisionId,
      ...(signal === undefined ? {} : { signal }),
      onReserved: async (revisionId) => {
        await patchLocalPhotoEditDraft(localPhotoId, {
          mediaId: photo.mediaId,
          remoteRevisionId: revisionId,
          editState: "syncing",
          error: null,
        });
      },
    });
    await patchLocalPhotoEditDraft(localPhotoId, {
      mediaId: photo.mediaId,
      editState: "synced",
      remoteRevisionId: applied.state.activeRevisionId,
      error: null,
    });
  } catch (error) {
    await patchLocalPhotoEditDraft(localPhotoId, {
      mediaId: photo.mediaId,
      editState: "failed",
      error: error instanceof Error ? error.message : "修图版本同步失败",
    });
  }
}

export function syncLocalPhotoEditDraft(localPhotoId: string, signal?: AbortSignal): Promise<void> {
  const previous = syncTails.get(localPhotoId) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => {
      if (signal?.aborted) throw new DOMException("修图同步已取消", "AbortError");
      return syncOnce(localPhotoId, signal);
    });
  syncTails.set(localPhotoId, next);
  return next.finally(() => {
    if (syncTails.get(localPhotoId) === next) syncTails.delete(localPhotoId);
  });
}
