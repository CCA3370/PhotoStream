"use client";

import type { BibConfigView } from "@photostream/contracts";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  FolderOpenIcon,
  ImagePlusIcon,
  LoaderCircleIcon,
  Trash2Icon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
import { resumeLocalBibOcr, startLocalBibOcr } from "@/lib/local-bib-ocr";
import {
  createLocalReviewPhoto,
  deleteLocalReviewPhoto,
  type LocalReviewPhoto,
  listLocalReviewPhotos,
  localQueueSupported,
  putLocalReviewPhoto,
} from "@/lib/local-review-queue";
import { processPhotoInWorker } from "@/lib/photo-processing";
import { cn } from "@/lib/utils";

interface CategoryOption {
  readonly id: string;
  readonly name: string;
}

interface PreviewPhoto {
  readonly photo: LocalReviewPhoto;
  readonly url: string;
}

type QueueTaskStatus = "queued" | "processing" | "staged" | "failed";

interface QueueTask {
  readonly id: string;
  readonly file: File;
  readonly categoryId: string | null;
  status: QueueTaskStatus;
  error: string | null;
}

interface QueueTaskView {
  readonly id: string;
  readonly fileName: string;
  readonly bytes: number;
  readonly status: QueueTaskStatus;
  readonly error: string | null;
}

const processingConcurrency = 3;
const acceptedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(bytes >= 10 * 1024 ** 2 ? 0 : 1)} MB`;
}

function taskLabel(status: QueueTaskStatus): string {
  if (status === "queued") return "等待处理";
  if (status === "processing") return "本地处理中";
  if (status === "staged") return "已进入本机审核队列";
  return "处理失败";
}

export function UploadQueue({
  albumId,
  albumTitle,
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
  const taskStore = useRef(new Map<string, QueueTask>());
  const runningTasks = useRef(0);
  const pausedRef = useRef(false);
  const [categoryId, setCategoryId] = useState("uncategorized");
  const [items, setItems] = useState<readonly PreviewPhoto[]>([]);
  const [tasks, setTasks] = useState<readonly QueueTaskView[]>([]);
  const [paused, setPaused] = useState(false);
  const [dragging, setDragging] = useState(false);

  const syncTasks = useCallback(() => {
    setTasks(
      [...taskStore.current.values()].map((task) => ({
        id: task.id,
        fileName: task.file.name,
        bytes: task.file.size,
        status: task.status,
        error: task.error,
      })),
    );
  }, []);

  const refresh = useCallback(async () => {
    const rows = (await listLocalReviewPhotos(albumId)).filter(
      (photo) => photo.uploadState !== "published",
    );
    for (const url of previewUrls.current) URL.revokeObjectURL(url);
    const next = rows.map((photo) => {
      const preview =
        photo.variants.find((variant) => variant.kind === "photo_480")?.blob ?? photo.originalBlob;
      return { photo, url: URL.createObjectURL(preview) };
    });
    previewUrls.current = next.map((item) => item.url);
    setItems(next);
  }, [albumId]);

  async function runTask(task: QueueTask): Promise<void> {
    task.status = "processing";
    task.error = null;
    runningTasks.current += 1;
    syncTasks();
    try {
      const processed = await processPhotoInWorker(task.file);
      const created = createLocalReviewPhoto({
        albumId,
        categoryId: task.categoryId,
        file: task.file,
        processed,
      });
      const localPhoto: LocalReviewPhoto = {
        ...created,
        bib: {
          ...created.bib,
          ocrStatus: bibConfig.recognitionEnabled ? "not_started" : "disabled",
          modelVersion: bibConfig.modelVersion,
          ruleVersion: bibConfig.ruleVersion,
        },
      };
      await putLocalReviewPhoto(localPhoto);
      startLocalBibOcr(localPhoto.id, bibConfig);
      task.status = "staged";
      task.error = null;
      await refresh();
    } catch (error) {
      task.status = "failed";
      task.error = error instanceof Error ? error.message : "本地处理失败";
    } finally {
      runningTasks.current = Math.max(0, runningTasks.current - 1);
      syncTasks();
      pump();
    }
  }

  function pump(): void {
    if (pausedRef.current) return;
    while (runningTasks.current < processingConcurrency) {
      const next = [...taskStore.current.values()].find((task) => task.status === "queued");
      if (next === undefined) break;
      void runTask(next);
    }
  }

  function enqueue(files: readonly File[]): void {
    if (files.length === 0) return;
    if (!localQueueSupported()) {
      toast.add({ title: "当前浏览器不支持本地审核队列", type: "error" });
      return;
    }
    const valid = files.filter((file) => acceptedTypes.has(file.type));
    const skipped = files.length - valid.length;
    const selectedCategory = categoryId === "uncategorized" ? null : categoryId;
    for (const file of valid) {
      const id = crypto.randomUUID();
      taskStore.current.set(id, {
        id,
        file,
        categoryId: selectedCategory,
        status: "queued",
        error: null,
      });
    }
    syncTasks();
    pump();
    if (valid.length > 0) {
      toast.add({
        title: `已加入处理队列 ${valid.length} 张`,
        description: "不会在审核通过前上传。",
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
    if (inputRef.current !== null) inputRef.current.value = "";
    if (directoryInputRef.current !== null) directoryInputRef.current.value = "";
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
    window.addEventListener("photostream:local-review-changed", changed);
    return () => {
      window.removeEventListener("photostream:local-review-changed", changed);
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

  function togglePause(): void {
    const next = !pausedRef.current;
    pausedRef.current = next;
    setPaused(next);
    if (!next) pump();
  }

  function retryFailed(): void {
    for (const task of taskStore.current.values()) {
      if (task.status !== "failed") continue;
      task.status = "queued";
      task.error = null;
    }
    syncTasks();
    if (pausedRef.current) {
      pausedRef.current = false;
      setPaused(false);
    }
    pump();
  }

  function clearCompleted(): void {
    for (const [id, task] of taskStore.current) {
      if (task.status === "staged") taskStore.current.delete(id);
    }
    syncTasks();
  }

  const visibleTasks = tasks.filter((task) => task.status !== "staged");

  return (
    <UploadShell
      albumTitle={albumTitle}
      queue={{
        paused,
        queued: queueCounts.queued,
        processing: queueCounts.processing,
        failed: queueCounts.failed,
        retryableFailed: queueCounts.failed,
        pendingReview: items.length,
        completed: queueCounts.completed,
        total: tasks.length,
        onTogglePause: togglePause,
        onRetryFailed: retryFailed,
        onClearCompleted: clearCompleted,
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
          {role === "admin" ? (
            <Link
              className={buttonVariants({ size: "sm", variant: "outline" })}
              href={`/studio/albums/${albumId}/review`}
            >
              前往审核
            </Link>
          ) : null}
          <span className="text-xs text-muted-foreground">
            不限制单次选择数量 · 同时最多处理 {processingConcurrency} 张
          </span>
        </div>

        <input
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          id="photo-files"
          multiple
          onChange={(event) => enqueue(Array.from(event.currentTarget.files ?? []))}
          ref={inputRef}
          type="file"
        />
        <input
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          multiple
          onChange={(event) => enqueue(Array.from(event.currentTarget.files ?? []))}
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
            enqueue(Array.from(event.dataTransfer.files));
          }}
          type="button"
        >
          <ImagePlusIcon className="size-5 text-muted-foreground" />
          <span className="text-sm font-medium">拖入图片或点击选择</span>
          <span className="max-w-2xl text-xs leading-5 text-muted-foreground">
            原图和处理结果只保存在当前浏览器。本页不会创建上传任务，也不会向 OSS
            传输文件；只有审核页执行发布后才会开始上传。
          </span>
        </button>

        {role === "uploader" && items.length > 0 ? (
          <div className="rounded-lg border bg-muted/20 px-4 py-3 text-sm">
            <p className="font-medium">本机已有 {items.length} 张待审核照片</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              待审核数据只存在于当前浏览器，不做跨设备同步。需要审核时，请继续使用本设备并切换到审核员或管理员账号。
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
              <h3 className="text-sm font-medium">本机待审核</h3>
              <span className="text-xs text-muted-foreground">{items.length} 张</span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
              {items.map(({ photo, url }) => (
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
                      aria-label="从本地队列删除"
                      className="absolute right-1 top-1 size-8 opacity-0 shadow-sm group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={() => void deleteLocalReviewPhoto(photo.id)}
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
                      {formatBytes(photo.totalBytes)} · OCR {photo.bib.ocrStatus}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </UploadShell>
  );
}
