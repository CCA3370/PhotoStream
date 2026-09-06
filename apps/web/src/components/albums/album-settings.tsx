"use client";

import type {
  AlbumView,
  BibConfigView,
  FaceConfigView,
  UpdateAlbumRequest,
} from "@photostream/contracts";
import { CopyIcon, ExternalLinkIcon, KeyRoundIcon, LoaderCircleIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { clientMutation } from "@/lib/client-api";

interface PasswordRotation {
  readonly album: AlbumView;
  readonly generatedPassword: string;
}

type PendingAction =
  | "access"
  | "basic"
  | "original-download"
  | "password"
  | "preview-download"
  | "public-info"
  | "publish";

const stateLabels: Record<AlbumView["state"], string> = {
  draft: "草稿",
  live: "直播中",
  ended: "已结束",
  archived: "已归档",
};

function stateVariant(state: AlbumView["state"]): "default" | "outline" | "secondary" {
  if (state === "live") return "default";
  if (state === "archived") return "outline";
  return "secondary";
}

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
    ...(input.publishMode === undefined ? {} : { publishMode: updated.publishMode }),
    ...(input.previewDownloadEnabled === undefined
      ? {}
      : { previewDownloadEnabled: updated.previewDownloadEnabled }),
    ...(input.originalDownloadEnabled === undefined
      ? {}
      : { originalDownloadEnabled: updated.originalDownloadEnabled }),
    ...(input.privacyNotice === undefined ? {} : { privacyNotice: updated.privacyNotice }),
    ...(input.complaintContact === undefined ? {} : { complaintContact: updated.complaintContact }),
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
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function AlbumSettings({
  initialAlbum,
  bibConfig,
  faceConfig,
}: Readonly<{
  initialAlbum: AlbumView;
  bibConfig: BibConfigView;
  faceConfig: FaceConfigView;
  statistics?: unknown;
}>) {
  const noticeTimer = useRef<number | null>(null);
  const pendingRef = useRef(new Set<PendingAction>());
  const [album, setAlbum] = useState(initialAlbum);
  const [pendingActions, setPendingActions] = useState<ReadonlySet<PendingAction>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const [title, setTitle] = useState(initialAlbum.title);
  const [description, setDescription] = useState(initialAlbum.description);
  const [privacyNotice, setPrivacyNotice] = useState(initialAlbum.privacyNotice);
  const [complaintContact, setComplaintContact] = useState(initialAlbum.complaintContact);

  useEffect(
    () => () => {
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    },
    [],
  );

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
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    setNotice(text);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 1_800);
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
      }
      if (action === "public-info") {
        setPrivacyNotice(updated.privacyNotice);
        setComplaintContact(updated.complaintContact);
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
        { idempotencyKey: crypto.randomUUID() },
      );
      setAlbum((current) => ({ ...current, updatedAt: result.album.updatedAt }));
      setNewPassword(result.generatedPassword);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更换口令失败");
    } finally {
      endPending("password");
    }
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
  const publicInfoDirty =
    privacyNotice.trim() !== album.privacyNotice ||
    complaintContact.trim() !== album.complaintContact;
  const galleryPath = `/g/${album.slug}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge variant={stateVariant(album.state)}>{stateLabels[album.state]}</Badge>
          <code className="max-w-full truncate rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            {galleryPath}
          </code>
          <Badge variant="outline">{album.access === "public" ? "公开访问" : "口令访问"}</Badge>
          <Badge variant="outline">
            {album.publishMode === "auto" ? "自动发布" : "审核后发布"}
          </Badge>
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

      <Tabs className="gap-3" defaultValue="general">
        <TabsList className="w-fit max-w-full gap-1 overflow-x-auto p-1">
          <TabsTrigger className="px-3" value="general">
            常规
          </TabsTrigger>
          <TabsTrigger className="px-3" value="features">
            查找功能
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
            <div className="flex min-w-0 flex-col gap-3">
              <Card className="overflow-hidden">
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
                          onChange={(event) => setTitle(event.currentTarget.value)}
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
                          onChange={(event) => setDescription(event.currentTarget.value)}
                          value={description}
                        />
                      </Field>
                    </FieldGroup>
                    <div className="flex min-h-7 items-center justify-between gap-3">
                      <span className="text-xs text-muted-foreground">
                        {basicDirty ? "有未保存修改" : null}
                      </span>
                      <Button
                        disabled={!basicDirty || title.trim().length === 0 || isPending("basic")}
                        size="sm"
                        type="submit"
                      >
                        {isPending("basic") ? (
                          <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
                        ) : null}
                        {isPending("basic") ? "保存中" : "保存"}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>

              <Card className="overflow-hidden">
                <CardHeader className="border-b py-3.5">
                  <CardTitle>公开信息</CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                  <form
                    className="flex flex-col gap-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void update(
                        {
                          privacyNotice: privacyNotice.trim(),
                          complaintContact: complaintContact.trim(),
                        },
                        "公开信息已保存",
                        "public-info",
                      );
                    }}
                  >
                    <FieldGroup className="gap-3">
                      <Field>
                        <FieldLabel htmlFor="privacy-notice">隐私说明</FieldLabel>
                        <Textarea
                          className="min-h-24 resize-y"
                          id="privacy-notice"
                          maxLength={2_000}
                          onChange={(event) => setPrivacyNotice(event.currentTarget.value)}
                          value={privacyNotice}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="complaint-contact">删除/投诉联系方式</FieldLabel>
                        <Input
                          id="complaint-contact"
                          maxLength={300}
                          onChange={(event) => setComplaintContact(event.currentTarget.value)}
                          value={complaintContact}
                        />
                      </Field>
                    </FieldGroup>
                    <div className="flex min-h-7 items-center justify-between gap-3">
                      <span className="text-xs text-muted-foreground">
                        {publicInfoDirty ? "有未保存修改" : null}
                      </span>
                      <Button
                        disabled={!publicInfoDirty || isPending("public-info")}
                        size="sm"
                        type="submit"
                      >
                        {isPending("public-info") ? (
                          <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
                        ) : null}
                        {isPending("public-info") ? "保存中" : "保存"}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </div>

            <div className="flex min-w-0 flex-col gap-3">
              <Card className="overflow-hidden">
                <CardHeader className="border-b py-3.5">
                  <CardTitle>访问与发布</CardTitle>
                </CardHeader>
                <CardContent className="divide-y p-0">
                  <SettingRow
                    description="关闭后访客需要输入活动口令"
                    status={
                      <Badge variant="secondary">
                        {album.access === "public" ? "公开" : "口令"}
                      </Badge>
                    }
                    title="公开访问"
                  >
                    {isPending("access") ? (
                      <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" />
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
                    description="关闭后照片进入审核列表，由审核员确认发布"
                    status={
                      <Badge variant="secondary">
                        {album.publishMode === "auto" ? "自动" : "审核"}
                      </Badge>
                    }
                    title="自动发布"
                  >
                    {isPending("publish") ? (
                      <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" />
                    ) : (
                      <Switch
                        aria-label="自动发布"
                        checked={album.publishMode === "auto"}
                        onCheckedChange={(checked) =>
                          void update(
                            { publishMode: checked ? "auto" : "review" },
                            "发布方式已更新",
                            "publish",
                          )
                        }
                      />
                    )}
                  </SettingRow>

                  <SettingRow description="更换后旧访客会话立即失效" title="活动口令">
                    <Button
                      disabled={isPending("password")}
                      onClick={() => void rotatePassword()}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {isPending("password") ? (
                        <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
                      ) : (
                        <KeyRoundIcon data-icon="inline-start" />
                      )}
                      {isPending("password") ? "更换中" : "更换"}
                    </Button>
                  </SettingRow>
                </CardContent>
              </Card>

              <Card className="overflow-hidden">
                <CardHeader className="border-b py-3.5">
                  <CardTitle>下载权限</CardTitle>
                </CardHeader>
                <CardContent className="divide-y p-0">
                  <SettingRow description="允许访客下载 1920px 派生图" title="普通图下载">
                    {isPending("preview-download") ? (
                      <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" />
                    ) : (
                      <Switch
                        aria-label="普通图下载"
                        checked={album.previewDownloadEnabled}
                        onCheckedChange={(checked) =>
                          void update(
                            { previewDownloadEnabled: checked },
                            "普通图下载权限已更新",
                            "preview-download",
                          )
                        }
                      />
                    )}
                  </SettingRow>
                  <SettingRow description="原始文件可能包含相机元数据" title="照片原图下载">
                    {isPending("original-download") ? (
                      <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" />
                    ) : (
                      <Switch
                        aria-label="照片原图下载"
                        checked={album.originalDownloadEnabled}
                        onCheckedChange={(checked) =>
                          void update(
                            { originalDownloadEnabled: checked },
                            "原图下载权限已更新",
                            "original-download",
                          )
                        }
                      />
                    )}
                  </SettingRow>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="features">
          <Tabs className="gap-3" defaultValue="bib">
            <TabsList className="w-fit max-w-full gap-1 overflow-x-auto p-1">
              <TabsTrigger className="px-3" value="bib">
                号码识别
              </TabsTrigger>
              <TabsTrigger className="px-3" value="face">
                人脸找图
              </TabsTrigger>
            </TabsList>
            <TabsContent value="bib">
              <BibConfigEditor initial={bibConfig} />
            </TabsContent>
            <TabsContent value="face">
              <FaceConfigEditor initial={faceConfig} />
            </TabsContent>
          </Tabs>
        </TabsContent>
      </Tabs>

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

      {notice === null ? null : (
        <div className="pointer-events-none fixed inset-x-0 top-1/2 z-[70] flex -translate-y-1/2 justify-center px-4">
          <div className="rounded-md bg-black/85 px-4 py-2 text-sm font-medium text-white shadow-xl">
            {notice}
          </div>
        </div>
      )}

      <ErrorDialog message={error} onClose={() => setError(null)} title="操作失败" />
    </div>
  );
}
