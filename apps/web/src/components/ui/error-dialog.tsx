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
        className={
          nested
            ? "layer-nested-dialog min-w-0 overflow-hidden sm:max-w-md"
            : "min-w-0 overflow-hidden sm:max-w-md"
        }
        forceOverlay={nested}
        {...(nested ? { overlayClassName: "layer-nested-dialog-overlay" } : {})}
      >
        <DialogHeader className="min-w-0">
          <div className="flex w-full min-w-0 max-w-full items-start gap-3 pr-7">
            <div className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive">
              <CircleAlertIcon aria-hidden="true" className="size-5" />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-hidden">
              <DialogTitle className="min-w-0">{title}</DialogTitle>
              <DialogDescription className="min-w-0 max-h-[min(60dvh,32rem)] max-w-full overflow-x-hidden overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere]">
                {message ?? "发生未知错误"}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogFooter className="min-w-0">
          <Button onClick={onClose} type="button">
            确定
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
