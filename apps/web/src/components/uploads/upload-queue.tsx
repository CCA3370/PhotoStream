"use client";

import type { BibConfigView } from "@photostream/contracts";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  FolderOpenIcon,
  ImagePlusIcon,
  LoaderCircleIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PhotoEditorDialog } from "@/components/review/photo-editor-dialog";
import { UploadShell } from "@/components/shells/upload-shell";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { resumeLocalBibOcr } from "@/lib/local-bib-ocr";
import {
  getLocalProcessingRuntime,
  type LocalProcessingTaskStatus,
  type LocalProcessingTaskView,
} from "@/lib/local-processing-runtime";
import {
  deleteLocalReviewPhoto,
  type LocalReviewPhoto,
  listLocalReviewPhotos,
  localQueueSupported,
} from "@/lib/local-review-queue";
import { syncLocalPhotoEditDraft } from "@/lib/photo-edit/local-draft-sync";
import {
  deleteLocalPhotoEditDraft,
  getLocalPhotoEditDraft,
  type LocalPhotoEditDraft,
} from "@/lib/photo-edit/local-drafts";
import { cn } from "@/lib/utils";

interface CategoryOption {
  readonly id: string;
  readonly name: string;
}

interface PreviewPhoto {
  readonly photo: LocalReviewPhoto;
  readonly url: string;
  readonly editDraft: LocalPhotoEditDraft | null;
}

const acceptedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(bytes >= 10 * 1024 ** 2 ? 0 : 1)} MB`;
}

function taskLabel(status: LocalProcessingTaskStatus): string {
  if (status === "queued") return "等待处理";
  if (status === "processing") return "处理中并上传";
  if (status === "staged") return "已上传（默认隐藏）";
  return "处理或上传失败";
}

function editDraftLabel(draft: LocalPhotoEditDraft | null): string {
  if (draft === null) return "未修图";
  if (draft.editState === "applied_local") return "已应用 · 本地";
  if (draft.editState === "syncing") return "正在同步修图版本";
  if (draft.editState === "synced") return "修图版本已同步";
  if (draft.editState === "failed") return "修图同步失败";
  return "已修改 · 未应用";
}

export function UploadQueue({
  albumId,
  bibConfig,
  categories,
  role,
}: Readonly<{
  albumId: string;
  albumTitle: string;
  bibConfig: BibConfigView;
  categories: readonly CategoryOption[];
  role: "admin" | "uploader";
}>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const directoryInputRef = useRef<HTMLInputElement>(null);
  const previewUrls = useRef<string[]>([]);
  const runtime = useMemo(() => getLocalProcessingRuntime(albumId), [albumId]);
  const [categoryId, setCategoryId] = useState("uncategorized");
  const [items, setItems] = useState<readonly PreviewPhoto[]>([]);
  const [tasks, setTasks] = useState<readonly LocalProcessingTaskView[]>([]);
  const [paused, setPaused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [showUploaded, setShowUploaded] = useState(false);
  const [editingLocalPhotoId, setEditingLocalPhotoId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const allRows = await listLocalReviewPhotos(albumId);
    const rows = showUploaded
      ? allRows
      : allRows.filter((photo) => photo.uploadState !== "published");
    for (const url of previewUrls.current) URL.revokeObjectURL(url);
    const next = await Promise.all(
      rows.map(async (photo) => {
        const preview =
          photo.variants.find((variant) => variant.kind === "photo_480")?.blob ??
          photo.originalBlob;
        return {
          photo,
          url: URL.createObjectURL(preview),
          editDraft: await getLocalPhotoEditDraft(photo.id),
        };
      }),
    );
    previewUrls.current = next.map((item) => item.url);
    setItems(next);
  }, [albumId, showUploaded]);

  useEffect(() => {
    runtime.configure(bibConfig);
    const unsubscribe = runtime.subscribe((snapshot) => {
      setTasks(snapshot.tasks);
      setPaused(snapshot.paused);
    });
    void runtime.initialize().catch((error) => {
      toast.add({
        title: "上传队列恢复失败",
        description: error instanceof Error ? error.message : "无法恢复未完成的上传任务",
        type: "error",
      });
    });
    return unsubscribe;
  }, [bibConfig, runtime]);

  async function enqueue(files: readonly File[]): Promise<void> {
    if (files.length === 0) return;
    if (!localQueueSupported()) {
      toast.add({ title: "当前浏览器不支持本地上传队列", type: "error" });
      return;
    }
    const valid = files.filter((file) => acceptedTypes.has(file.type));
    const skipped = files.length - valid.length;
    const selectedCategory = categoryId === "uncategorized" ? null : categoryId;
    try {
      if (valid.length > 0) {
        await runtime.enqueue(valid, selectedCategory);
        toast.add({
          title: `已开始处理并上传 ${valid.length} 张`,
          description:
            "原图会立即开始上传，派生图生成后随即上传；完成后默认隐藏。原图同时保留在本机供管理端优先预览。",
          type: "success",
        });
      }
      if (skipped > 0) {
        toast.add({
          title: `已跳过 ${skipped} 个不支持的文件`,
          description: "当前支持 JPEG、PNG 和 WebP。",
          type: "warning",
        });
      }
    } catch (error) {
      toast.add({
        title: "无法加入上传队列",
        description:
          error instanceof Error ? error.message : "浏览器本地存储空间可能不足，请释放空间后重试。",
        type: "error",
      });
    } finally {
      if (inputRef.current !== null) inputRef.current.value = "";
      if (directoryInputRef.current !== null) directoryInputRef.current.value = "";
    }
  }

  useEffect(() => {
    if (directoryInputRef.current !== null) {
      directoryInputRef.current.setAttribute("webkitdirectory", "");
      directoryInputRef.current.setAttribute("directory", "");
    }
  }, []);

  useEffect(() => {
    void refresh();
    void resumeLocalBibOcr(albumId, bibConfig);
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ readonly albumId?: string }>).detail;
      if (detail?.albumId === albumId) void refresh();
    };
    const editChanged = () => void refresh();
    window.addEventListener("photostream:local-review-changed", changed);
    window.addEventListener("photostream:local-photo-edit-draft-changed", editChanged);
    return () => {
      window.removeEventListener("photostream:local-review-changed", changed);
      window.removeEventListener("photostream:local-photo-edit-draft-changed", editChanged);
      for (const url of previewUrls.current) URL.revokeObjectURL(url);
      previewUrls.current = [];
    };
  }, [albumId, bibConfig, refresh]);

  const queueCounts = useMemo(() => {
    let queued = 0;
    let processing = 0;
    let failed = 0;
    let completed = 0;
    for (const task of tasks) {
      if (task.status === "queued") queued += 1;
      else if (task.status === "processing") processing += 1;
      else if (task.status === "failed") failed += 1;
      else if (task.status === "staged") completed += 1;
    }
    return { queued, processing, failed, completed };
  }, [tasks]);

  useEffect(() => {
    const hasUnfinished = queueCounts.queued > 0 || queueCounts.processing > 0;
    if (!hasUnfinished) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [queueCounts.processing, queueCounts.queued]);

  function retryFailed(): void {
    void runtime.retryFailed().catch((error) => {
      toast.add({
        title: "重试队列失败",
        description: error instanceof Error ? error.message : "无法更新上传队列",
        type: "error",
      });
    });
  }

  function retryEditSync(localPhotoId: string): void {
    void syncLocalPhotoEditDraft(localPhotoId)
      .then(async () => {
        const draft = await getLocalPhotoEditDraft(localPhotoId);
        if (draft?.editState === "failed") {
          toast.add({
            title: "修图版本仍未同步",
            description: draft.error ?? "请稍后重试。",
            type: "error",
          });
          return;
        }
        toast.add({ title: "修图版本已同步", type: "success" });
      })
      .catch((error) => {
        toast.add({
          title: "无法同步修图版本",
          description: error instanceof Error ? error.message : "请稍后重试。",
          type: "error",
        });
      });
  }

  const visibleTasks = tasks.filter((task) => task.status !== "staged");

  return (
    <UploadShell
      queue={{
        paused,
        queued: queueCounts.queued,
        processing: queueCounts.processing,
        failed: queueCounts.failed,
        retryableFailed: queueCounts.failed,
        pendingReview: items.filter((item) => item.photo.uploadState !== "published").length,
        completed: queueCounts.completed,
        total: tasks.length,
        onTogglePause: () => runtime.togglePause(),
        onRetryFailed: retryFailed,
        onClearCompleted: () => runtime.clearCompleted(),
      }}
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            items={[
              { label: "未分类", value: "uncategorized" },
              ...categories.map((category) => ({ label: category.name, value: category.id })),
            ]}
            onValueChange={(value) => setCategoryId(value ?? "uncategorized")}
            value={categoryId}
          >
            <SelectTrigger className="h-9 w-40" aria-label="选择分类">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="uncategorized">未分类</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button onClick={() => inputRef.current?.click()} size="sm" type="button">
            <ImagePlusIcon data-icon="inline-start" />
            选择图片
          </Button>
          <Button
            onClick={() => directoryInputRef.current?.click()}
            size="sm"
            type="button"
            variant="outline"
          >
            <FolderOpenIcon data-icon="inline-start" />
            选择文件夹
          </Button>
          <Button
            onClick={() => setShowUploaded((current) => !current)}
            size="sm"
            type="button"
            variant="outline"
          >
            {showUploaded ? "只看进行中" : "显示已上传"}
          </Button>
          {role === "admin" ? (
            <Link
              className={buttonVariants({ size: "sm", variant: "outline" })}
              href={`/studio/albums/${albumId}/review`}
            >
              前往审核
            </Link>
          ) : null}
        </div>

        <input
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          id="photo-files"
          multiple
          onChange={(event) => void enqueue(Array.from(event.currentTarget.files ?? []))}
          ref={inputRef}
          type="file"
        />
        <input
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          multiple
          onChange={(event) => void enqueue(Array.from(event.currentTarget.files ?? []))}
          ref={directoryInputRef}
          type="file"
        />

        <button
          className={cn(
            "flex min-h-36 w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-4 text-center transition-colors",
            dragging ? "border-primary bg-primary/5" : "bg-muted/15 hover:bg-muted/30",
          )}
          onClick={() => inputRef.current?.click()}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            setDragging(false);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void enqueue(Array.from(event.dataTransfer.files));
          }}
          type="button"
        >
          <ImagePlusIcon className="size-5 text-muted-foreground" />
          <span className="text-sm font-medium">拖入图片即开始上传</span>
          <span className="text-xs text-muted-foreground">
            上传完成后默认隐藏，可在审核页切换为显示
          </span>
        </button>

        {role === "uploader" && items.length > 0 ? (
          <div className="rounded-lg border bg-muted/20 px-4 py-3 text-sm">
            <p className="font-medium">
              {showUploaded
                ? `当前显示本机保留的 ${items.length} 张照片`
                : `当前有 ${items.length} 张照片仍在处理或等待重试`}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              原图保留在当前浏览器，可在上传前、上传中或上传后继续修图；远端照片保持隐藏，需由审核员或管理员切换为显示。
            </p>
          </div>
        ) : null}

        {visibleTasks.length === 0 ? null : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium">本轮任务</h3>
              <span className="text-xs text-muted-foreground">失败项会保留，可批量重试</span>
            </div>
            <div className="divide-y rounded-lg border">
              {visibleTasks.map((task) => (
                <div className="flex items-start gap-3 px-3 py-2.5" key={task.id}>
                  <div className="mt-0.5 text-muted-foreground">
                    {task.status === "processing" ? (
                      <LoaderCircleIcon className="size-4 animate-spin" />
                    ) : task.status === "failed" ? (
                      <CircleAlertIcon className="size-4 text-destructive" />
                    ) : (
                      <CircleCheckIcon className="size-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{task.fileName}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatBytes(task.bytes)} · {taskLabel(task.status)}
                    </p>
                    {task.error === null ? null : (
                      <p className="mt-1 text-xs text-destructive">{task.error}</p>
                    )}
                  </div>
                  <Badge variant={task.status === "failed" ? "destructive" : "outline"}>
                    {taskLabel(task.status)}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {items.length === 0 ? null : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium">
                {showUploaded ? "本机照片" : "处理中 / 上传失败"}
              </h3>
              <span className="text-xs text-muted-foreground">{items.length} 张</span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
              {items.map(({ photo, url, editDraft }) => (
                <div
                  className="group overflow-hidden rounded-lg border bg-card"
                  data-local-photo-id={photo.id}
                  data-ocr-status={photo.bib.ocrStatus}
                  key={photo.id}
                >
                  <div className="relative aspect-[4/3] overflow-hidden bg-muted">
                    <Image
                      alt={photo.fileName}
                      className="object-cover"
                      fill
                      sizes="200px"
                      src={url}
                      unoptimized
                    />
                    <Button
                      aria-label="修图"
                      className="absolute left-1 top-1 size-8 shadow-sm"
                      onClick={() => setEditingLocalPhotoId(photo.id)}
                      size="icon"
                      type="button"
                      variant="secondary"
                    >
                      <SlidersHorizontalIcon className="size-3.5" />
                    </Button>
                    <Button
                      aria-label="从本地队列删除"
                      className="absolute right-1 top-1 size-8 opacity-0 shadow-sm group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={() =>
                        void Promise.all([
                          deleteLocalReviewPhoto(photo.id),
                          deleteLocalPhotoEditDraft(photo.id),
                        ])
                      }
                      size="icon"
                      type="button"
                      variant="destructive"
                    >
                      <Trash2Icon className="size-3.5" />
                    </Button>
                  </div>
                  <div className="p-2">
                    <p className="truncate text-xs font-medium">{photo.fileName}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {formatBytes(photo.totalBytes)} ·{" "}
                      {photo.uploadState === "failed"
                        ? "上传失败"
                        : photo.uploadState === "published"
                          ? "已上传"
                          : "上传中"}
                    </p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <p
                        className={cn(
                          "text-[11px]",
                          editDraft?.editState === "failed"
                            ? "text-destructive"
                            : "text-muted-foreground",
                        )}
                      >
                        {editDraftLabel(editDraft)}
                      </p>
                      {photo.mediaId !== null &&
                      editDraft !== null &&
                      (editDraft.editState === "failed" ||
                        editDraft.editState === "applied_local") ? (
                        <button
                          className="text-[11px] font-medium text-primary hover:underline"
                          onClick={() => retryEditSync(photo.id)}
                          type="button"
                        >
                          {editDraft.editState === "failed" ? "重试同步" : "同步修图"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <PhotoEditorDialog
        localPhotoId={editingLocalPhotoId}
        mediaId={null}
        onApplied={refresh}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setEditingLocalPhotoId(null);
        }}
        open={editingLocalPhotoId !== null}
      />
    </UploadShell>
  );
}
