"use client";

import type {
  AlbumUploaderView,
  DeletionTaskView,
  InternalMediaList,
  InternalMediaView,
  MediaBatchRequest,
  MediaBatchResult,
} from "@photostream/contracts";
import { EyeIcon, EyeOffIcon, FolderInputIcon, RotateCcwIcon, SendIcon, XIcon } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

import { DeleteMediaButton } from "@/components/review/delete-media-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { clientGet, clientMutation } from "@/lib/client-api";
import { selectMediaRange } from "@/lib/review-selection";

interface CategoryOption {
  readonly id: string;
  readonly name: string;
}

const publicationLabels: Record<InternalMediaView["publicationStatus"], string> = {
  draft: "尚未就绪",
  pending_review: "待审核",
  published: "已发布",
  hidden: "已隐藏",
  deleted: "已删除",
};

function preview(media: InternalMediaView) {
  return (
    media.variants.find((variant) => variant.kind === "photo_480") ??
    media.variants.find((variant) => variant.kind === "photo_960") ??
    null
  );
}

export function ReviewWorkspace({
  albumId,
  albumTitle,
  categories,
  initialPage,
  userRole,
  uploaders,
}: Readonly<{
  albumId: string;
  albumTitle: string;
  categories: readonly CategoryOption[];
  initialPage: InternalMediaList;
  userRole: "admin" | "reviewer";
  uploaders: readonly AlbumUploaderView[];
}>) {
  const [media, setMedia] = useState<readonly InternalMediaView[]>(initialPage.items);
  const [cursor, setCursor] = useState(initialPage.nextCursor);
  const [publication, setPublication] = useState("all");
  const [ingestGroup, setIngestGroup] = useState("all");
  const [category, setCategory] = useState("all");
  const [uploader, setUploader] = useState("all");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [rangeAnchor, setRangeAnchor] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<MediaBatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedCount = selected.size;
  const categoryItems = useMemo(
    () => [
      { label: "未分类", value: "uncategorized" },
      ...categories.map((item) => ({ label: item.name, value: item.id })),
    ],
    [categories],
  );

  useEffect(() => {
    setMedia(initialPage.items);
    setCursor(initialPage.nextCursor);
  }, [initialPage]);

  async function load(options: {
    readonly append: boolean;
    readonly cursor?: string;
  }): Promise<void> {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const query = new URLSearchParams({ limit: "60" });
      if (publication !== "all") query.set("publicationStatus", publication);
      if (ingestGroup !== "all") query.set("ingestGroup", ingestGroup);
      if (category !== "all" && category !== "uncategorized") query.set("categoryId", category);
      if (uploader !== "all") query.set("uploaderId", uploader);
      if (options.cursor !== undefined) query.set("cursor", options.cursor);
      const page = await clientGet<InternalMediaList>(
        `/api/v1/albums/${albumId}/media?${query.toString()}`,
      );
      setMedia((current) => (options.append ? [...current, ...page.items] : page.items));
      setCursor(page.nextCursor);
      if (!options.append) {
        setSelected(new Set());
        setRangeAnchor(null);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "媒体列表加载失败");
    } finally {
      setPending(false);
    }
  }

  async function batch(input: Omit<MediaBatchRequest, "mediaIds">): Promise<void> {
    if (pending || selectedCount === 0) return;
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const response = await clientMutation<MediaBatchResult>("/api/v1/media/batch", {
        body: { ...input, mediaIds: [...selected] },
        idempotencyKey: crypto.randomUUID(),
      });
      setResult(response);
      const succeeded = new Set(
        response.items.filter((item) => item.ok).map((item) => item.mediaId),
      );
      setMedia((current) =>
        current.map((item) => {
          if (!succeeded.has(item.id)) return item;
          if (input.action === "publish" || input.action === "restore") {
            return { ...item, publicationStatus: "published" as const };
          }
          if (input.action === "hide") return { ...item, publicationStatus: "hidden" as const };
          return { ...item, categoryId: input.categoryId ?? null };
        }),
      );
      const failedIds = response.items.filter((item) => !item.ok).map((item) => item.mediaId);
      setSelected(new Set(failedIds));
      setRangeAnchor(failedIds[0] ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "批量操作失败");
    } finally {
      setPending(false);
    }
  }

  function toggle(mediaId: string, checked: boolean): void {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(mediaId);
      else next.delete(mediaId);
      return next;
    });
    setRangeAnchor((current) => (checked ? mediaId : current === mediaId ? null : current));
  }

  function selectRange(targetId: string): void {
    if (rangeAnchor === null) return;
    setSelected((current) =>
      selectMediaRange(
        media.map((item) => item.id),
        current,
        rangeAnchor,
        targetId,
      ),
    );
  }

  function updateDeletion(mediaId: string, task: DeletionTaskView): void {
    setMedia((current) =>
      current.map((item) =>
        item.id === mediaId
          ? {
              ...item,
              publicationStatus: task.status === "completed" ? "deleted" : "hidden",
              deletionTask: {
                id: task.id,
                status: task.status,
                attempts: task.attempts,
                lastErrorCode: task.lastErrorCode,
              },
            }
          : item,
      ),
    );
  }

  async function retryDeletion(mediaId: string, taskId: string): Promise<void> {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const task = await clientMutation<DeletionTaskView>(`/api/v1/deletion-tasks/${taskId}/retry`);
      updateDeletion(mediaId, task);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除任务重试失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>筛选与选择</CardTitle>
          <CardDescription>可全选当前已加载筛选结果；批量结果逐项保留失败原因。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <Select
            items={[
              { label: "全部发布状态", value: "all" },
              { label: "待审核", value: "pending_review" },
              { label: "已发布", value: "published" },
              { label: "已隐藏", value: "hidden" },
              { label: "未就绪", value: "draft" },
            ]}
            onValueChange={(value) => setPublication(value ?? "all")}
            value={publication}
          >
            <SelectTrigger className="min-h-11" aria-label="发布状态筛选">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">全部发布状态</SelectItem>
                <SelectItem value="pending_review">待审核</SelectItem>
                <SelectItem value="published">已发布</SelectItem>
                <SelectItem value="hidden">已隐藏</SelectItem>
                <SelectItem value="draft">未就绪</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select
            items={[
              { label: "全部摄取状态", value: "all" },
              { label: "上传不完整", value: "incomplete" },
              { label: "上传失败", value: "failed" },
            ]}
            onValueChange={(value) => setIngestGroup(value ?? "all")}
            value={ingestGroup}
          >
            <SelectTrigger className="min-h-11" aria-label="摄取状态筛选">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">全部摄取状态</SelectItem>
                <SelectItem value="incomplete">上传不完整</SelectItem>
                <SelectItem value="failed">上传失败</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select
            items={[{ label: "全部分类", value: "all" }, ...categoryItems]}
            onValueChange={(value) => setCategory(value ?? "all")}
            value={category}
          >
            <SelectTrigger className="min-h-11" aria-label="分类筛选">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">全部分类</SelectItem>
                {categoryItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select
            items={[
              { label: "全部上传者", value: "all" },
              ...uploaders.map((item) => ({
                label: `${item.displayName}（${item.username}）`,
                value: item.id,
              })),
            ]}
            onValueChange={(value) => setUploader(value ?? "all")}
            value={uploader}
          >
            <SelectTrigger className="min-h-11" aria-label="上传者筛选">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">全部上传者</SelectItem>
                {uploaders.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.displayName}（{item.username}）
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button disabled={pending} onClick={() => void load({ append: false })} type="button">
            应用筛选
          </Button>
          <Button
            disabled={media.length === 0}
            onClick={() => {
              setSelected(new Set(media.map((item) => item.id)));
              setRangeAnchor(media[0]?.id ?? null);
            }}
            type="button"
            variant="outline"
          >
            全选已加载结果
          </Button>
        </CardContent>
      </Card>

      {error === null ? null : (
        <Alert variant="destructive">
          <AlertTitle>操作失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {result === null ? null : (
        <Alert>
          <AlertTitle>
            批量结果：成功 {result.items.filter((item) => item.ok).length}，失败{" "}
            {result.items.filter((item) => !item.ok).length}
          </AlertTitle>
          <AlertDescription>
            {result.items
              .filter((item) => !item.ok)
              .map((item) => `${item.mediaId.slice(-8)}：${item.message ?? item.code}`)
              .join("；") || "所有选中媒体均已完成。"}
          </AlertDescription>
        </Alert>
      )}

      {media.length === 0 ? (
        <Empty className="min-h-64 border">
          <EmptyHeader>
            <EmptyTitle>当前筛选没有媒体</EmptyTitle>
            <EmptyDescription>调整筛选，或等待上传者完成预览。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {media.map((item) => {
            const image = preview(item);
            return (
              <Card
                data-selected={selected.has(item.id) ? true : undefined}
                key={item.id}
                size="sm"
              >
                {image === null ? null : (
                  <div className="relative aspect-square bg-muted">
                    <Image
                      alt="待审核活动照片"
                      fill
                      sizes="(max-width: 639px) 100vw, (max-width: 1023px) 50vw, 25vw"
                      src={image.url}
                      style={{ objectFit: "cover" }}
                      unoptimized
                    />
                  </div>
                )}
                <CardHeader>
                  <CardTitle>照片 {item.id.slice(-8)}</CardTitle>
                  <CardDescription>
                    {item.width}×{item.height} · {item.ingestStatus}
                  </CardDescription>
                  <CardAction>
                    <Checkbox
                      aria-label={`选择照片 ${item.id.slice(-8)}`}
                      checked={selected.has(item.id)}
                      onCheckedChange={(checked) => toggle(item.id, checked)}
                    />
                  </CardAction>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <div className="flex flex-wrap gap-2">
                    <Badge
                      variant={item.publicationStatus === "published" ? "default" : "secondary"}
                    >
                      {publicationLabels[item.publicationStatus]}
                    </Badge>
                    {item.deletionTask === null ? null : (
                      <Badge
                        variant={item.deletionTask.status === "failed" ? "destructive" : "outline"}
                      >
                        删除 {item.deletionTask.status}
                      </Badge>
                    )}
                    {rangeAnchor === item.id ? <Badge variant="outline">范围起点</Badge> : null}
                  </div>
                  {rangeAnchor !== null && rangeAnchor !== item.id ? (
                    <Button
                      aria-label={`从范围起点选择到照片 ${item.id.slice(-8)}`}
                      onClick={() => selectRange(item.id)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      选择到这里
                    </Button>
                  ) : null}
                  {userRole === "admin" && item.deletionTask?.status === "failed" ? (
                    <Button
                      disabled={pending}
                      onClick={() => void retryDeletion(item.id, item.deletionTask?.id ?? "")}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <RotateCcwIcon data-icon="inline-start" />
                      {pending ? "正在重试…" : "重试删除任务"}
                    </Button>
                  ) : null}
                  {userRole === "admin" &&
                  item.publicationStatus !== "deleted" &&
                  item.deletionTask === null ? (
                    <DeleteMediaButton
                      albumTitle={albumTitle}
                      mediaId={item.id}
                      onTask={(task) => updateDeletion(item.id, task)}
                    />
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {cursor === null ? null : (
        <Button
          className="self-center"
          disabled={pending}
          onClick={() => void load({ append: true, cursor })}
          type="button"
          variant="outline"
        >
          加载更多
        </Button>
      )}

      {selectedCount === 0 ? null : (
        <div className="sticky bottom-3 flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3 shadow-lg">
          <p className="mr-auto text-sm font-medium">已选择 {selectedCount} 项</p>
          <Button disabled={pending} onClick={() => void batch({ action: "publish" })} size="sm">
            <SendIcon data-icon="inline-start" />
            发布
          </Button>
          <Button
            disabled={pending}
            onClick={() => void batch({ action: "hide" })}
            size="sm"
            variant="outline"
          >
            <EyeOffIcon data-icon="inline-start" />
            隐藏
          </Button>
          <Button
            disabled={pending}
            onClick={() => void batch({ action: "restore" })}
            size="sm"
            variant="outline"
          >
            <EyeIcon data-icon="inline-start" />
            恢复
          </Button>
          <Select
            items={categoryItems}
            onValueChange={(value) => {
              if (typeof value !== "string") return;
              void batch({
                action: "change_category",
                categoryId: value === "uncategorized" ? null : value,
              });
            }}
          >
            <SelectTrigger aria-label="批量改分类" className="min-h-8">
              <FolderInputIcon aria-hidden="true" />
              <SelectValue placeholder="改分类" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {categoryItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button
            onClick={() => {
              setSelected(new Set());
              setRangeAnchor(null);
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            <XIcon data-icon="inline-start" />
            取消选择
          </Button>
        </div>
      )}
    </div>
  );
}
