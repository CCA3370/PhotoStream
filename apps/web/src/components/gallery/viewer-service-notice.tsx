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

const noticeStorageKey = "photostream:viewer-service-notice:v1";

export function ViewerServiceNotice() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem(noticeStorageKey) !== "seen");
    } catch {
      setOpen(true);
    }
  }, []);

  function dismiss(): void {
    try {
      window.localStorage.setItem(noticeStorageKey, "seen");
    } catch {
      // The notice still closes for this page view when storage is unavailable.
    }
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setOpen(true);
          return;
        }
        dismiss();
      }}
    >
      <DialogContent className="public-theme sm:max-w-md">
        <DialogHeader>
          <div className="mb-1 grid size-10 place-items-center rounded-xl bg-muted text-muted-foreground">
            <InfoIcon aria-hidden="true" className="size-5" />
          </div>
          <DialogTitle>请及时保存需要的照片</DialogTitle>
          <DialogDescription>
            本网站由学生个人开发、维护，仅用于活动期间及结束后短期提供照片浏览与下载，不作为长期照片存储或备份服务。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm leading-6 text-muted-foreground">
          <p>
            出于服务器与存储成本、隐私保护等方面的考虑，相关活动的照片服务将在活动结束后的数周内停止。
          </p>
          <p>
            服务停止后，该活动相册及其中的照片将无法继续访问、查看或下载。若有需要长期保留的照片，请尽早下载并自行妥善保存。
          </p>
          <div className="flex items-start gap-2.5 rounded-xl border bg-muted/25 px-3.5 py-3 text-foreground">
            <DownloadIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <p className="text-sm font-medium leading-5">建议在活动结束后尽快完成所需照片的下载。</p>
          </div>
        </div>

        <DialogFooter>
          <Button className="sm:min-w-24" onClick={dismiss} type="button">
            我知道了
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
