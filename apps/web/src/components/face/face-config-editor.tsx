"use client";

import type { FaceConfigUpdate, FaceConfigView } from "@photostream/contracts";
import { RefreshCcwIcon, Trash2Icon } from "lucide-react";
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
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
  const [enabled, setEnabled] = useState(initial.enabled);
  const [retentionDays, setRetentionDays] = useState(String(initial.retentionDays));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePasswordOpen, setDeletePasswordOpen] = useState(false);
  const [savePasswordOpen, setSavePasswordOpen] = useState(false);
  const [statusErrorOpen, setStatusErrorOpen] = useState(false);

  const parsedRetentionDays = Number(retentionDays);
  const retentionValid =
    Number.isInteger(parsedRetentionDays) && parsedRetentionDays >= 1 && parsedRetentionDays <= 30;
  const dialogError =
    error ??
    (statusErrorOpen && config.lastErrorCode !== null
      ? `通用失败码：${config.lastErrorCode}`
      : null);

  function accept(next: FaceConfigView, message: string): void {
    setConfig(next);
    setEnabled(next.enabled);
    setRetentionDays(String(next.retentionDays));
    setSaved(message);
  }

  function currentBody(): FaceConfigUpdate {
    return {
      enabled,
      noticeVersion: config.noticeVersion ?? "managed-by-server",
      retentionDays: parsedRetentionDays,
      readiness: {
        participantConsentRecordsConfirmed: config.readiness.participantConsentRecordsConfirmed,
        guardianConsentRequirementsConfirmed: config.readiness.guardianConsentRequirementsConfirmed,
        impactAssessmentCompleted: config.readiness.impactAssessmentCompleted,
        providerResourcesValidated: config.readiness.providerResourcesValidated,
        evaluationGatePassed: config.readiness.evaluationGatePassed,
        billingAlertsConfigured: config.readiness.billingAlertsConfigured,
        indexedFacesAuthorized: config.readiness.indexedFacesAuthorized,
      },
    };
  }

  async function performSave(password?: string): Promise<void> {
    if (pending || !retentionValid) return;
    setPending(true);
    setError(null);
    setSaved(null);
    try {
      accept(
        await clientMutation<FaceConfigView>(`/api/v1/albums/${config.albumId}/face-config`, {
          method: "PUT",
          body: currentBody(),
          ...(password === undefined ? {} : { confirmPassword: password }),
        }),
        enabled ? "人脸找图设置已保存" : "人脸找图已关闭",
      );
    } catch (caught) {
      if (password !== undefined) throw caught;
      setError(caught instanceof Error ? caught.message : "人脸找图配置保存失败");
    } finally {
      setPending(false);
    }
  }

  function save(): void {
    if (enabled !== config.enabled) {
      setSavePasswordOpen(true);
      return;
    }
    void performSave();
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
    <div className="flex flex-col gap-4">
      {saved === null ? null : (
        <Alert>
          <AlertTitle>{saved}</AlertTitle>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            索引状态
            <Badge variant={config.indexState === "failed" ? "destructive" : "outline"}>
              {stateLabels[config.indexState]}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
            <span className="block text-muted-foreground">授权核验时间</span>
            {dateTime(config.authorizationConfirmedAt)}
          </p>
          <p className="text-sm">
            <span className="block text-muted-foreground">最近索引</span>
            {dateTime(config.lastIndexedAt)}
          </p>
          <p className="text-sm">
            <span className="block text-muted-foreground">最近聚类</span>
            {dateTime(config.lastClusteredAt)}
          </p>
          <p className="text-sm">
            <span className="block text-muted-foreground">删除期限</span>
            {dateTime(config.deletionDueAt)}
          </p>
          {config.lastErrorCode === null ? null : (
            <div className="sm:col-span-2 lg:col-span-4">
              <Button
                onClick={() => setStatusErrorOpen(true)}
                size="sm"
                type="button"
                variant="destructive"
              >
                查看失败详情
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="face-retention-days">索引保留天数</FieldLabel>
              <Input
                id="face-retention-days"
                max={30}
                min={1}
                onChange={(event) => setRetentionDays(event.currentTarget.value)}
                type="number"
                value={retentionDays}
              />
              <FieldDescription>1–30 天</FieldDescription>
            </Field>
            <Field orientation="horizontal">
              <FieldLabel className="flex-1" htmlFor="face-enabled">
                启用观众人脸找图
              </FieldLabel>
              <Switch
                checked={enabled}
                disabled={pending}
                id="face-enabled"
                onCheckedChange={setEnabled}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button disabled={pending || !retentionValid} onClick={save} type="button">
                {pending ? "正在处理…" : "保存"}
              </Button>
              <Button
                disabled={pending || config.counts.failed === 0}
                onClick={() => void retry()}
                type="button"
                variant="outline"
              >
                <RefreshCcwIcon data-icon="inline-start" />
                重试失败任务
              </Button>
            </div>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>删除整册人脸索引</CardTitle>
        </CardHeader>
        <CardContent>
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
        confirmLabel={enabled ? "确认启用" : "确认关闭"}
        description="请输入当前账号密码。"
        onConfirm={(password) => performSave(password)}
        onOpenChange={setSavePasswordOpen}
        open={savePasswordOpen}
        title={enabled ? "启用人脸找图" : "关闭人脸找图"}
        variant={enabled ? "default" : "destructive"}
      />

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
