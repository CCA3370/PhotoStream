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

export function DownloadButton({
  bytes,
  kind,
  label,
  mediaId,
  slug,
}: Readonly<{
  bytes: number;
  kind: DownloadKind;
  label: string;
  mediaId: string;
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

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = signed.filename;
      anchor.rel = "noopener";
      anchor.style.display = "none";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      toast.add({
        title: "下载成功",
        description: signed.filename,
        type: "success",
        timeout: 3_000,
      });
    } catch (caught) {
      setError(downloadErrorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button disabled={pending} onClick={() => void download()} type="button" variant="outline">
        <DownloadIcon data-icon="inline-start" />
        {pending ? "正在下载…" : `${label}（约 ${formatBytes(bytes)}）`}
      </Button>
      <ErrorDialog message={error} onClose={() => setError(null)} title="下载失败" />
    </>
  );
}
