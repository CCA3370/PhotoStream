"use client";

import type {
  AlbumView,
  BibConfigView,
  FaceConfigView,
  UpdateAlbumRequest,
} from "@photostream/contracts";
import type { DataSaverSettingView } from "@photostream/contracts/bandwidth";
import { CopyIcon, ExternalLinkIcon, KeyRoundIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { AlbumDataSaverSetting } from "@/components/albums/album-data-saver-setting";
import { CategoryForm } from "@/components/albums/category-form";
import { PasswordConfirmDialog } from "@/components/auth/password-confirm-dialog";
import { BibConfigEditor } from "@/components/bib/bib-config-editor";
import { FaceConfigEditor } from "@/components/face/face-config-editor";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { broadcastAlbumPurge } from "@/lib/album-purge-broadcast";
import { clientGet, clientMutation } from "@/lib/client-api";
import { purgeWarmDerivedImages } from "@/lib/derived-image-cache";
import { purgeLocalProcessingAlbum } from "@/lib/local-processing-runtime";
import { purgeAlbumMediaBlobCache } from "@/lib/media-blob-cache";
import { deleteUploadRecoveriesForAlbum } from "@/lib/upload-recovery";

interface PasswordRotation {
  readonly album: AlbumView;
  readonly generatedPassword: string;
}

interface CategoryOption {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
}

function isoToBeijingLocalDateTime(value: string | null): string {
  if (value === null) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Shanghai",
    year: "numeric",
  }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function beijingLocalDateTimeToIso(value: string): string | null {
  if (value.trim().length === 0) return null;
  const normalized = value.length === 16 ? `${value}:00` : value;
  const date = new Date(`${normalized}+08:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

type PendingAction =
  | "access"
  | "basic"
  | "originalDownload"
  | "password"
  | "previewDownload"
  | "privacy"
  | "schedule";
type SettingsTab = "access" | "basic" | "categories" | "features" | "traffic";
type FeatureTab = "bib" | "face";

function mergeAlbumUpdate(
  current: AlbumView,
  updated: AlbumView,
  input: UpdateAlbumRequest,
): AlbumView {
  return {
    ...current,
    ...(input.title === undefined ? {} : { title: updated.title }),
    ...(input.description === undefined ? {} : { description: updated.description }),
    ...(input.access === undefined ? {} : { access: updated.access }),
    ...(input.scheduledStartAt === undefined
      ? {}
      : { scheduledStartAt: updated.scheduledStartAt }),
    ...(input.previewDownloadEnabled === undefined
      ? {}
      : { previewDownloadEnabled: updated.previewDownloadEnabled }),
    ...(input.originalDownloadEnabled === undefined
      ? {}
      : { originalDownloadEnabled: updated.originalDownloadEnabled }),
    ...(input.privacyNotice === undefined ? {} : { privacyNotice: updated.privacyNotice }),
    updatedAt: updated.updatedAt,
  };
}

function SettingRow({
  children,
  description,
  status,
  title,
}: Readonly<{
  children: ReactNode;
  description?: string;
  status?: ReactNode;
  title: string;
}>) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3.5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">{title}</p>
          {status}
        </div>
        {description === undefined ? null : (
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function AlbumSettings({
  categories = [],
  dataSaver = { enabled: false },
  initialAlbum,
  bibConfig: initialBibConfig,
  faceConfig: initialFaceConfig,
}: Readonly<{
  categories?: readonly CategoryOption[] | undefined;
  dataSaver?: DataSaverSettingView | undefined;
  initialAlbum: AlbumView;
  bibConfig?: BibConfigView | undefined;
  faceConfig?: FaceConfigView | undefined;
  statistics?: unknown;
}>) {
  const router = useRouter();
  const pendingRef = useRef(new Set<PendingAction>());
  const [album, setAlbum] = useState(initialAlbum);
  const [pendingActions, setPendingActions] = useState<ReadonlySet<PendingAction>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const [title, setTitle] = useState(initialAlbum.title);
  const [description, setDescription] = useState(initialAlbum.description);
  const [privacyNotice, setPrivacyNotice] = useState(initialAlbum.privacyNotice);
  const [scheduledStartValue, setScheduledStartValue] = useState(
    isoToBeijingLocalDateTime(initialAlbum.scheduledStartAt),
  );
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [activeTab, setActiveTab] = useState<SettingsTab>("basic");
  const [featureTab, setFeatureTab] = useState<FeatureTab>("bib");
  const [bibConfig, setBibConfig] = useState<BibConfigView | null>(initialBibConfig ?? null);
  const [faceConfig, setFaceConfig] = useState<FaceConfigView | null>(initialFaceConfig ?? null);
  const [featureLoading, setFeatureLoading] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  function isPending(action: PendingAction): boolean {
    return pendingActions.has(action);
  }

  function beginPending(action: PendingAction): boolean {
    if (pendingRef.current.has(action)) return false;
    pendingRef.current.add(action);
    setPendingActions(new Set(pendingRef.current));
    return true;
  }

  function endPending(action: PendingAction): void {
    pendingRef.current.delete(action);
    setPendingActions(new Set(pendingRef.current));
  }

  function showNotice(text: string): void {
    toast.add({ title: text, type: "success" });
  }

  async function update(
    input: UpdateAlbumRequest,
    label: string,
    action: PendingAction,
  ): Promise<void> {
    if (!beginPending(action)) return;
    setError(null);
    try {
      const updated = await clientMutation<AlbumView>(`/api/v1/albums/${album.id}`, {
        method: "PATCH",
        body: input,
      });
      setAlbum((current) => mergeAlbumUpdate(current, updated, input));
      if (action === "basic") {
        setTitle(updated.title);
        setDescription(updated.description);
        router.refresh();
      }
      if (action === "privacy") setPrivacyNotice(updated.privacyNotice);
      if (action === "schedule") {
        setScheduledStartValue(isoToBeijingLocalDateTime(updated.scheduledStartAt));
      }
      showNotice(label);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存设置失败");
    } finally {
      endPending(action);
    }
  }

  async function rotatePassword(): Promise<void> {
    if (!beginPending("password")) return;
    setError(null);
    try {
      const result = await clientMutation<PasswordRotation>(
        `/api/v1/albums/${album.id}/rotate-password`,
        {
          body: passwordInput.length === 0 ? {} : { password: passwordInput },
          idempotencyKey: crypto.randomUUID(),
        },
      );
      setAlbum((current) => ({
        ...current,
        access: result.album.access,
        updatedAt: result.album.updatedAt,
      }));
      setPasswordDialogOpen(false);
      setPasswordInput("");
      setNewPassword(result.generatedPassword);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更换口令失败");
    } finally {
      endPending("password");
    }
  }

  async function deleteAlbum(password: string): Promise<void> {
    await clientMutation<{ ok: true }>(`/api/v1/albums/${album.id}`, {
      method: "DELETE",
      body: { confirmation: deleteConfirmation },
      confirmPassword: password,
    });
    broadcastAlbumPurge({ albumId: album.id, slug: album.slug });
    purgeWarmDerivedImages(album.slug);
    const cleanup = await Promise.allSettled([
      purgeLocalProcessingAlbum(album.id),
      deleteUploadRecoveriesForAlbum(album.id),
      purgeAlbumMediaBlobCache(album.id, album.slug),
    ]);
    if (cleanup.some((result) => result.status === "rejected")) {
      toast.add({
        title: "活动已进入删除流程",
        description: "服务器端删除会继续进行，但当前浏览器有部分本地缓存未能清理。",
        type: "warning",
      });
    } else {
      toast.add({
        title: "活动已进入删除流程",
        description: "可在活动列表查看删除阶段、重试状态和最近错误。",
        type: "success",
      });
    }
    router.replace("/studio/albums");
    router.refresh();
  }

  async function copyText(value: string, success: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      showNotice(success);
    } catch {
      setError("复制失败，请手动复制");
    }
  }

  const basicDirty = title.trim() !== album.title || description.trim() !== album.description;
  const privacyDirty = privacyNotice.trim() !== album.privacyNotice;
  const scheduledStartIso = beijingLocalDateTimeToIso(scheduledStartValue);
  const scheduleDirty =
    scheduledStartIso !== album.scheduledStartAt &&
    !(scheduledStartIso === null && album.scheduledStartAt === null);
  const dirty = basicDirty || privacyDirty || scheduleDirty;
  const galleryPath = `/g/${album.slug}`;

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (activeTab !== "features") return;
    if (featureTab === "bib" && bibConfig !== null) return;
    if (featureTab === "face" && faceConfig !== null) return;
    let cancelled = false;
    setFeatureLoading(true);
    const path =
      featureTab === "bib"
        ? `/api/v1/albums/${album.id}/bib-config`
        : `/api/v1/albums/${album.id}/face-config`;
    void clientGet<BibConfigView | FaceConfigView>(path)
      .then((config) => {
        if (cancelled) return;
        if (featureTab === "bib") setBibConfig(config as BibConfigView);
        else setFaceConfig(config as FaceConfigView);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "查找功能配置加载失败");
      })
      .finally(() => {
        if (!cancelled) setFeatureLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, album.id, bibConfig, faceConfig, featureTab]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <code className="max-w-full truncate rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            {galleryPath}
          </code>
          <Badge variant="outline">{album.access === "public" ? "公开访问" : "口令访问"}</Badge>
          <Badge variant="outline">上传后默认隐藏</Badge>
          {dirty ? <Badge variant="secondary">有未保存修改</Badge> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            aria-label="复制观众页地址"
            onClick={() =>
              void copyText(`${window.location.origin}${galleryPath}`, "观众页地址已复制")
            }
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <CopyIcon />
          </Button>
          <Link
            className={buttonVariants({ size: "sm", variant: "ghost" })}
            href={galleryPath}
            target="_blank"
          >
            观众页
            <ExternalLinkIcon data-icon="inline-end" />
          </Link>
        </div>
      </div>

      <Tabs
        className="gap-3"
        onValueChange={(value) => {
          if (
            value === "basic" ||
            value === "access" ||
            value === "categories" ||
            value === "features" ||
            value === "traffic"
          ) {
            setActiveTab(value);
          }
        }}
        value={activeTab}
      >
        <TabsList className="w-fit max-w-full gap-1 overflow-x-auto p-1">
          <TabsTrigger className="px-3" value="basic">
            基础信息
          </TabsTrigger>
          <TabsTrigger className="px-3" value="access">
            访问
          </TabsTrigger>
          <TabsTrigger className="px-3" value="categories">
            分类
          </TabsTrigger>
          <TabsTrigger className="px-3" value="features">
            查找功能
          </TabsTrigger>
          <TabsTrigger className="px-3" value="traffic">
            流量
          </TabsTrigger>
        </TabsList>

        <TabsContent value="basic">
          <div className="grid gap-3 xl:grid-cols-2">
            <Card className="overflow-hidden shadow-none">
              <CardHeader className="border-b py-3.5">
                <CardTitle>基本信息</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <form
                  className="flex flex-col gap-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void update(
                      { title: title.trim(), description: description.trim() },
                      "基本信息已保存",
                      "basic",
                    );
                  }}
                >
                  <FieldGroup className="gap-3">
                    <Field>
                      <FieldLabel htmlFor="settings-title">活动标题</FieldLabel>
                      <Input
                        id="settings-title"
                        maxLength={120}
                        onChange={(event) => {
                          const { value } = event.currentTarget;
                          setTitle(value);
                        }}
                        required
                        value={title}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="settings-description">活动说明</FieldLabel>
                      <Textarea
                        className="min-h-24 resize-y"
                        id="settings-description"
                        maxLength={1_000}
                        onChange={(event) => {
                          const { value } = event.currentTarget;
                          setDescription(value);
                        }}
                        value={description}
                      />
                    </Field>
                  </FieldGroup>
                  <div className="flex min-h-7 items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground">
                      {basicDirty ? "有未保存修改" : "已保存"}
                    </span>
                    <Button
                      disabled={!basicDirty || title.trim().length === 0 || isPending("basic")}
                      size="sm"
                      type="submit"
                    >
                      {isPending("basic") ? (
                        <Spinner className="animate-spin" data-icon="inline-start" />
                      ) : null}
                      {isPending("basic") ? "保存中" : "保存"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            <Card className="overflow-hidden shadow-none">
              <CardHeader className="border-b py-3.5">
                <CardTitle>隐私说明</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <form
                  className="flex flex-col gap-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void update(
                      { privacyNotice: privacyNotice.trim() },
                      "隐私说明已保存",
                      "privacy",
                    );
                  }}
                >
                  <Field>
                    <FieldLabel htmlFor="privacy-notice">补充说明</FieldLabel>
                    <Textarea
                      className="min-h-24 resize-y"
                      id="privacy-notice"
                      maxLength={2_000}
                      onChange={(event) => {
                        const { value } = event.currentTarget;
                        setPrivacyNotice(value);
                      }}
                      placeholder="可选。这里的内容会作为本活动的隐私补充说明显示。"
                      value={privacyNotice}
                    />
                  </Field>
                  <div className="flex min-h-7 items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground">
                      {privacyDirty ? "有未保存修改" : "已保存"}
                    </span>
                    <Button
                      disabled={!privacyDirty || isPending("privacy")}
                      size="sm"
                      type="submit"
                    >
                      {isPending("privacy") ? (
                        <Spinner className="animate-spin" data-icon="inline-start" />
                      ) : null}
                      {isPending("privacy") ? "保存中" : "保存"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>

          <Card className="mt-3 overflow-hidden shadow-none">
            <CardHeader className="border-b py-3.5">
              <CardTitle>开始安排</CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <form
                className="flex flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void update(
                    { scheduledStartAt: scheduledStartIso },
                    scheduledStartIso === null ? "已清除预约开始时间" : "预约开始时间已保存",
                    "schedule",
                  );
                }}
              >
                <Field>
                  <FieldLabel htmlFor="scheduled-start-at">开始时间（北京时间）</FieldLabel>
                  <Input
                    disabled={album.state !== "draft"}
                    id="scheduled-start-at"
                    onChange={(event) => setScheduledStartValue(event.currentTarget.value)}
                    type="datetime-local"
                    value={scheduledStartValue}
                  />
                  <p className="text-xs leading-5 text-muted-foreground">
                    {album.state === "draft"
                      ? "到达此时间后活动会自动切换为直播中；留空则继续等待手动开始。"
                      : "活动已经开始或结束，不能再修改预约开始时间。"}
                  </p>
                </Field>
                <div className="flex min-h-7 items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground">
                    {scheduleDirty ? "有未保存修改" : "已保存"}
                  </span>
                  <Button
                    disabled={
                      album.state !== "draft" || !scheduleDirty || isPending("schedule")
                    }
                    size="sm"
                    type="submit"
                  >
                    {isPending("schedule") ? (
                      <Spinner className="animate-spin" data-icon="inline-start" />
                    ) : null}
                    {isPending("schedule") ? "保存中" : "保存"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card className="mt-3 overflow-hidden border-destructive/40 shadow-none">
            <CardHeader className="border-b py-3.5">
              <CardTitle>删除活动</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 p-4">
              <div>
                <p className="text-sm font-medium">永久删除此活动及其全部数据</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  会删除照片与所有派生图、上传/审核数据、分类、查找配置、号码数据、人脸参考照与云端人脸索引、统计、反馈、分享及其他活动关联信息。此操作不可恢复。
                </p>
              </div>
              <Field>
                <FieldLabel htmlFor="delete-album-confirmation">
                  输入活动标题“{album.title}”以确认
                </FieldLabel>
                <Input
                  autoComplete="off"
                  id="delete-album-confirmation"
                  onChange={(event) => {
                    const { value } = event.currentTarget;
                    setDeleteConfirmation(value);
                  }}
                  value={deleteConfirmation}
                />
              </Field>
              <div className="flex justify-end">
                <Button
                  disabled={deleteConfirmation !== album.title}
                  onClick={() => setDeleteDialogOpen(true)}
                  type="button"
                  variant="destructive"
                >
                  <Trash2Icon data-icon="inline-start" />
                  永久删除活动
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="access">
          <div className="grid gap-3 xl:grid-cols-2">
            <Card className="overflow-hidden shadow-none">
              <CardHeader className="border-b py-3.5">
                <CardTitle>访问</CardTitle>
              </CardHeader>
              <CardContent className="divide-y p-0">
                <SettingRow
                  description="关闭后访客需要输入活动口令"
                  status={
                    <Badge variant="secondary">{album.access === "public" ? "公开" : "口令"}</Badge>
                  }
                  title="公开访问"
                >
                  {isPending("access") ? (
                    <Spinner className="size-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Switch
                      aria-label="公开访问"
                      checked={album.access === "public"}
                      onCheckedChange={(checked) =>
                        void update(
                          { access: checked ? "public" : "password" },
                          "访问方式已更新",
                          "access",
                        )
                      }
                    />
                  )}
                </SettingRow>

                <SettingRow
                  description="照片完成上传后保持隐藏，由审核工作区选择是否向观众显示"
                  status={<Badge variant="secondary">固定</Badge>}
                  title="照片可见性"
                >
                  <Badge variant="outline">默认隐藏</Badge>
                </SettingRow>

                <SettingRow
                  description="可自定义 4–128 个字符；更换后旧口令和已有访客会话立即失效"
                  title="活动口令"
                >
                  <Button
                    disabled={isPending("password")}
                    onClick={() => setPasswordDialogOpen(true)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {isPending("password") ? (
                      <Spinner className="animate-spin" data-icon="inline-start" />
                    ) : (
                      <KeyRoundIcon data-icon="inline-start" />
                    )}
                    {isPending("password") ? "更换中" : "设置口令"}
                  </Button>
                </SettingRow>
              </CardContent>
            </Card>

            <Card className="overflow-hidden shadow-none">
              <CardHeader className="border-b py-3.5">
                <CardTitle>下载权限</CardTitle>
              </CardHeader>
              <CardContent className="divide-y p-0">
                <SettingRow description="允许观众下载普通尺寸图片" title="普通图下载">
                  {isPending("previewDownload") ? (
                    <Spinner className="size-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Switch
                      aria-label="普通图下载"
                      checked={album.previewDownloadEnabled}
                      onCheckedChange={(checked) =>
                        void update(
                          { previewDownloadEnabled: checked },
                          "普通图下载设置已更新",
                          "previewDownload",
                        )
                      }
                    />
                  )}
                </SettingRow>
                <SettingRow
                  description="允许观众下载原始尺寸图片，流量消耗通常更高"
                  title="原图下载"
                >
                  {isPending("originalDownload") ? (
                    <Spinner className="size-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Switch
                      aria-label="原图下载"
                      checked={album.originalDownloadEnabled}
                      onCheckedChange={(checked) =>
                        void update(
                          { originalDownloadEnabled: checked },
                          "原图下载设置已更新",
                          "originalDownload",
                        )
                      }
                    />
                  )}
                </SettingRow>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="categories">
          <Card className="overflow-hidden shadow-none">
            <CardHeader className="border-b py-3.5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle>分类</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    管理上传和观众页使用的活动分类。
                  </p>
                </div>
                <Badge variant="outline">{categories.length} 个</Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 p-4">
              {categories.length === 0 ? (
                <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                  还没有分类
                </div>
              ) : (
                <div className="divide-y rounded-lg border">
                  {categories.map((category) => (
                    <div
                      className="flex items-center justify-between gap-3 px-3 py-2.5"
                      key={category.id}
                    >
                      <span className="text-sm font-medium">{category.name}</span>
                      <Badge variant={category.enabled ? "secondary" : "outline"}>
                        {category.enabled ? "启用" : "停用"}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
              <CategoryForm albumId={album.id} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="features">
          <Tabs
            className="gap-3"
            onValueChange={(value) => {
              if (value === "bib" || value === "face") setFeatureTab(value);
            }}
            value={featureTab}
          >
            <TabsList className="w-fit max-w-full gap-1 overflow-x-auto p-1">
              <TabsTrigger className="px-3" value="bib">
                号码识别
              </TabsTrigger>
              <TabsTrigger className="px-3" value="face">
                人脸找图
              </TabsTrigger>
            </TabsList>
            <TabsContent value="bib">
              {featureLoading && bibConfig === null ? (
                <div className="flex min-h-40 items-center justify-center rounded-lg border text-sm text-muted-foreground">
                  <Spinner className="mr-2 size-4 animate-spin" />
                  正在加载号码识别配置
                </div>
              ) : bibConfig === null ? null : (
                <BibConfigEditor initial={bibConfig} />
              )}
            </TabsContent>
            <TabsContent value="face">
              {featureLoading && faceConfig === null ? (
                <div className="flex min-h-40 items-center justify-center rounded-lg border text-sm text-muted-foreground">
                  <Spinner className="mr-2 size-4 animate-spin" />
                  正在加载人脸找图配置
                </div>
              ) : faceConfig === null ? null : (
                <FaceConfigEditor initial={faceConfig} />
              )}
            </TabsContent>
          </Tabs>
        </TabsContent>

        <TabsContent value="traffic">
          <AlbumDataSaverSetting albumId={album.id} initialSetting={dataSaver} />
        </TabsContent>
      </Tabs>

      <Dialog
        onOpenChange={(open) => {
          setPasswordDialogOpen(open);
          if (!open) setPasswordInput("");
        }}
        open={passwordDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>设置活动口令</DialogTitle>
            <DialogDescription>
              输入自定义口令；留空则自动生成。保存后旧口令和已有访客会话立即失效。
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="custom-album-password">新活动口令</FieldLabel>
            <Input
              autoComplete="new-password"
              id="custom-album-password"
              maxLength={128}
              minLength={4}
              onChange={(event) => setPasswordInput(event.currentTarget.value)}
              placeholder="留空则自动生成"
              type="password"
              value={passwordInput}
            />
          </Field>
          <DialogFooter>
            <Button
              disabled={
                isPending("password") ||
                (passwordInput.length > 0 && passwordInput.length < 4)
              }
              onClick={() => void rotatePassword()}
              type="button"
            >
              {isPending("password") ? (
                <Spinner className="animate-spin" data-icon="inline-start" />
              ) : null}
              {isPending("password") ? "保存中" : "确认更换"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open) setNewPassword(null);
        }}
        open={newPassword !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新活动口令</DialogTitle>
            <DialogDescription>旧访客会话已失效，请保存新口令。</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-2">
            <code className="min-w-0 flex-1 select-all truncate px-1 text-base font-semibold">
              {newPassword}
            </code>
            <Button
              aria-label="复制新活动口令"
              onClick={() =>
                newPassword === null ? undefined : void copyText(newPassword, "活动口令已复制")
              }
              size="icon-sm"
              type="button"
              variant="outline"
            >
              <CopyIcon />
            </Button>
          </div>
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>

      <PasswordConfirmDialog
        confirmLabel="确认永久删除"
        description="活动会立即停止访问并进入删除中；旧临时上传签名失效并完成最终复扫后，系统才会彻底移除活动记录。"
        onConfirm={deleteAlbum}
        onOpenChange={setDeleteDialogOpen}
        open={deleteDialogOpen}
        title="确认永久删除活动"
        variant="destructive"
      />

      <ErrorDialog message={error} onClose={() => setError(null)} title="操作失败" />
    </div>
  );
}
