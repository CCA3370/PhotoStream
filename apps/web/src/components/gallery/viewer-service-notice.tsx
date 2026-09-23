"use client";

import { DownloadIcon, InfoIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  viewerServiceNoticeDismissedEvent,
  viewerServiceNoticeStorageKey,
} from "@/lib/viewer-onboarding";

const dismissCountdownSeconds = 3;

export function ViewerServiceNotice() {
  const [open, setOpen] = useState(false);
  const [dismissCountdown, setDismissCountdown] = useState(dismissCountdownSeconds);
  const [hasReachedEnd, setHasReachedEnd] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [showReadToEndHint, setShowReadToEndHint] = useState(false);
  const [isScrollable, setIsScrollable] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hasUserInteractedWithScrollRef = useRef(false);

  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem(viewerServiceNoticeStorageKey) !== "seen");
    } catch {
      setOpen(true);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setDismissCountdown(dismissCountdownSeconds);
    const timer = window.setInterval(() => {
      setDismissCountdown((current) => {
        if (current <= 1) {
          window.clearInterval(timer);
          return 0;
        }
        return current - 1;
      });
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    setHasReachedEnd(false);
    setAcknowledged(false);
    setShowReadToEndHint(false);
    setIsScrollable(false);
    hasUserInteractedWithScrollRef.current = false;

    let nudgeTimer: number | undefined;
    let returnTimer: number | undefined;

    const frame = window.requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      if (!container) return;

      container.scrollTop = 0;
      const maxScrollTop = container.scrollHeight - container.clientHeight;

      if (maxScrollTop <= 2) {
        setHasReachedEnd(true);
        return;
      }

      setIsScrollable(true);

      const nudgeDistance = Math.min(28, Math.max(8, maxScrollTop / 4));
      const safeNudgeDistance = Math.min(nudgeDistance, Math.max(1, maxScrollTop - 4));

      nudgeTimer = window.setTimeout(() => {
        if (hasUserInteractedWithScrollRef.current) return;
        container.scrollTo({ top: safeNudgeDistance, behavior: "smooth" });

        returnTimer = window.setTimeout(() => {
          if (hasUserInteractedWithScrollRef.current) return;
          container.scrollTo({ top: 0, behavior: "smooth" });
        }, 420);
      }, 450);
    });

    return () => {
      window.cancelAnimationFrame(frame);
      if (nudgeTimer !== undefined) window.clearTimeout(nudgeTimer);
      if (returnTimer !== undefined) window.clearTimeout(returnTimer);
    };
  }, [open]);

  function markScrollInteraction(): void {
    hasUserInteractedWithScrollRef.current = true;
  }

  function handleNoticeScroll(): void {
    const container = scrollContainerRef.current;
    if (!container || hasReachedEnd) return;

    const remaining = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (remaining <= 2) {
      setHasReachedEnd(true);
      setShowReadToEndHint(false);
    }
  }

  function handleAcknowledgementChange(checked: boolean): void {
    if (!hasReachedEnd) {
      setAcknowledged(false);
      setShowReadToEndHint(true);
      return;
    }

    setAcknowledged(checked);
  }

  function dismiss(): void {
    if (dismissCountdown > 0 || !hasReachedEnd || !acknowledged) return;

    try {
      window.localStorage.setItem(viewerServiceNoticeStorageKey, "seen");
    } catch {
      // The notice still closes for this page view when storage is unavailable.
    }
    setOpen(false);
    window.dispatchEvent(new Event(viewerServiceNoticeDismissedEvent));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setOpen(true);
      }}
    >
      <DialogContent
        className="public-theme z-[100] max-h-[calc(100dvh-2rem)] overflow-hidden sm:max-w-md"
        overlayClassName="z-[90]"
        showCloseButton={false}
      >
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
              <InfoIcon aria-hidden="true" className="size-5" />
            </div>
            <DialogTitle className="text-left">照片使用与版权说明</DialogTitle>
          </div>
        </DialogHeader>

        <div className="min-h-0">
          <section
            aria-label="照片使用与版权说明全文"
            className="max-h-[52dvh] space-y-3 overflow-y-auto overscroll-contain pr-1 text-sm leading-6 text-muted-foreground outline-none focus:outline-none focus-visible:outline-none"
            onKeyDown={markScrollInteraction}
            onPointerDown={markScrollInteraction}
            onScroll={handleNoticeScroll}
            onTouchStart={markScrollInteraction}
            onWheel={markScrollInteraction}
            ref={scrollContainerRef}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users need to focus the scroll region to read the full notice.
            tabIndex={0}
          >
            <DialogDescription className="leading-6">
              本网站由学生个人开发者（昵称：CCA3370）开发、维护，作为北航实验学校中学部校团委学生会电视台的活动照片发布平台运行，仅用于校园活动纪实、师生观赏留念及平台许可范围内的下载，不作为长期存储或公开传播平台。
            </DialogDescription>
            <p>
              本平台现场拍摄影像资料版权及相关权益归学校或相应权利人所有，另有署名或约定的除外；自主开发程序及原创界面版权归 CCA3370 所有。由于本平台由个人开发、维护，并综合考虑运行成本、数据留存与隐私保护等因素，活动照片服务将在活动结束后数周内停止。确需留存且获准下载的照片，请尽早保存并妥善保管。
            </p>
            <p>
              未经许可，不得擅自截图、转载、转发、外传、公开发布、二次剪辑或用于商业用途。通过平台正常下载的照片仅限个人留存与校内合理使用，不得再次传播。严禁恶意截取、篡改、传播他人肖像及调侃、造谣等侵权行为。学校可依校规处理，并保留追溯责任的权利；相关问题可通过图片“投诉”功能反馈。
            </p>

            <p className="text-xs leading-5 text-muted-foreground/80">
              请尊重他人肖像与隐私权益，共同维护安全、文明、纯净的校园网络环境。
            </p>
            <div className="flex items-start gap-2.5 rounded-xl border bg-muted/25 px-3.5 py-3 text-foreground">
              <DownloadIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <p className="text-sm font-medium leading-5">
                浏览、下载或使用照片时，请遵守上述版权与肖像使用要求。
              </p>
            </div>
          </section>

          {isScrollable && !hasReachedEnd && (
            <p
              aria-hidden="true"
              className="mt-2 text-center text-xs font-medium text-muted-foreground/80"
            >
              向下滑动阅读全文
            </p>
          )}
        </div>

        <DialogFooter className="gap-3 sm:flex-col sm:items-stretch">
          <div className="space-y-2">
            <label
              className="flex cursor-pointer items-start gap-2.5 text-sm leading-5 text-foreground"
              htmlFor="viewer-service-notice-acknowledgement"
            >
              <Checkbox
                checked={acknowledged}
                className="mt-0.5"
                id="viewer-service-notice-acknowledgement"
                onCheckedChange={handleAcknowledgementChange}
              />
              <span>我已完整阅读并知晓上述照片使用、版权及肖像权益要求。</span>
            </label>
            {showReadToEndHint && !hasReachedEnd && (
              <p
                aria-live="polite"
                className="text-xs font-medium leading-5 text-destructive"
                role="alert"
              >
                请先阅读公告至底部，再勾选确认。
              </p>
            )}
          </div>
          <Button
            className="w-full"
            disabled={dismissCountdown > 0 || !hasReachedEnd || !acknowledged}
            onClick={dismiss}
            type="button"
          >
            {dismissCountdown > 0 ? `我知道了（${dismissCountdown}s）` : "我知道了"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
