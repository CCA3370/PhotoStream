import type {
  CreatePhotoUploadRequest,
  PhotoVariantKind,
  SignedUpload,
  UploadIntentView,
} from "@photostream/contracts";

import { ClientApiError, clientGet, clientMutation } from "@/lib/client-api";
import { type LocalReviewPhoto, patchLocalReviewPhoto } from "@/lib/local-review-queue";

function signalOptions(signal?: AbortSignal): { readonly signal?: AbortSignal } {
  return signal === undefined ? {} : { signal };
}

function uploadRequest(photo: LocalReviewPhoto): CreatePhotoUploadRequest {
  return {
    albumId: photo.albumId,
    categoryId: photo.categoryId,
    width: photo.width,
    height: photo.height,
    totalBytes: photo.totalBytes,
    capturedAt: photo.capturedAt,
    variants: [
      ...photo.variants.map((variant) => ({
        kind: variant.kind,
        format: variant.format,
        contentType: variant.contentType,
        width: variant.width,
        height: variant.height,
        bytes: variant.blob.size,
      })),
      {
        kind: "photo_original" as const,
        format: photo.originalFormat,
        contentType: photo.originalContentType,
        width: photo.width,
        height: photo.height,
        bytes: photo.originalBlob.size,
      },
    ],
  };
}

function blobs(photo: LocalReviewPhoto): Map<PhotoVariantKind, Blob> {
  return new Map<PhotoVariantKind, Blob>([
    ...photo.variants.map((variant) => [variant.kind, variant.blob] as const),
    ["photo_original", photo.originalBlob],
  ]);
}

async function putSigned(path: string, blob: Blob, signal?: AbortSignal): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const signed = await clientMutation<SignedUpload>(path, signalOptions(signal));
      const response = await fetch(signed.url, {
        method: "PUT",
        headers: signed.headers,
        body: blob,
        ...(signal === undefined ? {} : { signal }),
      });
      if (response.ok || response.status === 409) return response;
      if (
        response.status < 500 &&
        response.status !== 408 &&
        response.status !== 425 &&
        response.status !== 429
      ) {
        throw new Error(`对象上传失败（${response.status}）`);
      }
      lastError = new Error(`对象上传暂时失败（${response.status}）`);
    } catch (error) {
      if (signal?.aborted === true) throw new DOMException("上传已取消", "AbortError");
      if (error instanceof ClientApiError && error.response?.retryable !== true) throw error;
      lastError = error;
    }
    if (attempt < 2) {
      await new Promise((resolve) => window.setTimeout(resolve, 350 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("对象上传失败");
}

async function createIntent(
  photo: LocalReviewPhoto,
  signal?: AbortSignal,
): Promise<UploadIntentView> {
  return clientMutation<UploadIntentView>("/api/v1/uploads", {
    body: uploadRequest(photo),
    idempotencyKey: `local-${photo.id}`,
    ...signalOptions(signal),
  });
}

async function resolveIntent(
  photo: LocalReviewPhoto,
  signal?: AbortSignal,
): Promise<UploadIntentView> {
  if (photo.intentId !== null) {
    try {
      const existing = await clientGet<UploadIntentView>(
        `/api/v1/uploads/${photo.intentId}`,
        signal,
      );
      if (existing.status === "active") return existing;
    } catch (error) {
      if (
        !(error instanceof ClientApiError) ||
        (error.response?.code !== "UPLOAD_NOT_FOUND" && error.response?.code !== "FORBIDDEN")
      ) {
        throw error;
      }
    }
  }
  const intent = await createIntent(photo, signal);
  await patchLocalReviewPhoto(photo.id, {
    intentId: intent.id,
    mediaId: intent.mediaId,
    uploadState: "uploading",
    error: null,
  });
  return intent;
}

async function transferObject(
  intent: UploadIntentView,
  kind: PhotoVariantKind,
  blob: Blob,
  signal?: AbortSignal,
): Promise<UploadIntentView> {
  const object = intent.objects.find((candidate) => candidate.kind === kind);
  if (object === undefined) throw new Error(`上传任务缺少 ${kind}`);
  if (object.completed) return intent;

  if (object.uploadMode === "multipart") {
    const parts = [...object.parts].sort((left, right) => left.partNumber - right.partNumber);
    let offset = 0;
    for (const part of parts) {
      const start = offset;
      offset += part.expectedBytes;
      if (part.completed) continue;
      const slice = blob.slice(start, offset, object.contentType);
      const response = await putSigned(
        `/api/v1/uploads/${intent.id}/objects/${kind}/parts/${part.partNumber}/sign`,
        slice,
        signal,
      );
      const etag = response.headers.get("etag");
      if (etag === null) throw new Error(`分片 ${part.partNumber} 缺少 ETag`);
      await clientMutation<UploadIntentView>(
        `/api/v1/uploads/${intent.id}/objects/${kind}/parts/${part.partNumber}/complete`,
        {
          body: { etag },
          idempotencyKey: `local-part-${intent.id}-${kind}-${part.partNumber}`,
          ...signalOptions(signal),
        },
      );
    }
    if (offset !== blob.size) throw new Error("分片规格与本地文件不一致");
  } else {
    await putSigned(`/api/v1/uploads/${intent.id}/objects/${kind}/sign`, blob, signal);
  }

  return clientMutation<UploadIntentView>(`/api/v1/uploads/${intent.id}/objects/${kind}/complete`, {
    idempotencyKey: `local-object-${intent.id}-${kind}`,
    ...signalOptions(signal),
  });
}

export async function publishLocalReviewPhoto(
  photo: LocalReviewPhoto,
  signal?: AbortSignal,
): Promise<{ readonly mediaId: string }> {
  await patchLocalReviewPhoto(photo.id, { uploadState: "uploading", error: null });
  try {
    let intent = await resolveIntent(photo, signal);
    const localBlobs = blobs(photo);
    for (const kind of ["photo_480", "photo_960", "photo_1920", "photo_original"] as const) {
      const blob = localBlobs.get(kind);
      if (blob === undefined) throw new Error(`本地队列缺少 ${kind}`);
      intent = await transferObject(intent, kind, blob, signal);
    }

    await clientMutation<{ readonly ok: true }>(`/api/v1/media/${intent.mediaId}/publish`, {
      idempotencyKey: `local-publish-${photo.id}`,
      ...signalOptions(signal),
    });
    if (photo.featured) {
      await clientMutation<{ readonly mediaId: string; readonly featured: boolean }>(
        `/api/v1/media/${intent.mediaId}/featured`,
        { body: { featured: true }, ...signalOptions(signal) },
      );
    }
    return { mediaId: intent.mediaId };
  } catch (error) {
    await patchLocalReviewPhoto(photo.id, {
      uploadState: "failed",
      error: error instanceof Error ? error.message : "上传失败",
    }).catch(() => undefined);
    throw error;
  }
}
