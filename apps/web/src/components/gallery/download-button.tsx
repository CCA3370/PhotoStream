"use client";

import type { DownloadKind } from "@photostream/contracts";
import { DownloadIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { toast } from "@/components/ui/toast";
import { publicMutation } from "@/lib/client-api";

interface SignedDownload {
  readonly url: string;
  readonly filename: string;
  readonly bytes: number;
  readonly expiresAt: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function downloadErrorMessage(caught: unknown): string {
  if (caught instanceof TypeError) {
    return "无法连接图片下载服务，请稍后重试。";
  }
  return caught instanceof Error ? caught.message : "下载失败，请稍后重试。";
}

function jpegFilename(filename: string): string {
  const base = filename.replace(/\.[^./\\]+$/u, "").trim();
  return `${base || "photo"}.jpg`;
}

async function convertImageToJpeg(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { alpha: false });
    if (context === null) throw new Error("当前浏览器无法转换 JPG 图片");

    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (jpeg) => {
          if (jpeg === null) {
            reject(new Error("JPG 图片转换失败"));
            return;
          }
          resolve(jpeg);
        },
        "image/jpeg",
        0.92,
      );
    });
  } finally {
    bitmap.close();
  }
}

function triggerDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

export function DownloadButton({
  bytes,
  className,
  kind,
  label,
  mediaId,
  onSuccess,
  showBytes = true,
  showIcon = true,
  slug,
}: Readonly<{
  bytes: number;
  className?: string;
  kind: DownloadKind;
  label: string;
  mediaId: string;
  onSuccess?: () => void;
  showBytes?: boolean;
  showIcon?: boolean;
  slug: string;
}>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download(): Promise<void> {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const signed = await publicMutation<SignedDownload>(
        `/api/v1/public/albums/${slug}/downloads/${mediaId}/${kind}`,
        { idempotencyKey: crypto.randomUUID() },
      );
      const response = await fetch(signed.url, {
        cache: "no-store",
        credentials: "omit",
        mode: "cors",
      });
      if (!response.ok) throw new Error("图片下载失败，请稍后重试。");

      const sourceBlob = await response.blob();
      let downloadBlob = sourceBlob;
      let filename = signed.filename;
      let converted = false;

      if (kind === "preview") {
        try {
          downloadBlob = await convertImageToJpeg(sourceBlob);
          filename = jpegFilename(signed.filename);
          converted = true;
        } catch {
          // Keep the fetched source image downloadable if this browser cannot encode JPEG.
        }
      }

      triggerDownload(downloadBlob, filename);
      toast.add({
        title: "下载成功",
        description:
          kind === "preview" && !converted
            ? `${filename}（当前浏览器无法转换 JPG，已下载原格式）`
            : filename,
        type: "success",
        timeout: 3_000,
      });
      onSuccess?.();
    } catch (caught) {
      setError(downloadErrorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        className={className}
        disabled={pending}
        onClick={() => void download()}
        type="button"
        variant="outline"
      >
        {showIcon ? <DownloadIcon data-icon="inline-start" /> : null}
        {pending ? "正在准备…" : showBytes ? `${label}（${formatBytes(bytes)}）` : label}
      </Button>
      <ErrorDialog message={error} onClose={() => setError(null)} title="下载失败" />
    </>
  );
}
