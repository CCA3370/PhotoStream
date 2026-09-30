import { internalImageSourceIdentity } from "./internal-media-url";

interface ReviewImage {
  readonly key: string;
  readonly visualRevision: string | null;
  readonly src: string | null;
}

export interface ReviewImageRequest {
  readonly identity: string | null;
}

export function reviewImageIdentity(image: ReviewImage | null): string | null {
  return image === null
    ? null
    : `${image.key}\u0000${image.visualRevision ?? "base"}\u0000${internalImageSourceIdentity(image.src) ?? "none"}`;
}

export function canActOnReviewImage(
  current: ReviewImageRequest,
  loaded: ReviewImageRequest | null,
  failed: boolean,
): boolean {
  return current.identity !== null && current === loaded && !failed;
}

export function requestReviewImage(
  previous: ReviewImageRequest | null,
  image: ReviewImage | null,
): ReviewImageRequest {
  const identity = reviewImageIdentity(image);
  return previous?.identity === identity ? previous : { identity };
}

export function notifyCurrentReviewImageLoad(
  current: ReviewImageRequest,
  completed: ReviewImageRequest,
  onLoaded: () => void,
): void {
  if (current.identity !== null && current === completed) onLoaded();
}
