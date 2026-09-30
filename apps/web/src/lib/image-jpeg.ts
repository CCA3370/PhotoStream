import { isAppleWebKit } from "./apple-webkit";

interface DecodedImage {
  readonly width: number;
  readonly height: number;
  draw(context: CanvasRenderingContext2D): void;
  close(): void;
}

async function decodeWithImageElement(blob: Blob): Promise<DecodedImage> {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = "async";
  const loaded = new Promise<void>((resolve, reject) => {
    image.addEventListener("load", () => resolve(), { once: true });
    image.addEventListener("error", () => reject(new Error("当前浏览器无法解码图片")), {
      once: true,
    });
  });
  image.src = url;
  try {
    if (typeof image.decode === "function") {
      await image.decode().catch(() => loaded);
    } else {
      await loaded;
    }
    if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
      throw new Error("图片尺寸无效");
    }
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      draw: (context) => context.drawImage(image, 0, 0),
      close: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

async function decode(blob: Blob): Promise<DecodedImage> {
  if (isAppleWebKit() || typeof createImageBitmap !== "function") {
    return decodeWithImageElement(blob);
  }
  try {
    const bitmap = await createImageBitmap(blob);
    return {
      width: bitmap.width,
      height: bitmap.height,
      draw: (context) => context.drawImage(bitmap, 0, 0),
      close: () => bitmap.close(),
    };
  } catch {
    return decodeWithImageElement(blob);
  }
}

export async function convertImageToJpeg(blob: Blob, quality = 0.92): Promise<Blob> {
  const source = await decode(blob);
  const canvas = document.createElement("canvas");
  try {
    canvas.width = source.width;
    canvas.height = source.height;
    const context = canvas.getContext("2d", { alpha: false });
    if (context === null) throw new Error("当前浏览器无法转换 JPG 图片");

    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    source.draw(context);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (jpeg) => {
          if (jpeg === null || jpeg.size === 0 || jpeg.type !== "image/jpeg") {
            reject(new Error("JPG 图片转换失败"));
            return;
          }
          resolve(jpeg);
        },
        "image/jpeg",
        quality,
      );
    });
  } finally {
    source.close();
    canvas.width = 1;
    canvas.height = 1;
  }
}
