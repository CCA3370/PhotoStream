"use client";

import type {
  FaceConfigUpdate,
  FaceConfigView,
  FaceReadinessConfirmation,
} from "@photostream/contracts";
import { RefreshCcwIcon, ScanFaceIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { clientMutation } from "@/lib/client-api";

const confirmationFields = [
  ["participantConsentRecordsConfirmed", "参与者敏感个人信息单独同意记录已核验"],
  ["guardianConsentRequirementsConfirmed", "未满十四周岁参与者的监护人同意要求已核验"],
  ["impactAssessmentCompleted", "个人信息保护影响评估已完成并留存"],
  ["providerResourcesValidated", "获批的 IMM、临时私有 OSS 与 EventBridge 资源已验证"],
  ["evaluationGatePassed", "Git 外授权评测集与高精度阈值门禁已通过"],
  ["billingAlertsConfigured", "独立费用提醒和停用预案已配置"],
  ["indexedFacesAuthorized", "所有拟索引照片中的可识别人脸均在授权范围，旁观者照片已排除"],
] as const satisfies readonly (readonly [keyof FaceReadinessConfirmation, string])[];

const systemFields = [
  ["globalFeatureEnabled", "全局人脸功能已获准开启"],
  ["passwordAccess", "相册保持口令访问"],
  ["privacyNoticeConfigured", "公开隐私说明已配置"],
  ["complaintContactConfigured", "删除/投诉联系人已配置"],
  ["noticeVersionCurrent", "告知版本与服务器当前版本一致"],
  ["thresholdVersionQualified", "阈值版本已通过评测"],
] as const satisfies readonly (readonly [keyof FaceConfigView["readiness"], string])[];

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
  const [noticeVersion, setNoticeVersion] = useState(initial.noticeVersion ?? "");
  const [retentionDays, setRetentionDays] = useState(String(initial.retentionDays));
  const [readiness, setReadiness] = useState<FaceReadinessConfirmation>(() => ({
    participantConsentRecordsConfirmed: initial.readiness.participantConsentRecordsConfirmed,
    guardianConsentRequirementsConfirmed: initial.readiness.guardianConsentRequirementsConfirmed,
    impactAssessmentCompleted: initial.readiness.impactAssessmentCompleted,
    providerResourcesValidated: initial.readiness.providerResourcesValidated,
    evaluationGatePassed: initial.readiness.evaluationGatePassed,
    billingAlertsConfigured: initial.readiness.billingAlertsConfigured,
    indexedFacesAuthorized: initial.readiness.indexedFacesAuthorized,
  }));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [statusErrorOpen, setStatusErrorOpen] = useState(false);

  const allDeclarations = confirmationFields.every(([key]) => readiness[key]);
  const systemGateReady =
    config.readiness.globalFeatureEnabled &&
    config.readiness.passwordAccess &&
    config.readiness.privacyNoticeConfigured &&
    config.readiness.complaintContactConfigured &&
    config.readiness.thresholdVersionQualified &&
    noticeVersion.trim().length > 0;
  const canEnable = allDeclarations && systemGateReady;
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
    setNoticeVersion(next.noticeVersion ?? "");
    setRetentionDays(String(next.retentionDays));
    setSaved(message);
  }

  async function save(): Promise<void> {
    if (pending || !retentionValid || (enabled && !canEnable)) return;
    setPending(true);
    setError(null);
    setSaved(null);
    const body: FaceConfigUpdate = {
      enabled,
      noticeVersion,
      retentionDays: parsedRetentionDays,
      readiness,
    };
    try {
      accept(
        await clientMutation<FaceConfigView>(`/api/v1/albums/${config.albumId}/face-config`, {
          method: "PUT",
          body,
        }),
        enabled
          ? "人脸找图配置已保存，索引任务将在后台继续。"
          : "人脸找图已关闭，删除任务将在后台继续。",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "人脸找图配置保存失败");
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
        "失败任务已重新排队。",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "失败任务重试失败");
    } finally {
      setPending(false);
    }
  }

  async function deleteIndex(): Promise<void> {
    if (pending || deleteConfirmation !== "删除人脸索引") return;
    setPending(true);
    setError(null);
    setSaved(null);
    try {
      accept(
        await clientMutation<FaceConfigView>(`/api/v1/albums/${config.albumId}/face-index`, {
          method: "DELETE",
        }),
        "整册人脸索引删除任务已建立；供应商读回不存在前会保持删除中。",
      );
      setDeleteOpen(false);
      setDeleteConfirmation("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "整册索引删除失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {saved === null ? null : (
        <Alert>
          <AlertTitle>操作已接受</AlertTitle>
          <AlertDescription>{saved}</AlertDescription>
        </Alert>
      )}
      <Alert>
        <ScanFaceIcon aria-hidden="true" />
        <AlertTitle>敏感个人信息功能，默认关闭</AlertTitle>
        <AlertDescription>
          只可用于已完成授权核验的口令相册。共享口令、观众声明和候选结果都不是身份核验；无法排除未同意旁观者时不得启用。
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            索引状态{" "}
            <Badge variant={config.indexState === "failed" ? "destructive" : "outline"}>
              {stateLabels[config.indexState]}
            </Badge>
          </CardTitle>
          <CardDescription>
            只展示任务覆盖和通用状态，不展示人物分组、相似度、人脸框或供应商额外属性。
          </CardDescription>
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
              <Button onClick={() => setStatusErrorOpen(true)} size="sm" type="button" variant="destructive">
                查看失败详情
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>启用门禁</CardTitle>
          <CardDescription>每次保存都由 API 重新校验。危险操作需要近期登录认证。</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            {systemFields.map(([key, label]) => (
              <Field key={key} orientation="horizontal">
                <Checkbox checked={config.readiness[key]} disabled id={`face-system-${key}`} />
                <FieldLabel htmlFor={`face-system-${key}`}>{label}</FieldLabel>
              </Field>
            ))}
            {confirmationFields.map(([key, label]) => (
              <Field key={key} orientation="horizontal">
                <Checkbox
                  checked={readiness[key]}
                  id={`face-confirm-${key}`}
                  onCheckedChange={(checked) =>
                    setReadiness((current) => ({ ...current, [key]: checked }))
                  }
                />
                <FieldLabel htmlFor={`face-confirm-${key}`}>{label}</FieldLabel>
              </Field>
            ))}
            <Field>
              <FieldLabel htmlFor="face-notice-version">告知版本</FieldLabel>
              <Input
                id="face-notice-version"
                maxLength={80}
                onChange={(event) => setNoticeVersion(event.currentTarget.value)}
                value={noticeVersion}
              />
              <FieldDescription>必须与服务器批准的当前版本完全一致。</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="face-retention-days">相册结束后整册索引保留天数</FieldLabel>
              <Input
                id="face-retention-days"
                max={30}
                min={1}
                onChange={(event) => setRetentionDays(event.currentTarget.value)}
                type="number"
                value={retentionDays}
              />
              <FieldDescription>
                最多 30 天；改为公开、关闭或授权失效会更早启动删除。
              </FieldDescription>
            </Field>
            <Field orientation="horizontal">
              <div className="flex-1">
                <FieldLabel htmlFor="face-enabled">启用观众人脸找图</FieldLabel>
                <FieldDescription>发布不等待索引；新照片可能短暂尚不可搜索。</FieldDescription>
              </div>
              <Switch
                checked={enabled}
                disabled={pending || (!enabled && !canEnable)}
                id="face-enabled"
                onCheckedChange={setEnabled}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={pending || !retentionValid || (enabled && !canEnable)}
                onClick={() => void save()}
                type="button"
              >
                {pending ? "正在处理…" : "保存人脸设置"}
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
          <CardDescription>
            立即停止搜索，并持久重试供应商删除；普通相册照片不会被删除。
          </CardDescription>
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
                <AlertDialogDescription>
                  搜索会立即停用。只有供应商元数据和 Dataset
                  读回不存在后，状态才会变为已关闭；此操作需要近期认证。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Field>
                <FieldLabel htmlFor="face-delete-confirmation">
                  输入“删除人脸索引”二次确认
                </FieldLabel>
                <Input
                  id="face-delete-confirmation"
                  onChange={(event) => setDeleteConfirmation(event.currentTarget.value)}
                  value={deleteConfirmation}
                />
              </Field>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction
                  disabled={pending || deleteConfirmation !== "删除人脸索引"}
                  onClick={() => void deleteIndex()}
                  variant="destructive"
                >
                  确认建立删除任务
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
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
