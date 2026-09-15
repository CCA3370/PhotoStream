"use client";

import { DownloadIcon, InfoIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
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

  function dismiss(): void {
    if (dismissCountdown > 0) return;
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
        if (nextOpen) {
          setOpen(true);
          return;
        }
        if (dismissCountdown === 0) dismiss();
      }}
    >
      <DialogContent className="public-theme z-[100] sm:max-w-md" overlayClassName="z-[90]">
        <DialogHeader>
          <div className="mb-1 grid size-10 place-items-center rounded-xl bg-muted text-muted-foreground">
            <InfoIcon aria-hidden="true" className="size-5" />
          </div>
          <DialogTitle>请及时保存需要的照片</DialogTitle>
          <DialogDescription>
            本网站由学生个人开发者（昵称：CCA3370）开发、维护，并作为北航实验学校中学部校团委学生会电视台的活动照片发布与服务平台运行，仅用于活动期间及结束后短期提供照片浏览与下载，不作为长期照片存储或备份服务。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm leading-6 text-muted-foreground">
          <p>
            出于服务器与存储成本、隐私保护等方面的考虑，相关活动的照片服务将在活动结束后的数周内停止。
          </p>
          <p>
            服务停止后，该活动相册及其中的照片将无法继续访问、查看或下载。若有需要长期保留的照片，请尽早下载并自行妥善保存。
          </p>
          <p>
            PhotoStream 网站的自主开发程序及原创界面内容版权归 CCA3370 所有；本平台展示的活动照片版权及相关权益归北航实验学校中学部校团委学生会电视台或相应权利人所有，另有署名或约定的除外。未经相应权利人许可，请勿将相关内容用于超出个人合理使用范围的转载、发布或其他用途。
          </p>
          <p className="text-xs leading-5 text-muted-foreground/80">
            顺带一提：开发者明年就毕业了，所以下次运动会大概率不会再有 PhotoStream 了。需要的照片记得早点存下来。
          </p>
          <div className="flex items-start gap-2.5 rounded-xl border bg-muted/25 px-3.5 py-3 text-foreground">
            <DownloadIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <p className="text-sm font-medium leading-5">
              建议在活动结束后尽快完成所需照片的下载。
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            className="sm:min-w-28"
            disabled={dismissCountdown > 0}
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
