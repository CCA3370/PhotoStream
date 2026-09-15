export interface ImageDownloadProgressRequest {
  readonly url: string;
  readonly expectedBytes: number | null;
  readonly onProgress: (progress: number) => void;
  readonly signal?: AbortSignal;
}

type NetworkImageDownloadListener = () => void;

const networkImageDownloadListeners = new Set<NetworkImageDownloadListener>();
let activeNetworkImageDownloads = 0;
let completedNetworkImageDownloads = 0;

function emitNetworkImageDownloadChange(): void {
  for (const listener of networkImageDownloadListeners) listener();
}

function beginNetworkImageDownload(): (completed: boolean) => void {
  activeNetworkImageDownloads += 1;
  emitNetworkImageDownloadChange();
  let settled = false;

  return (completed: boolean) => {
    if (settled) return;
    settled = true;
    activeNetworkImageDownloads = Math.max(0, activeNetworkImageDownloads - 1);
    if (completed) completedNetworkImageDownloads += 1;
    emitNetworkImageDownloadChange();
  };
}

export function subscribeNetworkImageDownload(listener: NetworkImageDownloadListener): () => void {
  networkImageDownloadListeners.add(listener);
  return () => networkImageDownloadListeners.delete(listener);
}

export function hasPendingNetworkImageDownload(): boolean {
  return activeNetworkImageDownloads > 0 || completedNetworkImageDownloads > 0;
}

export function consumeNetworkImageDownloadCompletion(): boolean {
  if (completedNetworkImageDownloads < 1) return false;
  completedNetworkImageDownloads -= 1;
  emitNetworkImageDownloadChange();
  return true;
}

function clampProgress(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export async function fetchImageWithProgress(request: ImageDownloadProgressRequest): Promise<Blob> {
  const finishNetworkDownload = beginNetworkImageDownload();
  let completed = false;

  try {
    request.onProgress(0);
    const response = await fetch(request.url, {
      cache: "default",
      credentials: "omit",
      mode: "cors",
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    if (!response.ok) throw new Error(`图片加载失败（${response.status}）`);

    const headerBytes = Number(response.headers.get("content-length"));
    const totalBytes =
      Number.isFinite(headerBytes) && headerBytes > 0
        ? headerBytes
        : request.expectedBytes !== null && request.expectedBytes > 0
          ? request.expectedBytes
          : null;

    if (response.body === null) {
      const blob = await response.blob();
      if (blob.size === 0) throw new Error("图片内容为空，请稍后重试。");
      if (request.expectedBytes !== null && blob.size !== request.expectedBytes) {
        throw new Error("图片大小与记录不一致，请刷新相册后重试。");
      }
      request.onProgress(1);
      completed = true;
      return blob;
    }

    const reader = response.body.getReader();
    const chunks: ArrayBuffer[] = [];
    let loadedBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const copy = new Uint8Array(value.byteLength);
      copy.set(value);
      chunks.push(copy.buffer);
      loadedBytes += value.byteLength;
      if (totalBytes !== null) {
        request.onProgress(clampProgress(Math.min(0.99, loadedBytes / totalBytes)));
      }
    }

    const blob = new Blob(chunks, {
      type: response.headers.get("content-type") ?? "application/octet-stream",
    });
    if (blob.size === 0) throw new Error("图片内容为空，请稍后重试。");
    if (request.expectedBytes !== null && blob.size !== request.expectedBytes) {
      throw new Error("图片大小与记录不一致，请刷新相册后重试。");
    }
    request.onProgress(1);
    completed = true;
    return blob;
  } finally {
    finishNetworkDownload(completed);
  }
}
