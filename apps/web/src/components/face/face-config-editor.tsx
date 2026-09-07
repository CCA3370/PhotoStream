"use client";

import type { FaceConfigView } from "@photostream/contracts";
import { LoaderCircleIcon, RefreshCcwIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { PasswordConfirmDialog } from "@/components/auth/password-confirm-dialog";
import { Alert, AlertTitle } from "@/components/ui/alert";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { clientMutation } from "@/lib/client-api";

const stateLabels: Record<FaceConfigView["indexState"], string> = {
  disabled: "已关闭",
  provisioning: "正在建立索引",
  indexing: "正在索引",
  ready: "可用",
  degraded: "部分任务失败",
  deleting: "正在删除",
  failed: "失败",
};

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Shanghai",
});

function dateTime(value: string | null): string {
  return value === null ? "尚无" : dateTimeFormatter.format(new Date(value));
}

export function FaceConfigEditor({ initial }: Readonly<{ initial: FaceConfigView }>) {
  const [config, setConfig] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePasswordOpen, setDeletePasswordOpen] = useState(false);
  const [statusErrorOpen, setStatusErrorOpen] = useState(false);
  const dialogError =
    error ??
    (statusErrorOpen && config.lastErrorCode !== null
      ? `通用失败码：${config.lastErrorCode}`
      : null);

  function accept(next: FaceConfigView, message: string): void {
    setConfig(next);
    setSaved(message);
  }

  async function toggle(enabled: boolean): Promise<void> {
    if (pending || enabled === config.enabled) return;
    setPending(true);
    setError(null);
    setSaved(null);
    try {
      accept(
        await clientMutation<FaceConfigView>(`/api/v1/albums/${config.albumId}/face-config`, {
          method: "PUT",
          body: { enabled },
        }),
        enabled ? "人脸找图已开启" : "人脸找图已关闭",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "人脸找图开关更新失败");
    } finally {
      setPending(false);
    }
  }

  async function retry(): Promise<void> {
    if (pending) return;
    setPending(true);
    setError(null);
    setSaved(null);
    try {
      accept(
        await clientMutation<FaceConfigView>(`/api/v1/albums/${config.albumId}/face-index/retry`),
        "失败任务已重新排队",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "失败任务重试失败");
    } finally {
      setPending(false);
    }
  }

  async function deleteIndex(password: string): Promise<void> {
    if (deleteConfirmation !== "删除人脸索引") return;
    const next = await clientMutation<FaceConfigView>(
      `/api/v1/albums/${config.albumId}/face-index`,
      {
        method: "DELETE",
        confirmPassword: password,
      },
    );
    accept(next, "整册人脸索引删除任务已建立");
    setDeleteOpen(false);
    setDeleteConfirmation("");
  }

  return (
    <div className="flex flex-col gap-3">
      {saved === null ? null : (
        <Alert>
          <AlertTitle>{saved}</AlertTitle>
        </Alert>
      )}

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="flex items-center justify-between gap-4 px-4 py-3.5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">人脸找图</p>
                <Badge variant={config.indexState === "failed" ? "destructive" : "outline"}>
                  {stateLabels[config.indexState]}
                </Badge>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                开关直接决定观众是否可以使用人脸找图。
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {pending ? <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" /> : null}
              <Switch
                aria-label="人脸找图"
                checked={config.enabled}
                disabled={pending}
                onCheckedChange={(checked) => void toggle(checked)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b py-3.5">
          <CardTitle>索引状态</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <p className="text-sm">
            <span className="block text-muted-foreground">待处理</span>
            {config.counts.pending}
          </p>
          <p className="text-sm">
            <span className="block text-muted-foreground">已索引</span>
            {config.counts.indexed}
          </p>
          <p className="text-sm">
            <span className="block text-muted-foreground">失败</span>
            {config.counts.failed}
          </p>
          <p className="text-sm">
            <span className="block text-muted-foreground">已排除</span>
            {config.counts.excluded}
          </p>
          <p className="text-sm">
            <span className="block text-muted-foreground">最近索引</span>
            {dateTime(config.lastIndexedAt)}
          </p>
          <p className="text-sm">
            <span className="block text-muted-foreground">最近聚类</span>
            {dateTime(config.lastClusteredAt)}
          </p>
          <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-3">
            <Button
              disabled={pending || config.counts.failed === 0}
              onClick={() => void retry()}
              size="sm"
              type="button"
              variant="outline"
            >
              <RefreshCcwIcon data-icon="inline-start" />
              重试失败任务
            </Button>
            {config.lastErrorCode === null ? null : (
              <Button
                onClick={() => setStatusErrorOpen(true)}
                size="sm"
                type="button"
                variant="destructive"
              >
                查看失败详情
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b py-3.5">
          <CardTitle>删除整册人脸索引</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <AlertDialogTrigger render={<Button variant="destructive" />}>
              <Trash2Icon data-icon="inline-start" />
              删除整册索引
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>删除整册人脸索引？</AlertDialogTitle>
              </AlertDialogHeader>
              <Field>
                <FieldLabel htmlFor="face-delete-confirmation">输入“删除人脸索引”确认</FieldLabel>
                <Input
                  id="face-delete-confirmation"
                  onChange={(event) => setDeleteConfirmation(event.currentTarget.value)}
                  value={deleteConfirmation}
                />
              </Field>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction
                  disabled={deleteConfirmation !== "删除人脸索引"}
                  onClick={() => setDeletePasswordOpen(true)}
                  variant="destructive"
                >
                  继续
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>

      <PasswordConfirmDialog
        confirmLabel="删除索引"
        description="请输入当前账号密码。"
        onConfirm={deleteIndex}
        onOpenChange={setDeletePasswordOpen}
        open={deletePasswordOpen}
        title="确认删除整册人脸索引"
        variant="destructive"
      />

      <ErrorDialog
        message={dialogError}
        onClose={() => {
          setError(null);
          setStatusErrorOpen(false);
        }}
        title="人脸功能操作失败"
      />
    </div>
  );
}
