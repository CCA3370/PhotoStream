"use client";

import type { PublicAlbumView } from "@photostream/contracts";
import { ArrowUpRightIcon, LoaderCircleIcon, Share2Icon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { clientGet, publicMutation } from "@/lib/client-api";
import { cn } from "@/lib/utils";

interface ShareResponse {
  readonly shareId: string;
}

function isWeChatBrowser(): boolean {
  return typeof navigator !== "undefined" && /MicroMessenger/i.test(navigator.userAgent);
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
  const [weChatGuideOpen, setWeChatGuideOpen] = useState(false);
  const previousUrlRef = useRef<string | null>(null);

  function closeWeChatGuide(): void {
    const previousUrl = previousUrlRef.current;
    if (previousUrl !== null) {
      window.history.replaceState(window.history.state, "", previousUrl);
      previousUrlRef.current = null;
    }
    setWeChatGuideOpen(false);
  }

  useEffect(
    () => () => {
      const previousUrl = previousUrlRef.current;
      if (previousUrl !== null) {
        window.history.replaceState(window.history.state, "", previousUrl);
        previousUrlRef.current = null;
      }
    },
    [],
  );

  async function sharePhoto(): Promise<void> {
    if (pending) return;
    setPending(true);
    try {
      const album = await clientGet<PublicAlbumView>(
        `/api/v1/public/albums/${encodeURIComponent(slug)}`,
      );
      let resolvedShareId = shareId;
      if (resolvedShareId === undefined && album.access === "password") {
        resolvedShareId = (
          await publicMutation<ShareResponse>(
            `/api/v1/public/albums/${encodeURIComponent(slug)}/media/${encodeURIComponent(mediaId)}/share`,
          )
        ).shareId;
      }

      const url = new URL(`/g/${encodeURIComponent(slug)}`, window.location.origin);
      url.searchParams.set("photo", mediaId);
      if (resolvedShareId !== undefined) url.searchParams.set("share", resolvedShareId);
      const shareUrl = url.toString();

      if (isWeChatBrowser()) {
        previousUrlRef.current ??= window.location.href;
        window.history.replaceState(window.history.state, "", shareUrl);
        setWeChatGuideOpen(true);
        return;
      }

      if (typeof navigator.share === "function") {
        try {
          await navigator.share({
            title: `${album.title} · PhotoStream`,
            text: `查看「${album.title}」活动中的这张照片`,
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
        description:
          caught instanceof Error ? caught.message : "暂时无法创建分享链接，请稍后重试。",
        type: "error",
        timeout: 4_000,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <>
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

      {weChatGuideOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              aria-describedby="wechat-share-guide-description"
              aria-labelledby="wechat-share-guide-title"
              aria-modal="true"
              className="dark public-theme fixed inset-0 z-[300] bg-black/72 text-white backdrop-blur-[2px]"
              role="dialog"
            >
              <div className="pointer-events-none absolute top-[max(0.85rem,env(safe-area-inset-top))] right-3 flex items-start gap-2 sm:right-5">
                <div className="mt-10 rounded-2xl border border-white/10 bg-black/65 px-4 py-3 text-right shadow-xl shadow-black/30 backdrop-blur-xl">
                  <p className="text-sm font-semibold">点这里分享</p>
                  <p className="mt-1 max-w-52 text-xs leading-5 text-white/68">
                    点击微信右上角 ···，选择「转发给朋友」或「分享到朋友圈」
                  </p>
                </div>
                <ArrowUpRightIcon aria-hidden="true" className="mt-1 size-9 shrink-0 text-white" />
              </div>

              <div className="pointer-events-none absolute inset-x-5 top-1/2 -translate-y-1/2 text-center">
                <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/12 backdrop-blur-md">
                  <Share2Icon aria-hidden="true" className="size-6" />
                </div>
                <h2 className="mt-4 text-xl font-semibold tracking-tight" id="wechat-share-guide-title">
                  分享这张照片
                </h2>
                <p
                  className="mx-auto mt-2 max-w-xs text-sm leading-6 text-white/68"
                  id="wechat-share-guide-description"
                >
                  已准备好这张照片的直达链接。请使用微信右上角菜单完成分享。
                </p>
              </div>

              <div className="absolute inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] flex justify-center px-5">
                <Button
                  className="min-w-28 rounded-full border-white/15 bg-white/10 text-white backdrop-blur-xl hover:bg-white/16 hover:text-white"
                  onClick={closeWeChatGuide}
                  type="button"
                  variant="outline"
                >
                  <XIcon data-icon="inline-start" />
                  关闭提示
                </Button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
