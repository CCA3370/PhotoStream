"use client";

import { isAppleMobileWebKit, isAppleWebKit } from "@/lib/apple-webkit";

export interface PreparedUploadInput {
  readonly file: File;
  readonly sourceFileName: string;
  readonly sourceHash: string;
  readonly allowDuplicate?: boolean;
}

const directlySupportedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const heicTypes = new Set(["image/heic", "image/heif"]);

function extension(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  return index < 0 ? "" : fileName.slice(index).toLowerCase();
}

export function isSupportedUploadInput(file: File): boolean {
  return (
    directlySupportedTypes.has(file.type) ||
    heicTypes.has(file.type) ||
    [".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"].includes(extension(file.name))
  );
}

export function isHeicUploadInput(file: File): boolean {
  return heicTypes.has(file.type) || [".heic", ".heif"].includes(extension(file.name));
}

export async function sha256Blob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function decode(file: File): Promise<{
  readonly width: number;
  readonly height: number;
  draw(context: CanvasRenderingContext2D): void;
  close(): void;
}> {
  if (!isAppleWebKit() && typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw: (context) => context.drawImage(bitmap, 0, 0),
        close: () => bitmap.close(),
      };
    } catch {
      // Some browsers expose HEIC files but only decode them through HTMLImageElement.
    }
  }

  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  const loaded = new Promise<void>((resolve, reject) => {
    image.addEventListener("load", () => resolve(), { once: true });
    image.addEventListener(
      "error",
      () => reject(new Error("此设备无法解码 HEIC/HEIF，请先在系统相册中导出为 JPEG 后再上传。")),
      { once: true },
    );
  });
  image.src = url;
  try {
    if (typeof image.decode === "function") {
      await Promise.race([image.decode(), loaded]).catch(async () => {
        await loaded;
      });
    } else {
      await loaded;
    }
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  return {
    width: image.naturalWidth,
    height: image.naturalHeight,
    draw: (context) => context.drawImage(image, 0, 0),
    close: () => URL.revokeObjectURL(url),
  };
}

function canvasJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null || blob.size === 0) {
          reject(new Error("HEIC/HEIF 转 JPEG 失败"));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      0.92,
    );
  });
}

async function convertHeicToJpeg(file: File): Promise<File> {
  const source = await decode(file);
  const canvas = document.createElement("canvas");
  try {
    // A full-resolution 24/48 MP HEIC canvas can exceed WebKit's per-tab memory budget.
    // Keep useful photo resolution while bounding the backing-store allocation on Apple devices.
    const maxEdge = isAppleMobileWebKit() ? 4_096 : isAppleWebKit() ? 6_144 : 8_192;
    const scale = Math.min(1, maxEdge / Math.max(source.width, source.height));
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (context === null) throw new Error("当前浏览器无法转换 HEIC/HEIF");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.save();
    context.scale(width / source.width, height / source.height);
    source.draw(context);
    context.restore();
    const jpeg = await canvasJpeg(canvas);
    const baseName = file.name.replace(/\.(?:heic|heif)$/iu, "") || "photo";
    return new File([jpeg], `${baseName}.jpg`, {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } finally {
    source.close();
    canvas.width = 1;
    canvas.height = 1;
  }
}

export async function prepareUploadInput(file: File): Promise<PreparedUploadInput> {
  if (file.size <= 0 || file.size > 50 * 1024 * 1024) {
    throw new Error("单张照片必须大于 0 且不超过 50MB");
  }
  const sourceHash = await sha256Blob(file);
  const prepared = isHeicUploadInput(file) ? await convertHeicToJpeg(file) : file;
  return {
    file: prepared,
    sourceFileName: file.name,
    sourceHash,
  };
}
