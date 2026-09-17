import type { LocalReviewPhoto } from "@/lib/local-review-queue";

/**
 * Legacy review-time upload entry point.
 *
 * Uploads now start in the upload queue as soon as a file is added. Review surfaces must never
 * create a second upload intent. Keep this small guard temporarily while the remaining review
 * workspace call sites are removed.
 */
export async function publishLocalReviewPhoto(
  photo: LocalReviewPhoto,
  signal?: AbortSignal,
): Promise<{ readonly mediaId: string }> {
  if (signal?.aborted === true) throw new DOMException("操作已取消", "AbortError");
  if (photo.mediaId !== null) return { mediaId: photo.mediaId };
  throw new Error("照片仍在上传队列处理中；审核页不再创建上传任务，请等待上传完成后再调整显示状态");
}
