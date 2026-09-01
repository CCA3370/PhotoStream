const maximumInputBytes = 25 * 1024 * 1024;
export const maximumFaceReferenceBytes = 3 * 1024 * 1024;
export const maximumFaceReferenceEdge = 1_920;

export class FaceReferenceProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FaceReferenceProcessingError";
  }
}

export function fitFaceReferenceDimensions(
  width: number,
  height: number,
  maximumEdge = maximumFaceReferenceEdge,
): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new FaceReferenceProcessingError("无法读取照片尺寸，请改选 JPEG、PNG 或 WebP 文件。");
  }
  const scale = Math.min(1, maximumEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function decodeWithImageElement(file: File): Promise<{
  width: number;
  height: number;
  draw(context: CanvasRenderingContext2D, width: number, height: number): void;
  close(): void;
}> {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  try {
    await image.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new FaceReferenceProcessingError(
      "此设备无法解码该照片；HEIC/HEIF 请先在相册中导出为 JPEG、PNG 或 WebP。",
    );
  }
  return {
    width: image.naturalWidth,
    height: image.naturalHeight,
    draw: (context, width, height) => context.drawImage(image, 0, 0, width, height),
    close: () => URL.revokeObjectURL(url),
  };
}

async function decode(file: File) {
  if (typeof createImageBitmap !== "function") return decodeWithImageElement(file);
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return {
      width: bitmap.width,
      height: bitmap.height,
      draw: (context: CanvasRenderingContext2D, width: number, height: number) =>
        context.drawImage(bitmap, 0, 0, width, height),
      close: () => bitmap.close(),
    };
  } catch {
    return decodeWithImageElement(file);
  }
}

function jpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null) reject(new FaceReferenceProcessingError("此设备无法生成 JPEG 参考照。"));
        else resolve(blob);
      },
      "image/jpeg",
      quality,
    );
  });
}

export async function preprocessFaceReference(file: File): Promise<Blob> {
  if (file.size <= 0 || file.size > maximumInputBytes) {
    throw new FaceReferenceProcessingError("原始照片过大，请先在设备相册中缩小后重试。");
  }
  const source = await decode(file);
  const canvas = document.createElement("canvas");
  try {
    let dimensions = fitFaceReferenceDimensions(source.width, source.height);
    for (let resizeAttempt = 0; resizeAttempt < 4; resizeAttempt += 1) {
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      const context = canvas.getContext("2d", { alpha: false });
      if (context === null) {
        throw new FaceReferenceProcessingError("此设备无法安全处理参考照。");
      }
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, dimensions.width, dimensions.height);
      source.draw(context, dimensions.width, dimensions.height);
      for (const quality of [0.9, 0.82, 0.74, 0.66]) {
        const blob = await jpeg(canvas, quality);
        if (blob.size <= maximumFaceReferenceBytes) return blob;
      }
      dimensions = fitFaceReferenceDimensions(
        Math.floor(dimensions.width * 0.8),
        Math.floor(dimensions.height * 0.8),
      );
    }
    throw new FaceReferenceProcessingError("处理后的照片仍超过 3 MiB，请改选更小的照片。");
  } finally {
    source.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}
