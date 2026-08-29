"use client";

import type {
  AlbumUploaderView,
  BibBatchResult,
  BibConfigView,
  BibMediaState,
  DeletionTaskView,
  InternalMediaList,
  InternalMediaView,
  MediaBatchRequest,
  MediaBatchResult,
} from "@photostream/contracts";
import { EyeIcon, EyeOffIcon, FolderInputIcon, RotateCcwIcon, SendIcon, XIcon } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { BibReviewControls } from "@/components/bib/bib-review-controls";
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
  bibConfig,
  categories,
  initialPage,
  userRole,
  uploaders,
}: Readonly<{
  albumId: string;
  albumTitle: string;
  bibConfig: BibConfigView;
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
  const [bibDecision, setBibDecision] = useState("all");
  const [bibOcrStatus, setBibOcrStatus] = useState("all");
  const [gradeOptionId, setGradeOptionId] = useState("all");
  const [classOptionId, setClassOptionId] = useState("all");
  const [showCandidateBoxes, setShowCandidateBoxes] = useState(true);
  const [batchBibNumber, setBatchBibNumber] = useState("");
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

  async function fetchPage(pageCursor?: string): Promise<InternalMediaList> {
    const query = new URLSearchParams({ limit: "60" });
    if (publication !== "all") query.set("publicationStatus", publication);
    if (ingestGroup !== "all") query.set("ingestGroup", ingestGroup);
    if (category !== "all" && category !== "uncategorized") query.set("categoryId", category);
    if (uploader !== "all") query.set("uploaderId", uploader);
    if (bibDecision !== "all") query.set("bibReviewDecision", bibDecision);
    if (bibOcrStatus !== "all") query.set("bibOcrStatus", bibOcrStatus);
    if (gradeOptionId !== "all") query.set("gradeOptionId", gradeOptionId);
    if (classOptionId !== "all") query.set("classOptionId", classOptionId);
    if (pageCursor !== undefined) query.set("cursor", pageCursor);
    return clientGet<InternalMediaList>(`/api/v1/albums/${albumId}/media?${query.toString()}`);
  }

  async function load(options: {
    readonly append: boolean;
    readonly cursor?: string;
  }): Promise<void> {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const page = await fetchPage(options.cursor);
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

  async function bibBatch(path: string, body: unknown): Promise<void> {
    if (pending || selectedCount === 0) return;
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const response = await clientMutation<BibBatchResult>(path, {
        body,
        idempotencyKey: crypto.randomUUID(),
      });
      setResult(response);
      const failedIds = response.items.filter((item) => !item.ok).map((item) => item.mediaId);
      if (failedIds.length === 0) setBatchBibNumber("");
      try {
        const page = await fetchPage();
        setMedia(page.items);
        setCursor(page.nextCursor);
      } catch {
        setError("号码操作已完成，但媒体列表刷新失败；请手工重新应用筛选。");
      }
      setSelected(new Set(failedIds));
      setRangeAnchor(failedIds[0] ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "批量号码操作失败");
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

  function updateBib(mediaId: string, bib: BibMediaState): void {
    setMedia((current) => current.map((item) => (item.id === mediaId ? { ...item, bib } : item)));
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
        <CardContent className="flex flex-col gap-3">
          <FieldGroup className="flex flex-wrap items-end gap-3">
            <Field>
              <FieldLabel className="sr-only" htmlFor="review-publication-filter">
                发布状态筛选
              </FieldLabel>
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
                <SelectTrigger className="min-h-11" id="review-publication-filter">
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
            </Field>
            <Field>
              <FieldLabel className="sr-only" htmlFor="review-ocr-filter">
                OCR 活动状态筛选
              </FieldLabel>
              <Select
                items={[
                  { label: "全部 OCR 状态", value: "all" },
                  { label: "等待 OCR", value: "not_started" },
                  { label: "识别中", value: "processing" },
                  { label: "OCR 已完成", value: "completed" },
                  { label: "识别失败", value: "failed" },
                  { label: "设备不支持", value: "unsupported" },
                ]}
                onValueChange={(value) => setBibOcrStatus(value ?? "all")}
                value={bibOcrStatus}
              >
                <SelectTrigger className="min-h-11" id="review-ocr-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">全部 OCR 状态</SelectItem>
                    <SelectItem value="not_started">等待 OCR</SelectItem>
                    <SelectItem value="processing">识别中</SelectItem>
                    <SelectItem value="completed">OCR 已完成</SelectItem>
                    <SelectItem value="failed">识别失败</SelectItem>
                    <SelectItem value="unsupported">设备不支持</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel className="sr-only" htmlFor="review-bib-decision-filter">
                号码复核状态筛选
              </FieldLabel>
              <Select
                items={[
                  { label: "全部号码复核状态", value: "all" },
                  { label: "待复核", value: "pending" },
                  { label: "有确认号码", value: "numbers_confirmed" },
                  { label: "确认无号码", value: "no_number_confirmed" },
                  { label: "需复核", value: "needs_review" },
                ]}
                onValueChange={(value) => setBibDecision(value ?? "all")}
                value={bibDecision}
              >
                <SelectTrigger className="min-h-11" id="review-bib-decision-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">全部号码复核状态</SelectItem>
                    <SelectItem value="pending">待复核</SelectItem>
                    <SelectItem value="numbers_confirmed">有确认号码</SelectItem>
                    <SelectItem value="no_number_confirmed">确认无号码</SelectItem>
                    <SelectItem value="needs_review">需复核</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel className="sr-only" htmlFor="review-grade-filter">
                号码年级筛选
              </FieldLabel>
              <Select
                items={[
                  { label: "全部年级", value: "all" },
                  ...bibConfig.attributeOptions
                    .filter((option) => option.dimension === "grade" && option.enabled)
                    .map((option) => ({ label: option.displayName, value: option.id })),
                ]}
                onValueChange={(value) => {
                  setGradeOptionId(value ?? "all");
                  setClassOptionId("all");
                }}
                value={gradeOptionId}
              >
                <SelectTrigger className="min-h-11" id="review-grade-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">全部年级</SelectItem>
                    {bibConfig.attributeOptions
                      .filter((option) => option.dimension === "grade" && option.enabled)
                      .map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.displayName}
                        </SelectItem>
                      ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field data-disabled={gradeOptionId === "all" || undefined}>
              <FieldLabel className="sr-only" htmlFor="review-class-filter">
                号码班级筛选
              </FieldLabel>
              <Select
                disabled={gradeOptionId === "all"}
                items={[
                  { label: "全部班级", value: "all" },
                  ...bibConfig.attributeOptions
                    .filter((option) => option.dimension === "class" && option.enabled)
                    .map((option) => ({ label: option.displayName, value: option.id })),
                ]}
                onValueChange={(value) => setClassOptionId(value ?? "all")}
                value={classOptionId}
              >
                <SelectTrigger className="min-h-11" id="review-class-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">全部班级</SelectItem>
                    {bibConfig.attributeOptions
                      .filter((option) => option.dimension === "class" && option.enabled)
                      .map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.displayName}
                        </SelectItem>
                      ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel className="sr-only" htmlFor="review-ingest-filter">
                摄取状态筛选
              </FieldLabel>
              <Select
                items={[
                  { label: "全部摄取状态", value: "all" },
                  { label: "上传不完整", value: "incomplete" },
                  { label: "上传失败", value: "failed" },
                ]}
                onValueChange={(value) => setIngestGroup(value ?? "all")}
                value={ingestGroup}
              >
                <SelectTrigger className="min-h-11" id="review-ingest-filter">
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
            </Field>
            <Field>
              <FieldLabel className="sr-only" htmlFor="review-category-filter">
                分类筛选
              </FieldLabel>
              <Select
                items={[{ label: "全部分类", value: "all" }, ...categoryItems]}
                onValueChange={(value) => setCategory(value ?? "all")}
                value={category}
              >
                <SelectTrigger className="min-h-11" id="review-category-filter">
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
            </Field>
            <Field>
              <FieldLabel className="sr-only" htmlFor="review-uploader-filter">
                上传者筛选
              </FieldLabel>
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
                <SelectTrigger className="min-h-11" id="review-uploader-filter">
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
            </Field>
          </FieldGroup>
          <div className="flex flex-wrap gap-3">
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
            <Button
              onClick={() => setShowCandidateBoxes((current) => !current)}
              type="button"
              variant="outline"
            >
              {showCandidateBoxes ? "隐藏候选框" : "显示候选框"}
            </Button>
          </div>
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
                  <div className="flex aspect-square items-center justify-center bg-muted">
                    <div
                      className="relative max-h-full max-w-full text-primary"
                      style={
                        item.width >= item.height
                          ? { aspectRatio: `${item.width} / ${item.height}`, width: "100%" }
                          : { aspectRatio: `${item.width} / ${item.height}`, height: "100%" }
                      }
                    >
                      <Image
                        alt="待审核活动照片"
                        className="object-contain"
                        fill
                        sizes="(max-width: 639px) 100vw, (max-width: 1023px) 50vw, 25vw"
                        src={image.url}
                        unoptimized
                      />
                      {showCandidateBoxes && item.bib !== undefined ? (
                        <svg
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-0 size-full"
                          preserveAspectRatio="none"
                          viewBox="0 0 100 100"
                        >
                          {item.bib.tags.flatMap((tag) =>
                            tag.quadrilateral === null
                              ? []
                              : [
                                  <polygon
                                    fill="none"
                                    key={tag.id}
                                    points={tag.quadrilateral
                                      .map((point) => `${point.x * 100},${point.y * 100}`)
                                      .join(" ")}
                                    stroke="currentColor"
                                    strokeWidth="1.5"
                                    vectorEffect="non-scaling-stroke"
                                  />,
                                ],
                          )}
                        </svg>
                      ) : null}
                    </div>
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
                  {bibConfig.ruleUsable ? (
                    <BibReviewControls
                      initial={
                        item.bib ?? {
                          tags: [],
                          review: {
                            mediaId: item.id,
                            decision: "pending",
                            ocrStatus: "not_started",
                            ocrModelVersion: null,
                            decidedAt: null,
                          },
                        }
                      }
                      mediaId={item.id}
                      onChange={(bib) => updateBib(item.id, bib)}
                      options={bibConfig.attributeOptions}
                    />
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
          <Field>
            <FieldLabel className="sr-only" htmlFor="review-batch-category">
              批量改分类
            </FieldLabel>
            <Select
              items={[{ label: "改分类", value: null }, ...categoryItems]}
              onValueChange={(value) => {
                if (typeof value !== "string") return;
                void batch({
                  action: "change_category",
                  categoryId: value === "uncategorized" ? null : value,
                });
              }}
            >
              <SelectTrigger className="min-h-8" id="review-batch-category">
                <FolderInputIcon aria-hidden="true" />
                <SelectValue />
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
          </Field>
          {bibConfig.ruleUsable ? (
            <>
              <Field className="w-36">
                <FieldLabel className="sr-only" htmlFor="review-batch-bib-number">
                  批量手工号码
                </FieldLabel>
                <Input
                  id="review-batch-bib-number"
                  inputMode="numeric"
                  maxLength={12}
                  onChange={(event) => setBatchBibNumber(event.currentTarget.value)}
                  placeholder="同一号码"
                  value={batchBibNumber}
                />
              </Field>
              <Button
                disabled={pending || batchBibNumber.length === 0}
                onClick={() =>
                  void bibBatch("/api/v1/media/bib-tags/batch", {
                    mediaIds: [...selected],
                    number: batchBibNumber,
                  })
                }
                size="sm"
                type="button"
                variant="outline"
              >
                批量添加号码
              </Button>
              <Button
                disabled={pending}
                onClick={() =>
                  void bibBatch("/api/v1/media/bib-review/no-number/batch", {
                    mediaIds: [...selected],
                  })
                }
                size="sm"
                type="button"
                variant="outline"
              >
                批量确认无号码
              </Button>
            </>
          ) : null}
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
