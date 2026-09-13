"use client";

import type { PublicAlbumView } from "@photostream/contracts";
import { LoaderCircleIcon, Share2Icon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { clientGet, publicMutation } from "@/lib/client-api";
import { cn } from "@/lib/utils";

interface ShareResponse {
  readonly shareId: string;
}

export function PhotoShareButton({
  className,
  mediaId,
  shareId,
  slug,
}: Readonly<{
  className?: string;
  mediaId: string;
  shareId?: string;
  slug: string;
}>) {
  const [pending, setPending] = useState(false);

  async function sharePhoto(): Promise<void> {
    if (pending) return;
    setPending(true);
    try {
      let resolvedShareId = shareId;
      if (resolvedShareId === undefined) {
        const album = await clientGet<PublicAlbumView>(
          `/api/v1/public/albums/${encodeURIComponent(slug)}`,
        );
        if (album.access === "password") {
          resolvedShareId = (
            await publicMutation<ShareResponse>(
              `/api/v1/public/albums/${encodeURIComponent(slug)}/media/${encodeURIComponent(mediaId)}/share`,
            )
          ).shareId;
        }
      }

      const url = new URL(`/g/${encodeURIComponent(slug)}`, window.location.origin);
      url.searchParams.set("photo", mediaId);
      if (resolvedShareId !== undefined) url.searchParams.set("share", resolvedShareId);
      const shareUrl = url.toString();

      if (typeof navigator.share === "function") {
        try {
          await navigator.share({
            title: "分享照片",
            text: "在 PhotoStream 中查看这张照片",
            url: shareUrl,
          });
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") return;
        }
      }

      await navigator.clipboard.writeText(shareUrl);
      toast.add({
        title: "分享链接已复制",
        description:
          resolvedShareId === undefined
            ? "对方打开链接即可直达这张照片。"
            : "对方打开链接即可直接查看这张照片，无需输入相册口令。",
        type: "success",
        timeout: 3_000,
      });
    } catch (caught) {
      toast.add({
        title: "分享失败",
        description: caught instanceof Error ? caught.message : "暂时无法创建分享链接，请稍后重试。",
        type: "error",
        timeout: 4_000,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      className={cn(className)}
      disabled={pending}
      onClick={() => void sharePhoto()}
      type="button"
      variant="outline"
    >
      {pending ? (
        <LoaderCircleIcon
          aria-hidden="true"
          className="animate-spin motion-reduce:animate-none"
          data-icon="inline-start"
        />
      ) : (
        <Share2Icon data-icon="inline-start" />
      )}
      分享
    </Button>
  );
}
