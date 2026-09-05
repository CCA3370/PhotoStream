"use client";

import type { DeletionTaskView } from "@photostream/contracts";
import { Trash2Icon } from "lucide-react";
import { useState } from "react";

import { PasswordConfirmDialog } from "@/components/auth/password-confirm-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
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
  const [open, setOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);

  async function remove(password: string): Promise<void> {
    if (confirmation !== albumTitle) return;
    const task = await clientMutation<DeletionTaskView>(`/api/v1/media/${mediaId}`, {
      method: "DELETE",
      body: { confirmation },
      confirmPassword: password,
    });
    onTask(task);
    setConfirmation("");
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
          </AlertDialogHeader>
          <Field>
            <FieldLabel htmlFor={`delete-confirm-${mediaId}`}>
              输入相册标题“{albumTitle}”确认
            </FieldLabel>
            <Input
              id={`delete-confirm-${mediaId}`}
              onChange={(event) => setConfirmation(event.currentTarget.value)}
              value={confirmation}
            />
          </Field>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmation !== albumTitle}
              onClick={() => setPasswordOpen(true)}
              variant="destructive"
            >
              继续
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PasswordConfirmDialog
        confirmLabel="永久删除"
        description="请输入当前账号密码。"
        onConfirm={remove}
        onOpenChange={setPasswordOpen}
        open={passwordOpen}
        title="确认永久删除"
        variant="destructive"
      />
    </>
  );
}
