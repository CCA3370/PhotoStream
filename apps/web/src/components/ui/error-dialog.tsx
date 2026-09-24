"use client";

import { CircleAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function ErrorDialog({
  message,
  nested = false,
  onClose,
  title = "操作失败",
}: Readonly<{
  message: string | null;
  nested?: boolean;
  onClose: () => void;
  title?: string;
}>) {
  return (
    <Dialog open={message !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={nested ? "layer-nested-dialog sm:max-w-md" : "sm:max-w-md"}
        forceOverlay={nested}
        overlayClassName={nested ? "layer-nested-dialog-overlay" : undefined}
      >
        <DialogHeader>
          <div className="flex items-start gap-3 pr-7">
            <div className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive">
              <CircleAlertIcon aria-hidden="true" className="size-5" />
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription className="whitespace-pre-wrap break-words">
                {message ?? "发生未知错误"}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onClose} type="button">
            确定
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
