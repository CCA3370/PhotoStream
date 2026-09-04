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
  onClose,
  title = "操作失败",
}: Readonly<{
  message: string | null;
  onClose: () => void;
  title?: string;
}>) {
  return (
    <Dialog open={message !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-start gap-3 pr-7">
            <div className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive">
              <CircleAlertIcon aria-hidden="true" className="size-5" />
            </div>
            <div className="min-w-0 space-y-2">
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
