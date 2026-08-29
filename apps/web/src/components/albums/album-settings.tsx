"use client";

import type { AlbumStatistics, AlbumView, UpdateAlbumRequest } from "@photostream/contracts";
import { KeyRoundIcon } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function AlbumSettings({
  initialAlbum,
  statistics,
}: Readonly<{ initialAlbum: AlbumView; statistics: AlbumStatistics }>) {
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
    <div className="flex flex-col gap-4">
      {error === null ? null : (
        <Alert variant="destructive">
          <AlertTitle>设置未保存</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {saved === null ? null : (
        <Alert>
          <AlertTitle>设置已保存</AlertTitle>
          <AlertDescription>{saved}</AlertDescription>
        </Alert>
      )}
      {newPassword === null ? null : (
        <Alert>
          <KeyRoundIcon aria-hidden="true" />
          <AlertTitle>请立即安全保存新口令</AlertTitle>
          <AlertDescription>
            <p className="font-mono text-base text-foreground">{newPassword}</p>
            <p>旧访客会话已失效；该值关闭页面后不再展示。</p>
          </AlertDescription>
        </Alert>
      )}
      <Tabs defaultValue="basic">
        <TabsList className="max-w-full overflow-x-auto" variant="line">
          <TabsTrigger value="basic">基本信息</TabsTrigger>
          <TabsTrigger value="access">访问与发布</TabsTrigger>
          <TabsTrigger value="downloads">下载</TabsTrigger>
          <TabsTrigger value="privacy">隐私与投诉</TabsTrigger>
          <TabsTrigger value="statistics">统计</TabsTrigger>
        </TabsList>

        <TabsContent value="basic">
          <Card>
            <CardHeader>
              <CardTitle>基本信息</CardTitle>
              <CardDescription>修改活动标题和观众可见说明。</CardDescription>
            </CardHeader>
            <CardContent>
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
                <FieldGroup>
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
                  <Button disabled={pending} type="submit">
                    {pending ? "正在保存…" : "保存基本信息"}
                  </Button>
                </FieldGroup>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="access">
          <Card>
            <CardHeader>
              <CardTitle>访问与发布</CardTitle>
              <CardDescription>
                公开访问会让任何获得链接者进入；更换口令会退出旧访客。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <Field orientation="horizontal">
                <div className="flex-1">
                  <FieldLabel htmlFor="album-public">无需口令公开访问</FieldLabel>
                  <FieldDescription>
                    媒体仍使用短期签名 URL，不会把对象改为公共读。
                  </FieldDescription>
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
              <Field orientation="horizontal">
                <div className="flex-1">
                  <FieldLabel htmlFor="album-auto-publish">预览就绪后自动发布</FieldLabel>
                  <FieldDescription>学校活动默认关闭，先由审核员确认。</FieldDescription>
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
              <Button
                disabled={pending}
                onClick={() => void rotatePassword()}
                type="button"
                variant="outline"
              >
                <KeyRoundIcon data-icon="inline-start" />
                更换随机口令并退出旧访客
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="downloads">
          <Card>
            <CardHeader>
              <CardTitle>下载开关</CardTitle>
              <CardDescription>
                每项独立校验；地址有效 5 分钟，获得者在过期前仍可能转发。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <Alert>
                <AlertTitle>开启下载会增加二次传播与 CDN 流量</AlertTitle>
                <AlertDescription>
                  仅在学校流程明确允许时开启；原图可能保留 EXIF/GPS。
                </AlertDescription>
              </Alert>
              {(
                [
                  ["previewDownloadEnabled", "普通图下载", "下载 1920 派生图"],
                  ["originalDownloadEnabled", "照片原图下载", "下载原始文件，可能含相机元数据"],
                  ["videoDownloadEnabled", "视频下载", "阶段 5 视频完成后生效"],
                ] as const
              ).map(([field, label, description]) => (
                <Field key={field} orientation="horizontal">
                  <div className="flex-1">
                    <FieldLabel htmlFor={field}>{label}</FieldLabel>
                    <FieldDescription>{description}</FieldDescription>
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
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="privacy">
          <Card>
            <CardHeader>
              <CardTitle>隐私说明与删除投诉</CardTitle>
              <CardDescription>观众页底部公开展示；不得填写学生个人信息。</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                action={(formData) =>
                  void update(
                    {
                      privacyNotice: String(formData.get("privacyNotice") ?? privacyNotice),
                      complaintContact: String(
                        formData.get("complaintContact") ?? complaintContact,
                      ),
                    },
                    "隐私与投诉信息已更新",
                  )
                }
              >
                <FieldGroup>
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
                  <Button disabled={pending} type="submit">
                    {pending ? "正在保存…" : "保存公开说明"}
                  </Button>
                </FieldGroup>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="statistics">
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>{statistics.mediaCount}</CardTitle>
                <CardDescription>媒体项</CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{formatBytes(statistics.logicalBytes)}</CardTitle>
                <CardDescription>已验证对象逻辑体积</CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{statistics.uniqueVisitors}</CardTitle>
                <CardDescription>按日不可跨日关联访客</CardDescription>
              </CardHeader>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>匿名日统计</CardTitle>
              <CardDescription>
                明细最多保留 30 天，聚合不含原始 IP、UA 或访客令牌。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>日期</TableHead>
                    <TableHead>打开</TableHead>
                    <TableHead>会话</TableHead>
                    <TableHead>下载签发</TableHead>
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
