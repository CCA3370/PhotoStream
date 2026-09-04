"use client";

import type { DeletionTaskView } from "@photostream/contracts";
import { Trash2Icon } from "lucide-react";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { clientMutation } from "@/lib/client-api";

export function DeleteMediaButton({
  albumTitle,
  mediaId,
  onTask,
}: Readonly<{
  albumTitle: string;
  mediaId: string;
  onTask: (task: DeletionTaskView) => void;
}>) {
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function remove(): Promise<void> {
    if (pending || confirmation !== albumTitle) return;
    setPending(true);
    setError(null);
    try {
      const task = await clientMutation<DeletionTaskView>(`/api/v1/media/${mediaId}`, {
        method: "DELETE",
        body: { confirmation },
      });
      onTask(task);
      setOpen(false);
      setConfirmation("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除任务创建失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger render={<Button size="sm" variant="destructive" />}>
          <Trash2Icon data-icon="inline-start" />
          永久删除
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>永久删除该媒体？</AlertDialogTitle>
            <AlertDialogDescription>
              系统将先隐藏媒体，再逐对象删除并刷新 CDN。全部成功前只显示“删除处理中”；完成后不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Field data-invalid={error === null ? undefined : true}>
            <FieldLabel htmlFor={`delete-confirm-${mediaId}`}>
              输入相册标题“{albumTitle}”确认
            </FieldLabel>
            <Input
              aria-invalid={error === null ? undefined : true}
              id={`delete-confirm-${mediaId}`}
              onChange={(event) => setConfirmation(event.currentTarget.value)}
              value={confirmation}
            />
            <FieldDescription>删除失败可从同一持久任务重试，不会谎报成功。</FieldDescription>
          </Field>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending || confirmation !== albumTitle}
              onClick={() => void remove()}
              variant="destructive"
            >
              {pending ? "正在建立任务…" : "确认永久删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ErrorDialog message={error} onClose={() => setError(null)} title="删除失败" />
    </>
  );
}
