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
      const anchor = document.createElement("a");
      anchor.href = signed.url;
      anchor.download = signed.filename;
      anchor.rel = "noopener";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "下载地址签发失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button disabled={pending} onClick={() => void download()} type="button" variant="outline">
        <DownloadIcon data-icon="inline-start" />
        {pending ? "正在准备…" : `${label}（约 ${formatBytes(bytes)}）`}
      </Button>
      {error === null ? null : <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
