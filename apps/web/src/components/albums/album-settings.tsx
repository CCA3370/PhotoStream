"use client";

import type {
  AlbumStatistics,
  AlbumView,
  BibConfigView,
  FaceConfigView,
  UpdateAlbumRequest,
} from "@photostream/contracts";
import { KeyRoundIcon } from "lucide-react";
import { useState } from "react";

import { BibConfigEditor } from "@/components/bib/bib-config-editor";
import { FaceConfigEditor } from "@/components/face/face-config-editor";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { clientMutation } from "@/lib/client-api";

interface PasswordRotation {
  readonly album: AlbumView;
  readonly generatedPassword: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

export function AlbumSettings({
  initialAlbum,
  bibConfig,
  faceConfig,
  statistics,
}: Readonly<{
  initialAlbum: AlbumView;
  bibConfig: BibConfigView;
  faceConfig: FaceConfigView;
  statistics: AlbumStatistics;
}>) {
  const [album, setAlbum] = useState(initialAlbum);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const [title, setTitle] = useState(initialAlbum.title);
  const [description, setDescription] = useState(initialAlbum.description);
  const [privacyNotice, setPrivacyNotice] = useState(initialAlbum.privacyNotice);
  const [complaintContact, setComplaintContact] = useState(initialAlbum.complaintContact);

  async function update(input: UpdateAlbumRequest, label: string): Promise<void> {
    if (pending) return;
    setPending(true);
    setError(null);
    setSaved(null);
    try {
      const updated = await clientMutation<AlbumView>(`/api/v1/albums/${album.id}`, {
        method: "PATCH",
        body: input,
      });
      setAlbum(updated);
      setTitle(updated.title);
      setDescription(updated.description);
      setPrivacyNotice(updated.privacyNotice);
      setComplaintContact(updated.complaintContact);
      setSaved(label);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存设置失败");
    } finally {
      setPending(false);
    }
  }

  async function rotatePassword(): Promise<void> {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await clientMutation<PasswordRotation>(
        `/api/v1/albums/${album.id}/rotate-password`,
        { idempotencyKey: crypto.randomUUID() },
      );
      setAlbum(result.album);
      setNewPassword(result.generatedPassword);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更换口令失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error === null ? null : (
        <Alert variant="destructive">
          <AlertTitle>设置未保存</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {saved === null ? null : (
        <Alert>
          <AlertTitle>{saved}</AlertTitle>
        </Alert>
      )}
      {newPassword === null ? null : (
        <Alert>
          <KeyRoundIcon aria-hidden="true" />
          <AlertTitle>新活动口令</AlertTitle>
          <AlertDescription>
            <p className="font-mono text-base text-foreground">{newPassword}</p>
            <p>旧访客会话已失效，请立即保存。</p>
          </AlertDescription>
        </Alert>
      )}

      <Tabs className="gap-3" defaultValue="general">
        <TabsList className="max-w-full gap-1.5 overflow-x-auto p-1">
          <TabsTrigger className="px-3" value="general">
            常规设置
          </TabsTrigger>
          <TabsTrigger className="px-3" value="features">
            智能功能
          </TabsTrigger>
          <TabsTrigger className="px-3" value="statistics">
            统计
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              <section className="p-4" aria-labelledby="settings-basic-heading">
                <div className="mb-4">
                  <h3 className="text-sm font-semibold" id="settings-basic-heading">
                    基本信息
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">活动名称与观众可见说明</p>
                </div>
                <form
                  action={(formData) =>
                    void update(
                      {
                        title: String(formData.get("title") ?? title),
                        description: String(formData.get("description") ?? description),
                      },
                      "基本信息已更新",
                    )
                  }
                >
                  <FieldGroup className="gap-3">
                    <Field>
                      <FieldLabel htmlFor="settings-title">活动标题</FieldLabel>
                      <Input
                        id="settings-title"
                        name="title"
                        onChange={(event) => setTitle(event.currentTarget.value)}
                        required
                        value={title}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="settings-description">活动说明</FieldLabel>
                      <Textarea
                        id="settings-description"
                        name="description"
                        onChange={(event) => setDescription(event.currentTarget.value)}
                        value={description}
                      />
                    </Field>
                    <Button className="w-fit" disabled={pending} size="sm" type="submit">
                      {pending ? "正在保存…" : "保存基本信息"}
                    </Button>
                  </FieldGroup>
                </form>
              </section>

              <section className="border-t p-4" aria-labelledby="settings-access-heading">
                <div className="mb-2">
                  <h3 className="text-sm font-semibold" id="settings-access-heading">
                    访问与发布
                  </h3>
                </div>
                <div className="divide-y">
                  <Field className="py-3" orientation="horizontal">
                    <div className="flex-1">
                      <FieldLabel htmlFor="album-public">公开访问</FieldLabel>
                      <FieldDescription>关闭时使用活动口令访问</FieldDescription>
                    </div>
                    <Switch
                      checked={album.access === "public"}
                      disabled={pending}
                      id="album-public"
                      onCheckedChange={(checked) =>
                        void update({ access: checked ? "public" : "password" }, "访问方式已更新")
                      }
                    />
                  </Field>
                  <Field className="py-3" orientation="horizontal">
                    <div className="flex-1">
                      <FieldLabel htmlFor="album-auto-publish">自动发布</FieldLabel>
                      <FieldDescription>关闭时由审核员确认后发布</FieldDescription>
                    </div>
                    <Switch
                      checked={album.publishMode === "auto"}
                      disabled={pending}
                      id="album-auto-publish"
                      onCheckedChange={(checked) =>
                        void update({ publishMode: checked ? "auto" : "review" }, "发布方式已更新")
                      }
                    />
                  </Field>
                  <div className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <p className="text-sm font-medium">活动口令</p>
                      <p className="text-xs text-muted-foreground">更换后旧访客会话立即失效</p>
                    </div>
                    <Button
                      disabled={pending}
                      onClick={() => void rotatePassword()}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <KeyRoundIcon data-icon="inline-start" />
                      更换口令
                    </Button>
                  </div>
                </div>
              </section>

              <section className="border-t p-4" aria-labelledby="settings-download-heading">
                <div className="mb-2">
                  <h3 className="text-sm font-semibold" id="settings-download-heading">
                    下载权限
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    原图可能保留相机元数据，请按活动需要开启
                  </p>
                </div>
                <div className="divide-y">
                  {(
                    [
                      ["previewDownloadEnabled", "普通图下载", "1920 派生图"],
                      ["originalDownloadEnabled", "照片原图下载", "原始文件"],
                    ] as const
                  ).map(([field, label, fieldDescription]) => (
                    <Field className="py-3" key={field} orientation="horizontal">
                      <div className="flex-1">
                        <FieldLabel htmlFor={field}>{label}</FieldLabel>
                        <FieldDescription>{fieldDescription}</FieldDescription>
                      </div>
                      <Switch
                        checked={album[field]}
                        disabled={pending}
                        id={field}
                        onCheckedChange={(checked) =>
                          void update({ [field]: checked }, `${label}已更新`)
                        }
                      />
                    </Field>
                  ))}
                </div>
              </section>

              <section className="border-t p-4" aria-labelledby="settings-public-heading">
                <div className="mb-4">
                  <h3 className="text-sm font-semibold" id="settings-public-heading">
                    公开说明
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">隐私说明与删除投诉联系方式</p>
                </div>
                <form
                  action={(formData) =>
                    void update(
                      {
                        privacyNotice: String(formData.get("privacyNotice") ?? privacyNotice),
                        complaintContact: String(
                          formData.get("complaintContact") ?? complaintContact,
                        ),
                      },
                      "公开说明已更新",
                    )
                  }
                >
                  <FieldGroup className="gap-3">
                    <Field>
                      <FieldLabel htmlFor="privacy-notice">隐私说明</FieldLabel>
                      <Textarea
                        id="privacy-notice"
                        name="privacyNotice"
                        onChange={(event) => setPrivacyNotice(event.currentTarget.value)}
                        value={privacyNotice}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="complaint-contact">删除/投诉联系方式</FieldLabel>
                      <Input
                        id="complaint-contact"
                        name="complaintContact"
                        onChange={(event) => setComplaintContact(event.currentTarget.value)}
                        value={complaintContact}
                      />
                    </Field>
                    <Button className="w-fit" disabled={pending} size="sm" type="submit">
                      {pending ? "正在保存…" : "保存公开说明"}
                    </Button>
                  </FieldGroup>
                </form>
              </section>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="features">
          <Tabs className="gap-3" defaultValue="bib">
            <TabsList className="gap-1.5 p-1">
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

        <TabsContent value="statistics">
          <div className="flex flex-col gap-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">媒体项</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{statistics.mediaCount}</p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">逻辑存储</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">
                  {formatBytes(statistics.logicalBytes)}
                </p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">独立访客</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">
                  {statistics.uniqueVisitors}
                </p>
              </div>
            </div>

            <Card className="overflow-hidden">
              <CardHeader className="border-b py-3.5">
                <CardTitle>日统计</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>日期</TableHead>
                      <TableHead>打开</TableHead>
                      <TableHead>会话</TableHead>
                      <TableHead>下载</TableHead>
                      <TableHead>访客</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {statistics.daily.map((day) => (
                      <TableRow key={day.day}>
                        <TableCell>{day.day}</TableCell>
                        <TableCell>{day.opens}</TableCell>
                        <TableCell>{day.sessions}</TableCell>
                        <TableCell>{day.downloads}</TableCell>
                        <TableCell>{day.uniqueVisitors}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
