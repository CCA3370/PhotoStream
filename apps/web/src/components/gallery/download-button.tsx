"use client";

import type { DownloadKind } from "@photostream/contracts";
import { DownloadIcon, XIcon } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { toast } from "@/components/ui/toast";
import { publicMutation } from "@/lib/client-api";

import { loadDerivedImage } from "@/lib/derived-image-cache";
import { loadOriginalImage } from "@/lib/original-image-cache";

interface SignedDownload {
  readonly url: string;
  readonly filename: string;
  readonly bytes: number;
  readonly expiresAt: string;
}

interface WeixinJsBridgeLike {
  invoke: (method: string, params: Record<string, unknown>) => void;
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

function isWeChatBrowser(): boolean {
  return typeof navigator !== "undefined" && /MicroMessenger/i.test(navigator.userAgent);
}

function openWeChatImagePreview(url: string): boolean {
  if (typeof window === "undefined") return false;
  const bridge = (window as typeof window & { WeixinJSBridge?: WeixinJsBridgeLike }).WeixinJSBridge;
  if (bridge === undefined) return false;
  try {
    bridge.invoke("imagePreview", { current: url, urls: [url] });
    return true;
  } catch {
    return false;
  }
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
  shareId,
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
  shareId?: string;
  showBytes?: boolean;
  showIcon?: boolean;
  slug: string;
}>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [weChat, setWeChat] = useState(false);
  const [savePreviewUrl, setSavePreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    setWeChat(isWeChatBrowser());
  }, []);

  async function download(): Promise<void> {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const endpoint =
        shareId === undefined
          ? `/api/v1/public/albums/${encodeURIComponent(slug)}/downloads/${encodeURIComponent(mediaId)}/${kind}`
          : `/api/v1/public/albums/${encodeURIComponent(slug)}/shared/${encodeURIComponent(mediaId)}/downloads/${kind}?share=${encodeURIComponent(shareId)}`;
      const signed = await publicMutation<SignedDownload>(endpoint, {
        idempotencyKey: crypto.randomUUID(),
      });

      if (weChat) {
        if (!openWeChatImagePreview(signed.url)) {
          setSavePreviewUrl(signed.url);
        }
        onSuccess?.();
        return;
      }

      const sourceBlob =
        kind === "preview"
          ? await loadDerivedImage({
              scope: slug,
              mediaId,
              kind: "photo_1920",
              bytes: signed.bytes,
              sourceUrl: signed.url,
            })
          : await loadOriginalImage({
              slug,
              mediaId,
              expectedBytes: signed.bytes,
              sourceUrl: signed.url,
            });
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

  const actionLabel = weChat ? (kind === "original" ? "保存到相册" : "保存图片") : label;

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
        {pending ? "正在准备…" : showBytes ? `${actionLabel}（${formatBytes(bytes)}）` : actionLabel}
      </Button>
      <ErrorDialog message={error} onClose={() => setError(null)} title="下载失败" />

      {savePreviewUrl === null ? null : (
        <div className="fixed inset-0 z-[100] bg-black text-white">
          <Image
            alt="待保存照片"
            className="object-contain"
            fill
            priority
            sizes="100vw"
            src={savePreviewUrl}
            unoptimized
          />
          <Button
            aria-label="关闭保存预览"
            className="absolute top-[max(0.75rem,env(safe-area-inset-top))] right-3 z-10 size-11 rounded-full border-white/15 bg-black/45 text-white backdrop-blur-md hover:bg-black/60 hover:text-white"
            onClick={() => setSavePreviewUrl(null)}
            size="icon"
            type="button"
            variant="outline"
          >
            <XIcon />
          </Button>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 to-transparent px-4 pt-16 pb-[max(1rem,env(safe-area-inset-bottom))] text-center text-sm font-medium">
            长按图片，选择“保存到相册”
          </div>
        </div>
      )}
    </>
  );
}
