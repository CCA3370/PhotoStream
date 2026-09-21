"use client";

import type { DownloadKind } from "@photostream/contracts";
import { DownloadIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { toast } from "@/components/ui/toast";
import { publicMutation } from "@/lib/client-api";
import { loadDerivedImage } from "@/lib/derived-image-cache";
import { convertImageToJpeg } from "@/lib/image-jpeg";
import { loadOriginalImage } from "@/lib/original-image-cache";

export interface WeChatDownloadSource {
  readonly url: string;
  readonly filename: string;
  readonly bytes: number;
  readonly expiresAt: string;
}

type SignedDownload = WeChatDownloadSource;

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
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
  onWeChatSave,
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
  onWeChatSave?: (source: WeChatDownloadSource) => Promise<void> | void;
  shareId?: string;
  showBytes?: boolean;
  showIcon?: boolean;
  slug: string;
}>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [weChat, setWeChat] = useState(false);

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
          : `/api/v1/public/shares/${encodeURIComponent(shareId)}/downloads/${kind}`;
      const signed = await publicMutation<SignedDownload>(endpoint, {
        idempotencyKey: crypto.randomUUID(),
      });

      if (weChat && onWeChatSave !== undefined) {
        await onWeChatSave(signed);
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
        {pending ? "正在准备…" : showBytes || weChat ? `${label}（${formatBytes(bytes)}）` : label}
      </Button>
      <ErrorDialog message={error} onClose={() => setError(null)} title="下载失败" />
    </>
  );
}
