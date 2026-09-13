export interface ImageDownloadProgressRequest {
  readonly url: string;
  readonly expectedBytes: number | null;
  readonly onProgress: (progress: number) => void;
  readonly signal?: AbortSignal;
}

function clampProgress(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export async function fetchImageWithProgress(
  request: ImageDownloadProgressRequest,
): Promise<Blob> {
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
    return blob;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loadedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
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
  return blob;
}
