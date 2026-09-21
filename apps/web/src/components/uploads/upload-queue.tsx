"use client";

import type { BibConfigView } from "@photostream/contracts";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleXIcon,
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
import {
  isSupportedUploadInput,
  type PreparedUploadInput,
  prepareUploadInput,
} from "@/lib/upload-input";
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(bytes >= 10 * 1024 ** 2 ? 0 : 1)} MB`;
}

function taskLabel(status: LocalProcessingTaskStatus): string {
  if (status === "queued") return "等待处理";
  if (status === "processing") return "处理中并上传";
  if (status === "staged") return "已上传（默认隐藏）";
  if (status === "cancelled") return "已取消";
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
  role: "admin" | "operator" | "uploader";
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
  const [duplicateInputs, setDuplicateInputs] = useState<readonly PreparedUploadInput[]>([]);
  const knownSourceHashes = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    const allRows = await listLocalReviewPhotos(albumId);
    for (const photo of allRows) {
      if (photo.sourceHash) knownSourceHashes.current.add(photo.sourceHash);
    }
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

  async function enqueuePrepared(inputs: readonly PreparedUploadInput[]): Promise<void> {
    if (inputs.length === 0) return;
    const selectedCategory = categoryId === "uncategorized" ? null : categoryId;
    await runtime.enqueue(inputs, selectedCategory);
    for (const input of inputs) knownSourceHashes.current.add(input.sourceHash);
  }

  async function enqueue(files: readonly File[]): Promise<void> {
    if (files.length === 0) return;
    if (!localQueueSupported()) {
      toast.add({ title: "当前浏览器不支持本地上传队列", type: "error" });
      return;
    }

    const candidates = files.filter(isSupportedUploadInput);
    const skipped = files.length - candidates.length;
    const prepared: PreparedUploadInput[] = [];
    const preparationFailures: string[] = [];
    for (const file of candidates) {
      try {
        prepared.push(await prepareUploadInput(file));
      } catch (error) {
        preparationFailures.push(
          `${file.name}：${error instanceof Error ? error.message : "无法处理此文件"}`,
        );
      }
    }

    const serverDuplicates = new Set<string>();
    try {
      const hashes = [...new Set(prepared.map((input) => input.sourceHash))];
      for (let index = 0; index < hashes.length; index += 200) {
        const batch = hashes.slice(index, index + 200);
        const result = await clientMutation<{ readonly duplicates: readonly string[] }>(
          `/api/v1/albums/${encodeURIComponent(albumId)}/media-duplicates`,
          { body: { hashes: batch } },
        );
        for (const hash of result.duplicates) serverDuplicates.add(hash);
      }
    } catch (error) {
      toast.add({
        title: "重复照片检测失败",
        description: error instanceof Error ? error.message : "未开始上传，请稍后重试。",
        type: "error",
      });
      return;
    }

    const seen = new Set([...knownSourceHashes.current, ...serverDuplicates]);
    const unique: PreparedUploadInput[] = [];
    const duplicates: PreparedUploadInput[] = [];
    for (const input of prepared) {
      if (seen.has(input.sourceHash)) {
        duplicates.push(input);
        continue;
      }
      unique.push(input);
      seen.add(input.sourceHash);
    }

    try {
      if (unique.length > 0) {
        await enqueuePrepared(unique);
        toast.add({
          title: `已开始处理并上传 ${unique.length} 张`,
          description:
            "原图会立即开始上传，派生图生成后随即上传；完成后默认隐藏。HEIC/HEIF 会在当前设备本地转为 JPEG。",
          type: "success",
        });
      }
      setDuplicateInputs(duplicates);
      if (duplicates.length > 0) {
        toast.add({
          title: `已跳过 ${duplicates.length} 张重复照片`,
          description: "已按文件内容 SHA-256 检测；可在上传区域选择“仍然上传”。",
          type: "warning",
        });
      }
      if (skipped > 0) {
        toast.add({
          title: `已跳过 ${skipped} 个不支持的文件`,
          description: "支持 JPEG、PNG、WebP，以及当前设备可解码的 HEIC/HEIF。",
          type: "warning",
        });
      }
      if (preparationFailures.length > 0) {
        toast.add({
          title: `${preparationFailures.length} 张照片未能加入队列`,
          description: preparationFailures.slice(0, 2).join("；"),
          type: "error",
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
    let cancelled = 0;
    for (const task of tasks) {
      if (task.status === "queued") queued += 1;
      else if (task.status === "processing") processing += 1;
      else if (task.status === "failed") failed += 1;
      else if (task.status === "staged") completed += 1;
      else if (task.status === "cancelled") cancelled += 1;
    }
    return { queued, processing, failed, completed, cancelled };
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

  function cancelTask(taskId: string): void {
    void runtime.cancelTask(taskId).catch((error) => {
      toast.add({
        title: "取消上传失败",
        description: error instanceof Error ? error.message : "无法取消该上传任务",
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
  const uploadProgress = useMemo(() => {
    const totalBytes = tasks.reduce((sum, task) => sum + task.totalUploadBytes, 0);
    const uploadedBytes = tasks.reduce((sum, task) => sum + task.uploadedBytes, 0);
    const bytesPerSecond = tasks.reduce((sum, task) => sum + task.bytesPerSecond, 0);
    const completed = tasks.filter((task) => task.status === "staged").length;
    return {
      totalBytes,
      uploadedBytes,
      bytesPerSecond,
      completed,
      percent: totalBytes <= 0 ? 0 : Math.min(100, Math.round((uploadedBytes / totalBytes) * 100)),
    };
  }, [tasks]);

  return (
    <UploadShell
      queue={{
        paused,
        queued: queueCounts.queued,
        processing: queueCounts.processing,
        failed: queueCounts.failed,
        cancelled: queueCounts.cancelled,
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
          {role === "admin" || role === "operator" ? (
            <Link
              className={buttonVariants({ size: "sm", variant: "outline" })}
              href={`/studio/albums/${albumId}/review`}
            >
              前往审核
            </Link>
          ) : null}
        </div>

        <input
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
          className="sr-only"
          id="photo-files"
          multiple
          onChange={(event) => void enqueue(Array.from(event.currentTarget.files ?? []))}
          ref={inputRef}
          type="file"
        />
        <input
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
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

        {duplicateInputs.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/35 bg-amber-500/5 px-4 py-3">
            <div>
              <p className="text-sm font-medium">
                检测到 {duplicateInputs.length} 张重复照片，已暂时跳过
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                使用文件内容 SHA-256
                在当前活动内判断（包含其他设备已上传内容）；若确实需要保留副本，可以继续上传。
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => setDuplicateInputs([])}
                size="sm"
                type="button"
                variant="ghost"
              >
                忽略
              </Button>
              <Button
                onClick={() => {
                  const pending = duplicateInputs.map((input) => ({
                    ...input,
                    allowDuplicate: true,
                  }));
                  setDuplicateInputs([]);
                  void enqueuePrepared(pending)
                    .then(() =>
                      toast.add({
                        title: `已允许上传 ${pending.length} 张重复照片`,
                        type: "success",
                      }),
                    )
                    .catch((error) =>
                      toast.add({
                        title: "重复照片加入队列失败",
                        description: error instanceof Error ? error.message : "请稍后重试",
                        type: "error",
                      }),
                    );
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                仍然上传
              </Button>
            </div>
          </div>
        ) : null}

        {tasks.length > 0 && uploadProgress.totalBytes > 0 ? (
          <div className="rounded-lg border bg-muted/15 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium">
                总进度 {uploadProgress.completed}/{tasks.length} · {uploadProgress.percent}%
              </span>
              <span className="text-xs text-muted-foreground">
                {formatBytes(uploadProgress.uploadedBytes)} /{" "}
                {formatBytes(uploadProgress.totalBytes)}
                {uploadProgress.bytesPerSecond > 0
                  ? ` · ${formatBytes(uploadProgress.bytesPerSecond)}/s`
                  : ""}
              </span>
            </div>
            <div
              aria-label="上传总进度"
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={uploadProgress.percent}
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-200 motion-reduce:transition-none"
                style={{ width: `${uploadProgress.percent}%` }}
              />
            </div>
          </div>
        ) : null}

        {role === "uploader" && items.length > 0 ? (
          <div className="rounded-lg border bg-muted/20 px-4 py-3 text-sm">
            <p className="font-medium">
              {showUploaded
                ? `当前显示本机保留的 ${items.length} 张照片`
                : `当前有 ${items.length} 张照片仍在处理或等待重试`}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              原图保留在当前浏览器；远端照片保持隐藏，可在审核页打开大图后进入右侧修图栏处理。
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
                <div
                  className="flex items-start gap-3 px-3 py-2.5"
                  data-upload-task-id={task.id}
                  key={task.id}
                >
                  <div className="mt-0.5 text-muted-foreground">
                    {task.status === "processing" ? (
                      <LoaderCircleIcon className="size-4 animate-spin" />
                    ) : task.status === "failed" ? (
                      <CircleAlertIcon className="size-4 text-destructive" />
                    ) : task.status === "cancelled" ? (
                      <CircleXIcon className="size-4" />
                    ) : (
                      <CircleCheckIcon className="size-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{task.fileName}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatBytes(task.bytes)} · {taskLabel(task.status)}
                      {task.status === "processing" && task.totalUploadBytes > 0
                        ? ` · ${Math.min(
                            100,
                            Math.round((task.uploadedBytes / task.totalUploadBytes) * 100),
                          )}%`
                        : ""}
                      {task.bytesPerSecond > 0 ? ` · ${formatBytes(task.bytesPerSecond)}/s` : ""}
                    </p>
                    {task.error === null ? null : (
                      <p className="mt-1 text-xs text-destructive">{task.error}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={task.status === "failed" ? "destructive" : "outline"}>
                      {taskLabel(task.status)}
                    </Badge>
                    {task.status === "cancelled" ? null : (
                      <Button
                        aria-label={`取消 ${task.fileName}`}
                        onClick={() => cancelTask(task.id)}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        取消
                      </Button>
                    )}
                  </div>
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
                    {photo.uploadState === "published" || photo.uploadState === "local" ? (
                      <Button
                        aria-label="删除本机照片副本"
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
                    ) : null}
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
    </UploadShell>
  );
}
