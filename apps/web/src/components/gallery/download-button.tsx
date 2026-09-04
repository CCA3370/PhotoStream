"use client";

import type { DownloadKind } from "@photostream/contracts";
import { DownloadIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
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
      });
      if (!response.ok) throw new Error("图片下载失败，请稍后重试");

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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "下载失败，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button disabled={pending} onClick={() => void download()} type="button" variant="outline">
        <DownloadIcon data-icon="inline-start" />
        {pending ? "正在下载…" : `${label}（约 ${formatBytes(bytes)}）`}
      </Button>
      {error === null ? null : <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
