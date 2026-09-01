"use client";

import type { FaceConfigView } from "@photostream/contracts";
import { UserRoundXIcon } from "lucide-react";
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
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { clientMutation } from "@/lib/client-api";

const confirmationText = "排除选中照片";

export function FaceIndexExclusionButton({
  albumId,
  mediaIds,
  onExcluded,
}: Readonly<{
  albumId: string;
  mediaIds: readonly string[];
  onExcluded: (message: string) => void;
}>) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const validCount = mediaIds.length > 0 && mediaIds.length <= 200;

  async function exclude(): Promise<void> {
    if (!validCount || pending || confirmation !== confirmationText) return;
    setPending(true);
    setError(null);
    try {
      const config = await clientMutation<FaceConfigView>(
        `/api/v1/albums/${albumId}/face-index/exclusions`,
        { body: { mediaIds } },
      );
      onExcluded(
        `已将 ${mediaIds.length} 张照片持久排除；当前共 ${config.counts.excluded} 张排除，供应商删除会在后台确认。`,
      );
      setOpen(false);
      setConfirmation("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "照片退出人脸索引失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger disabled={!validCount} render={<Button size="sm" variant="outline" />}>
        <UserRoundXIcon data-icon="inline-start" />
        退出人脸索引
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>让选中的 {mediaIds.length} 张照片退出人脸索引？</AlertDialogTitle>
          <AlertDialogDescription>
            本地门禁会立即阻止这些照片进入人脸结果，并持久重试供应商元数据删除。隐藏、恢复或重新发布都不会自动取消排除；普通相册照片不受影响。此操作需要近期认证。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Field data-invalid={error === null ? undefined : true}>
          <FieldLabel htmlFor="face-exclusion-confirmation">
            输入“{confirmationText}”二次确认
          </FieldLabel>
          <Input
            aria-invalid={error === null ? undefined : true}
            id="face-exclusion-confirmation"
            onChange={(event) => setConfirmation(event.currentTarget.value)}
            value={confirmation}
          />
          <FieldDescription>
            {error ?? (validCount ? "单次最多处理 200 张照片。" : "请选择 1–200 张照片后操作。")}
          </FieldDescription>
        </Field>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending || !validCount || confirmation !== confirmationText}
            onClick={() => void exclude()}
            variant="destructive"
          >
            {pending ? "正在建立任务…" : "确认持久排除"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
