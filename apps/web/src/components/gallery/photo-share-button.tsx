"use client";

import { LinkIcon, LoaderCircleIcon, Share2Icon } from "lucide-react";
import { useEffect, useState } from "react";
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

async function copyShareLink(value: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText !== undefined) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    // Fall through to the selection-based copy path for WebViews with restricted clipboard APIs.
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.append(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, value.length);
  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) throw new Error("分享链接复制失败，请稍后重试。");
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
  const [copyNoticeOpen, setCopyNoticeOpen] = useState(false);
  const [weChat, setWeChat] = useState(false);

  useEffect(() => {
    setWeChat(isWeChatBrowser());
  }, []);

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
        await copyShareLink(shareUrl);
        setCopyNoticeOpen(true);
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

      await copyShareLink(shareUrl);
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
      <style>{`
        button[data-photo-share-action] + button:has(svg.lucide-download) {
          font-size: 0 !important;
        }

        button[data-photo-share-action] + button:has(svg.lucide-download)::after {
          content: "保存至相册";
          font-size: 0.875rem;
          line-height: 1.25rem;
          white-space: nowrap;
        }

        @media (max-width: 639px) {
          button[data-photo-share-action] {
            flex: 0.85 1 0% !important;
            padding-inline: 0.625rem !important;
          }

          button[data-photo-share-action] + button:has(svg.lucide-download) {
            flex: 1.15 1 0% !important;
            padding-inline: 0.75rem !important;
          }

          button[data-photo-share-action] + button:has(svg.lucide-download)::after {
            font-size: 0.8125rem;
            line-height: 1rem;
          }
        }
      `}</style>

      <Button
        className={cn(className)}
        data-photo-share-action
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
        ) : weChat ? (
          <LinkIcon data-icon="inline-start" />
        ) : (
          <Share2Icon data-icon="inline-start" />
        )}
        {weChat ? "复制链接" : "分享"}
      </Button>

      {copyNoticeOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              aria-describedby="wechat-copy-notice-description"
              aria-labelledby="wechat-copy-notice-title"
              aria-modal="true"
              className="dark public-theme fixed inset-0 z-[400] grid place-items-center bg-black/45 px-5"
              role="alertdialog"
            >
              <div className="w-full max-w-[20rem] rounded-2xl border border-white/10 bg-background p-5 text-foreground shadow-2xl shadow-black/35">
                <p className="text-base font-semibold" id="wechat-copy-notice-title">
                  链接已复制
                </p>
                <p
                  className="mt-2 text-sm leading-6 text-muted-foreground"
                  id="wechat-copy-notice-description"
                >
                  分享链接已复制，可直接粘贴发送给其他人。
                </p>
                <div className="mt-5 flex justify-end">
                  <Button autoFocus onClick={() => setCopyNoticeOpen(false)} type="button">
                    OK
                  </Button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
