"use client";

import { LinkIcon, LoaderCircleIcon, Share2Icon } from "lucide-react";
import { type ComponentProps, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { useWeChatBrowser } from "@/hooks/use-wechat-browser";
import { clientGet, publicMutation } from "@/lib/client-api";
import { cn } from "@/lib/utils";

interface ShareResponse {
  readonly shareId: string;
}

interface ShareView {
  readonly title: string;
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
  variant = "outline",
}: Readonly<{
  className?: string;
  mediaId: string;
  shareId?: string;
  slug: string;
  variant?: ComponentProps<typeof Button>["variant"];
}>) {
  const [pending, setPending] = useState(false);
  const [copyNoticeOpen, setCopyNoticeOpen] = useState(false);
  const weChat = useWeChatBrowser();

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

      if (weChat) {
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
            title: `${share.title} · 影像直播`,
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

      <Button
        className={cn(className)}
        data-photo-share-action
        data-viewer-onboarding-action="share"
        disabled={pending}
        onClick={() => void sharePhoto()}
        type="button"
        variant={variant}
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

      <Dialog open={copyNoticeOpen} onOpenChange={setCopyNoticeOpen}>
        <DialogContent
          className="dark public-theme max-w-[20rem] rounded-2xl border border-white/10 bg-background p-5 text-foreground ring-0 shadow-2xl shadow-black/35"
          overlayClassName="bg-black/45"
          showCloseButton={false}
        >
          <DialogTitle className="text-base font-semibold">链接已复制</DialogTitle>
          <DialogDescription className="mt-2 text-sm leading-6 text-muted-foreground">
            分享链接已复制，可直接粘贴发送给其他人。
          </DialogDescription>
          <div className="mt-1 flex justify-end">
            <Button onClick={() => setCopyNoticeOpen(false)} type="button">
              OK
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
