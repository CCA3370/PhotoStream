"use client";

import { ArrowUpRightIcon, LoaderCircleIcon, Share2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { clientGet, publicMutation } from "@/lib/client-api";
import { cn } from "@/lib/utils";

interface ShareResponse {
  readonly shareId: string;
}

interface ShareView {
  readonly title: string;
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
      const resolvedShareId =
        shareId ??
        (
          await publicMutation<ShareResponse>(
            `/api/v1/public/albums/${encodeURIComponent(slug)}/media/${encodeURIComponent(mediaId)}/share`,
          )
        ).shareId;

      const shareUrl = new URL(
        `/s/${encodeURIComponent(resolvedShareId)}`,
        window.location.origin,
      ).toString();

      if (isWeChatBrowser()) {
        previousUrlRef.current ??= window.location.href;
        window.history.replaceState(window.history.state, "", shareUrl);
        setWeChatGuideOpen(true);
        return;
      }

      if (typeof navigator.share === "function") {
        try {
          const share = await clientGet<ShareView>(
            `/api/v1/public/shares/${encodeURIComponent(resolvedShareId)}`,
          );
          await navigator.share({
            title: `${share.title} · PhotoStream`,
            text: `查看「${share.title}」活动中的这张照片`,
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
        description: "对方打开链接即可直接查看这张照片，无需输入相册口令。",
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
              className="dark public-theme fixed inset-0 z-[300] bg-black/40 text-white transition-opacity duration-150"
              role="dialog"
            >
              <button
                aria-label="关闭分享提示"
                className="absolute inset-0 cursor-pointer"
                onClick={closeWeChatGuide}
                type="button"
              />

              <div className="pointer-events-none absolute top-[max(0.55rem,env(safe-area-inset-top))] right-2.5 flex max-w-[calc(100vw-1.25rem)] flex-col items-end sm:right-4">
                <ArrowUpRightIcon
                  aria-hidden="true"
                  className="mr-1 size-10 shrink-0 drop-shadow-[0_2px_6px_rgba(0,0,0,0.55)]"
                />
                <div className="mt-1 max-w-[17rem] rounded-2xl border border-white/12 bg-black/78 px-4 py-3 text-right shadow-2xl shadow-black/35 backdrop-blur-md">
                  <p className="text-[15px] font-semibold leading-5" id="wechat-share-guide-title">
                    点击右上角 ··· 分享
                  </p>
                  <p
                    className="mt-1 text-xs leading-5 text-white/68"
                    id="wechat-share-guide-description"
                  >
                    选择「转发给朋友」或「分享到朋友圈」
                  </p>
                </div>
              </div>

              <div className="pointer-events-none absolute inset-x-0 top-[62%] flex justify-center px-5">
                <span className="rounded-full border border-white/10 bg-black/42 px-4 py-2 text-sm text-white/72 shadow-lg shadow-black/20 backdrop-blur-md">
                  点击任意位置关闭提示
                </span>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
