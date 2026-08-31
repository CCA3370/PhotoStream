"use client";

import type {
  BibConfigView,
  BibMediaState,
  CreatePhotoUploadRequest,
  PhotoVariantKind,
  SignedUpload,
  UploadIntentView,
} from "@photostream/contracts";
import { ImagePlusIcon, RotateCcwIcon, WifiIcon, XIcon } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlbumContextNav } from "@/components/albums/album-context-nav";
import { BibReviewControls } from "@/components/bib/bib-review-controls";
import { UploadShell } from "@/components/shells/upload-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ClientApiError, clientGet, clientMutation } from "@/lib/client-api";
import { type ProcessedPhoto, processPhotoInWorker } from "@/lib/photo-processing";
import {
  deleteUploadRecovery,
  fileFingerprint,
  listUploadRecoveries,
  saveUploadRecovery,
  type UploadRecoveryRecord,
} from "@/lib/upload-recovery";

interface CategoryOption {
  readonly id: string;
  readonly name: string;
}

type TaskState = "active" | "cancelled" | "completed" | "failed";

interface UploadTask {
  readonly id: string;
  readonly label: string;
  readonly contentType: string;
  readonly stage: string;
  readonly state: TaskState;
  readonly progress: number;
  readonly error: string | null;
  readonly retryable: boolean;
  readonly previewUrl: string | null;
  readonly previewWidth: number | null;
  readonly previewHeight: number | null;
  readonly totalBytes: number;
  readonly uploadedBytes: number;
  readonly rateBytesPerSecond: number;
  readonly remainingSeconds: number | null;
  readonly startedAt: number;
  readonly publicationStatus?: UploadIntentView["publicationStatus"];
  readonly mediaId?: string;
  readonly bib?: BibMediaState;
  readonly ocrMessage: string | null;
  readonly ocrStatus:
    | "disabled"
    | "waiting"
    | "processing"
    | "completed"
    | "failed"
    | "unsupported";
}

const previewKinds = ["photo_480", "photo_960"] as const;
const completeKinds = ["photo_1920", "photo_original"] as const;

function retryableUploadStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function abortError(): DOMException {
  return new DOMException("上传已取消", "AbortError");
}

async function backoff(attempt: number, signal: AbortSignal): Promise<void> {
  const jitter = Math.floor(Math.random() * 150);
  const milliseconds = 300 * 2 ** attempt + jitter;
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, milliseconds);
    const cancel = () => {
      window.clearTimeout(timeout);
      reject(abortError());
    };
    signal.addEventListener("abort", cancel, { once: true });
  });
}

async function runWithConcurrency<T>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const value = values[nextIndex];
      nextIndex += 1;
      if (value !== undefined) await operation(value);
    }
  });
  const results = await Promise.allSettled(workers);
  const failed = results.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
}

function multipartProgress(intent: UploadIntentView) {
  return intent.objects.flatMap((object) =>
    object.parts.flatMap((part) =>
      part.completed && part.etag !== null
        ? [{ kind: object.kind, partNumber: part.partNumber, etag: part.etag }]
        : [],
    ),
  );
}

function uploadedBytes(intent: UploadIntentView): number {
  return intent.objects.reduce((total, object) => {
    if (object.completed) return total + object.expectedBytes;
    return (
      total +
      object.parts.reduce(
        (partTotal, part) => partTotal + (part.completed ? part.expectedBytes : 0),
        0,
      )
    );
  }, 0);
}

function taskLabel(status: UploadIntentView["publicationStatus"] | undefined): string {
  if (status === "published") return "已发布";
  if (status === "pending_review") return "等待审核";
  return "尚未发布";
}

function originalVariant(photo: ProcessedPhoto, file: File) {
  return {
    kind: "photo_original" as const,
    format: photo.originalFormat,
    contentType: photo.originalContentType,
    width: photo.width,
    height: photo.height,
    bytes: file.size,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KiB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MiB`;
}

function formatRemaining(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "正在估算剩余时间";
  if (seconds < 60) return `预计还需 ${Math.max(1, Math.ceil(seconds))} 秒`;
  return `预计还需 ${Math.ceil(seconds / 60)} 分钟`;
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
  const controllers = useRef(new Map<string, AbortController>());
  const ocrControllers = useRef(new Map<string, AbortController>());
  const retryFiles = useRef(new Map<string, File>());
  const previewUrls = useRef(new Map<string, string>());
  const recoveryRecords = useRef<UploadRecoveryRecord[]>([]);
  const pausedRef = useRef(false);
  const resumeWaiters = useRef(new Set<() => void>());
  const [categoryId, setCategoryId] = useState("uncategorized");
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [recoveries, setRecoveries] = useState<UploadRecoveryRecord[]>([]);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(false);
  const [showCandidateBoxes, setShowCandidateBoxes] = useState(true);
  const categoryItems = useMemo(
    () => [
      { label: "未分类", value: "uncategorized" },
      ...categories.map((category) => ({ label: category.name, value: category.id })),
    ],
    [categories],
  );
  const summary = useMemo(
    () => ({
      processing: tasks.filter((task) => task.state === "active").length,
      failed: tasks.filter((task) => task.state === "failed").length,
      retryableFailed: tasks.filter((task) => task.state === "failed" && task.retryable).length,
      pendingReview: tasks.filter((task) => task.publicationStatus === "pending_review").length,
      completed: tasks.filter((task) => task.state === "completed" || task.state === "cancelled")
        .length,
    }),
    [tasks],
  );
  const hasCandidateBoxes = useMemo(
    () => tasks.some((task) => task.bib?.tags.some((tag) => tag.quadrilateral !== null)),
    [tasks],
  );

  useEffect(() => {
    void listUploadRecoveries()
      .then((records) => {
        const albumRecords = records.filter((record) => record.albumId === albumId);
        recoveryRecords.current = albumRecords;
        setRecoveries(albumRecords);
      })
      .catch(() => setRecoveryError("无法读取本机恢复队列；刷新前请勿关闭此页面。"));
  }, [albumId]);

  useEffect(() => {
    if (summary.processing === 0) return;
    const protect = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [summary.processing]);

  useEffect(
    () => () => {
      for (const controller of controllers.current.values()) controller.abort();
      for (const controller of ocrControllers.current.values()) controller.abort();
      for (const url of previewUrls.current.values()) URL.revokeObjectURL(url);
    },
    [],
  );

  useEffect(
    () => () => {
      if (bibConfig.recognitionEnabled) {
        void import("@/lib/bib-ocr").then(({ disposeBibOcr }) => disposeBibOcr());
      }
    },
    [bibConfig.recognitionEnabled],
  );

  function setRecovery(record: UploadRecoveryRecord): void {
    const next = [
      ...recoveryRecords.current.filter((candidate) => candidate.intentId !== record.intentId),
      record,
    ];
    recoveryRecords.current = next;
    setRecoveries(next);
  }

  function removeRecovery(intentId: string): void {
    const next = recoveryRecords.current.filter((record) => record.intentId !== intentId);
    recoveryRecords.current = next;
    setRecoveries(next);
  }

  function updateTask(id: string, change: Partial<UploadTask>): void {
    setTasks((current) => current.map((task) => (task.id === id ? { ...task, ...change } : task)));
  }

  function addTransferredBytes(id: string, bytes: number): void {
    setTasks((current) =>
      current.map((task) => {
        if (task.id !== id || task.totalBytes <= 0) return task;
        const transferred = Math.min(task.totalBytes, task.uploadedBytes + bytes);
        const elapsedSeconds = Math.max(0.25, (Date.now() - task.startedAt) / 1_000);
        const rate = transferred / elapsedSeconds;
        return {
          ...task,
          uploadedBytes: transferred,
          rateBytesPerSecond: rate,
          remainingSeconds: rate > 0 ? (task.totalBytes - transferred) / rate : null,
          progress: Math.min(
            99,
            Math.max(10, Math.round(10 + (transferred / task.totalBytes) * 89)),
          ),
        };
      }),
    );
  }

  function resumeQueue(): void {
    pausedRef.current = false;
    setPaused(false);
    for (const resume of resumeWaiters.current) resume();
    resumeWaiters.current.clear();
  }

  function togglePause(): void {
    if (pausedRef.current) {
      resumeQueue();
      return;
    }
    pausedRef.current = true;
    setPaused(true);
  }

  async function waitForResume(signal: AbortSignal): Promise<void> {
    if (!pausedRef.current) return;
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(abortError());
        return;
      }
      const resumed = () => {
        signal.removeEventListener("abort", cancelled);
        resumeWaiters.current.delete(resumed);
        resolve();
      };
      const cancelled = () => {
        resumeWaiters.current.delete(resumed);
        reject(abortError());
      };
      resumeWaiters.current.add(resumed);
      signal.addEventListener("abort", cancelled, { once: true });
    });
  }

  async function createIntent(
    file: File,
    photo: ProcessedPhoto,
    signal: AbortSignal,
  ): Promise<UploadIntentView> {
    const input: CreatePhotoUploadRequest = {
      albumId,
      categoryId: categoryId === "uncategorized" ? null : categoryId,
      width: photo.width,
      height: photo.height,
      totalBytes: file.size,
      capturedAt: photo.capturedAt,
      variants: [
        ...photo.variants.map((variant) => ({
          kind: variant.kind,
          format: variant.format,
          contentType: variant.contentType,
          width: variant.width,
          height: variant.height,
          bytes: variant.blob.size,
        })),
        originalVariant(photo, file),
      ],
    };
    return clientMutation<UploadIntentView>("/api/v1/uploads", {
      body: input,
      idempotencyKey: crypto.randomUUID(),
      signal,
    });
  }

  async function uploadOne(file: File): Promise<void> {
    const id = crypto.randomUUID();
    const controller = new AbortController();
    controllers.current.set(id, controller);
    retryFiles.current.set(id, file);
    let activeRecovery: UploadRecoveryRecord | null = null;
    setTasks((current) => [
      ...current,
      {
        id,
        label: file.name,
        contentType: file.type,
        stage: "本地处理",
        state: "active",
        progress: 2,
        error: null,
        retryable: false,
        previewUrl: null,
        previewWidth: null,
        previewHeight: null,
        totalBytes: 0,
        uploadedBytes: 0,
        rateBytesPerSecond: 0,
        remainingSeconds: null,
        startedAt: Date.now(),
        ocrMessage: null,
        ocrStatus: bibConfig.recognitionEnabled ? "waiting" : "disabled",
      },
    ]);
    try {
      await waitForResume(controller.signal);
      const photo = await processPhotoInWorker(file, { signal: controller.signal });
      const thumbnail = photo.variants.find((variant) => variant.kind === "photo_480");
      if (thumbnail !== undefined) {
        const previewUrl = URL.createObjectURL(thumbnail.blob);
        previewUrls.current.set(id, previewUrl);
        updateTask(id, { previewHeight: photo.height, previewUrl, previewWidth: photo.width });
      }
      updateTask(id, { stage: "创建上传任务", progress: 10 });
      const fingerprint = await fileFingerprint(file);
      let recovery = recoveryRecords.current.find((record) => record.fingerprint === fingerprint);
      let recoveredIntent: UploadIntentView | undefined;
      if (recovery !== undefined) {
        const recoveryIntentId = recovery.intentId;
        activeRecovery = recovery;
        try {
          recoveredIntent = await clientGet<UploadIntentView>(
            `/api/v1/uploads/${recoveryIntentId}`,
            controller.signal,
          );
          if (recoveredIntent.status !== "active") {
            await deleteUploadRecovery(recoveryIntentId);
            removeRecovery(recoveryIntentId);
            activeRecovery = null;
            recovery = undefined;
            recoveredIntent = undefined;
          }
        } catch (error) {
          if (
            !(error instanceof ClientApiError) ||
            (error.response?.code !== "UPLOAD_NOT_FOUND" && error.response?.code !== "FORBIDDEN")
          ) {
            throw error;
          }
          await deleteUploadRecovery(recoveryIntentId);
          removeRecovery(recoveryIntentId);
          activeRecovery = null;
          recovery = undefined;
        }
      }
      let intent = recoveredIntent ?? (await createIntent(file, photo, controller.signal));
      const emptyBib: BibMediaState = {
        tags: [],
        review: {
          mediaId: intent.mediaId,
          decision: "pending",
          ocrStatus: "not_started",
          ocrModelVersion: null,
          decidedAt: null,
        },
      };
      updateTask(id, {
        mediaId: intent.mediaId,
        ...(bibConfig.ruleUsable ? { bib: emptyBib } : {}),
      });
      const blobs = new Map<PhotoVariantKind, Blob>([
        ...photo.variants.map((variant) => [variant.kind, variant.blob] as const),
        ["photo_original", file],
      ]);
      const ocrWork = bibConfig.recognitionEnabled
        ? (() => {
            const ocrController = new AbortController();
            const abortOcr = () => ocrController.abort();
            ocrControllers.current.set(id, ocrController);
            controller.signal.addEventListener("abort", abortOcr, { once: true });
            return (async () => {
              const workingImage = photo.variants.find(
                (variant) => variant.kind === "photo_1920",
              )?.blob;
              if (workingImage === undefined) return;
              try {
                const [ocr, { normalizeBibCandidates }] = await Promise.all([
                  import("@/lib/bib-ocr"),
                  import("@photostream/contracts/bib"),
                ]);
                if (!ocr.bibOcrSupported()) {
                  updateTask(id, { ocrStatus: "unsupported" });
                  const state = await clientMutation<BibMediaState>(
                    `/api/v1/media/${intent.mediaId}/bib-candidates`,
                    {
                      body: {
                        activityStatus: "unsupported",
                        modelVersion: ocr.BIB_OCR_ASSET_VERSION,
                        ruleVersion: bibConfig.ruleVersion,
                        candidates: [],
                      },
                      idempotencyKey: `ocr-${intent.id}-${ocr.BIB_OCR_ASSET_VERSION}-unsupported`,
                      signal: ocrController.signal,
                    },
                  );
                  updateTask(id, {
                    bib: state,
                    ocrMessage: "当前设备不支持自动识别，请手工复核。",
                  });
                  return;
                }
                updateTask(id, { ocrStatus: "processing" });
                try {
                  const state = await clientMutation<BibMediaState>(
                    `/api/v1/media/${intent.mediaId}/bib-candidates`,
                    {
                      body: {
                        activityStatus: "processing",
                        modelVersion: ocr.BIB_OCR_ASSET_VERSION,
                        ruleVersion: bibConfig.ruleVersion,
                        candidates: [],
                      },
                      idempotencyKey: `ocr-${intent.id}-${ocr.BIB_OCR_ASSET_VERSION}-processing`,
                      signal: ocrController.signal,
                    },
                  );
                  updateTask(id, { bib: state });
                } catch (error) {
                  if (
                    error instanceof ClientApiError &&
                    (error.response?.code === "BIB_RULE_VERSION_MISMATCH" ||
                      error.response?.code === "BIB_MODEL_VERSION_MISMATCH")
                  ) {
                    throw error;
                  }
                }
                const rawCandidates = await ocr.recognizeBibCandidates(
                  workingImage,
                  ocrController.signal,
                );
                const candidates = normalizeBibCandidates(rawCandidates, bibConfig.patterns).map(
                  ({ number, ...candidate }) => ({ ...candidate, text: number }),
                );
                const state = await clientMutation<BibMediaState>(
                  `/api/v1/media/${intent.mediaId}/bib-candidates`,
                  {
                    body: {
                      activityStatus: "completed",
                      modelVersion: ocr.BIB_OCR_ASSET_VERSION,
                      ruleVersion: bibConfig.ruleVersion,
                      candidates,
                    },
                    idempotencyKey: `ocr-${intent.id}-${ocr.BIB_OCR_ASSET_VERSION}-completed`,
                    signal: ocrController.signal,
                  },
                );
                updateTask(id, { bib: state, ocrMessage: null, ocrStatus: "completed" });
              } catch (error) {
                if (ocrController.signal.aborted) return;
                const staleConfig =
                  error instanceof ClientApiError &&
                  (error.response?.code === "BIB_RULE_VERSION_MISMATCH" ||
                    error.response?.code === "BIB_MODEL_VERSION_MISMATCH");
                updateTask(id, {
                  ocrMessage: staleConfig
                    ? "号码规则或模型已更新，请刷新页面后手工复核；照片无需重新上传。"
                    : "自动识别失败，请手工复核；照片上传不受影响。",
                  ocrStatus: "failed",
                });
                if (staleConfig) return;
                try {
                  const { BIB_OCR_ASSET_VERSION } = await import("@/lib/bib-ocr");
                  const state = await clientMutation<BibMediaState>(
                    `/api/v1/media/${intent.mediaId}/bib-candidates`,
                    {
                      body: {
                        activityStatus: "failed",
                        modelVersion: BIB_OCR_ASSET_VERSION,
                        ruleVersion: bibConfig.ruleVersion,
                        candidates: [],
                      },
                      idempotencyKey: `ocr-${intent.id}-${BIB_OCR_ASSET_VERSION}-failed`,
                    },
                  );
                  updateTask(id, { bib: state });
                } catch {
                  // Media upload remains authoritative even when OCR status reporting is unavailable.
                }
              }
            })().finally(() => {
              controller.signal.removeEventListener("abort", abortOcr);
              ocrControllers.current.delete(id);
            });
          })()
        : Promise.resolve();
      const completed = new Set(
        intent.objects.filter((object) => object.completed).map((object) => object.kind),
      );
      const expectedBytes = intent.objects.reduce(
        (total, object) => total + object.expectedBytes,
        0,
      );
      const previouslyUploaded = uploadedBytes(intent);
      updateTask(id, {
        totalBytes: expectedBytes,
        uploadedBytes: previouslyUploaded,
        progress:
          expectedBytes === 0
            ? 10
            : Math.min(99, Math.round(10 + (previouslyUploaded / expectedBytes) * 89)),
      });
      activeRecovery = {
        intentId: intent.id,
        albumId,
        fingerprint,
        completed: [...completed],
        multipartParts: multipartProgress(intent),
        retryCount: recovery?.retryCount ?? 0,
        lastError: null,
        updatedAt: new Date().toISOString(),
      };
      await saveUploadRecovery(activeRecovery);
      setRecovery(activeRecovery);

      async function putWithRetry(path: string, blob: Blob): Promise<Response> {
        let lastError: unknown;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await waitForResume(controller.signal);
          try {
            const signed = await clientMutation<SignedUpload>(path, { signal: controller.signal });
            const uploaded = await fetch(signed.url, {
              method: "PUT",
              headers: signed.headers,
              body: blob,
              signal: controller.signal,
            });
            if (uploaded.ok || uploaded.status === 409) return uploaded;
            if (!retryableUploadStatus(uploaded.status)) {
              throw new Error(`对象直传失败（${uploaded.status}）`);
            }
            lastError = new Error(`对象直传暂时失败（${uploaded.status}）`);
          } catch (error) {
            if (controller.signal.aborted) throw abortError();
            lastError = error;
            if (error instanceof ClientApiError && error.response?.retryable !== true) throw error;
            if (error instanceof Error && /^对象直传失败/u.test(error.message)) throw error;
          }
          if (attempt < 2) await backoff(attempt, controller.signal);
        }
        throw lastError instanceof Error ? lastError : new Error("对象直传失败");
      }

      async function transfer(kind: PhotoVariantKind): Promise<UploadIntentView> {
        const blob = blobs.get(kind);
        if (blob === undefined) throw new Error(`缺少 ${kind} 本地对象`);
        const object = intent.objects.find((candidate) => candidate.kind === kind);
        if (object === undefined) throw new Error(`上传任务缺少 ${kind}`);
        if (object.uploadMode === "multipart") {
          const parts = [...object.parts].sort((left, right) => left.partNumber - right.partNumber);
          let offset = 0;
          const slices = parts.map((part) => {
            const start = offset;
            offset += part.expectedBytes;
            return { ...part, blob: blob.slice(start, offset, object.contentType) };
          });
          if (offset !== blob.size || object.multipartUploadId === null) {
            throw new Error("分片规格与本地原图不一致");
          }
          const missingParts = slices.filter((part) => !part.completed);
          const concurrency = window.matchMedia("(pointer: coarse)").matches ? 2 : 4;
          await runWithConcurrency(missingParts, concurrency, async (part) => {
            const uploaded = await putWithRetry(
              `/api/v1/uploads/${intent.id}/objects/${kind}/parts/${part.partNumber}/sign`,
              part.blob,
            );
            const etag = uploaded.headers.get("etag");
            if (etag === null) throw new Error(`分片 ${part.partNumber} 缺少 ETag`);
            await clientMutation<UploadIntentView>(
              `/api/v1/uploads/${intent.id}/objects/${kind}/parts/${part.partNumber}/complete`,
              {
                body: { etag },
                idempotencyKey: `complete-${intent.id}-${kind}-${part.partNumber}`,
                signal: controller.signal,
              },
            );
            addTransferredBytes(id, part.expectedBytes);
          });
        } else {
          await putWithRetry(`/api/v1/uploads/${intent.id}/objects/${kind}/sign`, blob);
        }
        const completedIntent = await clientMutation<UploadIntentView>(
          `/api/v1/uploads/${intent.id}/objects/${kind}/complete`,
          { idempotencyKey: `complete-${intent.id}-${kind}`, signal: controller.signal },
        );
        if (object.uploadMode === "single") addTransferredBytes(id, object.expectedBytes);
        return completedIntent;
      }

      const missingPreviews = previewKinds.filter((kind) => !completed.has(kind));
      if (missingPreviews.length > 0) {
        updateTask(id, { stage: "并发上传 480 / 960 预览" });
        const results = await Promise.allSettled(missingPreviews.map((kind) => transfer(kind)));
        const failed = results.find((result) => result.status === "rejected");
        if (failed?.status === "rejected") throw failed.reason;
        for (const kind of missingPreviews) completed.add(kind);
        intent = await clientGet<UploadIntentView>(
          `/api/v1/uploads/${intent.id}`,
          controller.signal,
        );
        activeRecovery = {
          ...activeRecovery,
          completed: [...completed],
          multipartParts: multipartProgress(intent),
          updatedAt: new Date().toISOString(),
        };
        await saveUploadRecovery(activeRecovery);
        setRecovery(activeRecovery);
      }

      updateTask(id, {
        stage:
          intent.publicationStatus === "published" ? "直播已可见，上传完整文件" : "上传完整文件",
        publicationStatus: intent.publicationStatus,
      });
      for (const kind of completeKinds) {
        if (completed.has(kind)) continue;
        updateTask(id, {
          stage: kind === "photo_original" ? "上传原图" : "上传 1920 灯箱图",
        });
        intent = await transfer(kind);
        completed.add(kind);
        activeRecovery = {
          ...activeRecovery,
          completed: [...completed],
          multipartParts: multipartProgress(intent),
          updatedAt: new Date().toISOString(),
        };
        await saveUploadRecovery(activeRecovery);
        setRecovery(activeRecovery);
      }
      void ocrWork;
      await deleteUploadRecovery(intent.id);
      removeRecovery(intent.id);
      retryFiles.current.delete(id);
      updateTask(id, {
        stage: "完成",
        state: "completed",
        progress: 100,
        uploadedBytes: expectedBytes,
        remainingSeconds: 0,
        publicationStatus: intent.publicationStatus,
      });
    } catch (error) {
      const cancelled = controller.signal.aborted;
      const message = cancelled
        ? "已由用户取消"
        : error instanceof Error
          ? error.message
          : "上传失败";
      if (activeRecovery !== null && cancelled) {
        try {
          await clientMutation<UploadIntentView>(
            `/api/v1/uploads/${activeRecovery.intentId}/cancel`,
          );
          await deleteUploadRecovery(activeRecovery.intentId);
          removeRecovery(activeRecovery.intentId);
        } catch (cleanupError) {
          const failedRecovery: UploadRecoveryRecord = {
            ...activeRecovery,
            retryCount: activeRecovery.retryCount + 1,
            lastError:
              cleanupError instanceof Error
                ? `本地任务已停止，服务端清理待重试：${cleanupError.message}`
                : "本地任务已停止，服务端清理待重试",
            updatedAt: new Date().toISOString(),
          };
          await saveUploadRecovery(failedRecovery).catch(() => undefined);
          setRecovery(failedRecovery);
        }
      } else if (activeRecovery !== null) {
        try {
          const current = await clientGet<UploadIntentView>(
            `/api/v1/uploads/${activeRecovery.intentId}`,
          );
          activeRecovery = {
            ...activeRecovery,
            completed: current.objects
              .filter((object) => object.completed)
              .map((object) => object.kind),
            multipartParts: multipartProgress(current),
          };
        } catch {
          // The local record remains useful while the control plane is unavailable.
        }
        const failedRecovery: UploadRecoveryRecord = {
          ...activeRecovery,
          retryCount: activeRecovery.retryCount + 1,
          lastError: message,
          updatedAt: new Date().toISOString(),
        };
        await saveUploadRecovery(failedRecovery).catch(() => undefined);
        setRecovery(failedRecovery);
      }
      const retryable = !cancelled && activeRecovery !== null;
      if (!retryable) retryFiles.current.delete(id);
      updateTask(id, {
        stage: cancelled ? "已取消" : "失败",
        state: cancelled ? "cancelled" : "failed",
        error: cancelled ? null : message,
        retryable,
      });
    } finally {
      controllers.current.delete(id);
    }
  }

  async function runFiles(files: readonly File[]): Promise<void> {
    if (files.length === 0) return;
    setBusy(true);
    try {
      for (const file of files) await uploadOne(file);
    } finally {
      setBusy(false);
      if (inputRef.current !== null) inputRef.current.value = "";
      if (controllers.current.size === 0 && pausedRef.current) resumeQueue();
    }
  }

  async function selected(files: FileList | null): Promise<void> {
    if (files === null || files.length === 0) return;
    const selectedFiles = [...files];
    if (selectedFiles.length > 200) {
      setTasks((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          label: "本次选择",
          contentType: "",
          stage: "失败",
          state: "failed",
          progress: 0,
          error: "单次最多选择 200 张照片",
          retryable: false,
          previewUrl: null,
          previewWidth: null,
          previewHeight: null,
          totalBytes: 0,
          uploadedBytes: 0,
          rateBytesPerSecond: 0,
          remainingSeconds: null,
          startedAt: Date.now(),
          ocrMessage: null,
          ocrStatus: bibConfig.recognitionEnabled ? "waiting" : "disabled",
        },
      ]);
      return;
    }
    await runFiles(selectedFiles);
  }

  async function retryFailed(taskIds?: ReadonlySet<string>): Promise<void> {
    if (busy) return;
    const retryableTasks = tasks.filter(
      (task) =>
        task.state === "failed" &&
        task.retryable &&
        (taskIds === undefined || taskIds.has(task.id)),
    );
    const files = retryableTasks.flatMap((task) => {
      const file = retryFiles.current.get(task.id);
      return file === undefined ? [] : [file];
    });
    const ids = new Set(retryableTasks.map((task) => task.id));
    for (const id of ids) {
      const url = previewUrls.current.get(id);
      if (url !== undefined) URL.revokeObjectURL(url);
      previewUrls.current.delete(id);
      retryFiles.current.delete(id);
    }
    setTasks((current) => current.filter((task) => !ids.has(task.id)));
    await runFiles(files);
  }

  function clearCompleted(): void {
    const ids = new Set(
      tasks
        .filter((task) => task.state === "completed" || task.state === "cancelled")
        .map((task) => task.id),
    );
    for (const id of ids) {
      const url = previewUrls.current.get(id);
      if (url !== undefined) URL.revokeObjectURL(url);
      previewUrls.current.delete(id);
    }
    setTasks((current) => current.filter((task) => !ids.has(task.id)));
  }

  function cancelTask(id: string): void {
    controllers.current.get(id)?.abort();
    ocrControllers.current.get(id)?.abort();
  }

  return (
    <UploadShell
      albumId={albumId}
      albumTitle={albumTitle}
      queue={{
        ...summary,
        paused,
        onTogglePause: togglePause,
        onRetryFailed: () => void retryFailed(),
        onClearCompleted: clearCompleted,
      }}
    >
      <div className="flex flex-col gap-4">
        <AlbumContextNav albumId={albumId} current="upload" role={role} />
        <section className="flex flex-col gap-4" aria-labelledby="upload-title">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold" id="upload-title">
              上传队列
            </h2>
            <p className="text-sm text-muted-foreground">
              请选择系统 Chrome、Edge 或 Safari 上传照片。
            </p>
          </div>
          <div className="flex flex-col gap-5">
            {recoveryError === null ? null : (
              <Alert variant="destructive">
                <AlertTitle>恢复存储不可用</AlertTitle>
                <AlertDescription>{recoveryError}</AlertDescription>
              </Alert>
            )}
            {bibConfig.recognitionEnabled && bibConfig.automationStatus === "experimental" ? (
              <Alert>
                <AlertTitle>自动号码候选为实验功能</AlertTitle>
                <AlertDescription>
                  识别结果只作辅助并须人工确认；失败或无候选不会阻塞照片上传和发布。
                </AlertDescription>
              </Alert>
            ) : null}
            {recoveries.length === 0 ? null : (
              <Alert>
                <RotateCcwIcon aria-hidden="true" />
                <AlertTitle>发现 {recoveries.length} 个可恢复任务</AlertTitle>
                <AlertDescription>
                  重新选择同一文件后会校验本地内容指纹，并只续传服务端确认缺失的对象。
                </AlertDescription>
              </Alert>
            )}
            <Card>
              <CardHeader>
                <CardTitle>选择照片</CardTitle>
                <CardDescription>
                  照片在浏览器 Worker 中处理，媒体正文直接上传本地 OSS 模拟器。
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 md:flex-row md:items-end">
                <Field className="max-w-xs">
                  <FieldLabel htmlFor="upload-category">一级分类</FieldLabel>
                  <Select
                    items={categoryItems}
                    value={categoryId}
                    onValueChange={(value) => setCategoryId(value ?? "uncategorized")}
                  >
                    <SelectTrigger className="min-h-11 w-full" id="upload-category">
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
                  <FieldDescription>选择后应用于本次新任务。</FieldDescription>
                </Field>
                <input
                  accept="image/jpeg,image/png,image/webp"
                  aria-label="照片文件"
                  className="sr-only"
                  disabled={busy}
                  id="photo-files"
                  multiple
                  onChange={(event) => void selected(event.currentTarget.files)}
                  ref={inputRef}
                  type="file"
                />
                <Button
                  className="min-h-11"
                  disabled={busy}
                  onClick={() => inputRef.current?.click()}
                  type="button"
                >
                  <ImagePlusIcon data-icon="inline-start" />
                  {busy ? "正在处理队列…" : "选择照片"}
                </Button>
              </CardContent>
            </Card>

            {hasCandidateBoxes ? (
              <Button
                className="self-start"
                onClick={() => setShowCandidateBoxes((current) => !current)}
                type="button"
                variant="outline"
              >
                {showCandidateBoxes ? "隐藏上传候选框" : "显示上传候选框"}
              </Button>
            ) : null}

            {tasks.length === 0 ? (
              <Empty className="min-h-64 border">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <WifiIcon aria-hidden="true" />
                  </EmptyMedia>
                  <EmptyTitle>上传队列为空</EmptyTitle>
                  <EmptyDescription>选择一张或多张静态照片开始处理。</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="flex flex-col gap-3" aria-live="polite">
                {tasks.map((task) => (
                  <Card key={task.id} size="sm">
                    <CardHeader>
                      <CardTitle>{task.label}</CardTitle>
                      <CardDescription>{task.stage}</CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-3 sm:grid-cols-[72px_minmax(0,1fr)]">
                      {task.previewUrl === null ||
                      task.previewWidth === null ||
                      task.previewHeight === null ? (
                        <div aria-hidden="true" className="size-[72px] rounded-lg bg-muted" />
                      ) : (
                        <div className="flex size-[72px] items-center justify-center overflow-hidden rounded-lg bg-muted">
                          <div
                            className="relative max-h-full max-w-full text-primary"
                            style={
                              task.previewWidth >= task.previewHeight
                                ? {
                                    aspectRatio: `${task.previewWidth} / ${task.previewHeight}`,
                                    width: "100%",
                                  }
                                : {
                                    aspectRatio: `${task.previewWidth} / ${task.previewHeight}`,
                                    height: "100%",
                                  }
                            }
                          >
                            <Image
                              alt={`${task.label} 本地缩略图`}
                              className="object-contain"
                              fill
                              sizes="72px"
                              src={task.previewUrl}
                              unoptimized
                            />
                            {showCandidateBoxes && task.bib !== undefined ? (
                              <svg
                                aria-hidden="true"
                                className="pointer-events-none absolute inset-0 size-full"
                                preserveAspectRatio="none"
                                viewBox="0 0 100 100"
                              >
                                {task.bib.tags.flatMap((tag) =>
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
                      <div className="flex min-w-0 flex-col gap-3">
                        <Progress value={task.progress}>
                          <ProgressLabel>总进度</ProgressLabel>
                          <ProgressValue>
                            {(_formattedValue, value) => `${value ?? 0}%`}
                          </ProgressValue>
                        </Progress>
                        <p className="text-sm text-muted-foreground">
                          {task.contentType || "未开始"} · {formatBytes(task.uploadedBytes)} /{" "}
                          {formatBytes(task.totalBytes)}
                          {task.rateBytesPerSecond > 0
                            ? ` · ${formatBytes(task.rateBytesPerSecond)}/s · ${formatRemaining(task.remainingSeconds)}`
                            : ""}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={task.error === null ? "secondary" : "destructive"}>
                            {task.error ?? task.stage}
                          </Badge>
                          {task.publicationStatus === undefined ? null : (
                            <Badge>{taskLabel(task.publicationStatus)}</Badge>
                          )}
                          <Badge
                            variant={
                              task.ocrStatus === "failed" || task.ocrStatus === "unsupported"
                                ? "destructive"
                                : "outline"
                            }
                          >
                            {task.ocrStatus === "disabled"
                              ? "OCR 未启用"
                              : task.ocrStatus === "waiting"
                                ? "等待 OCR"
                                : task.ocrStatus === "processing"
                                  ? "识别中"
                                  : task.ocrStatus === "completed"
                                    ? "OCR 已完成"
                                    : task.ocrStatus === "unsupported"
                                      ? "设备不支持 OCR"
                                      : "识别失败"}
                          </Badge>
                          {task.state === "active" ? (
                            <Button
                              onClick={() => cancelTask(task.id)}
                              size="sm"
                              type="button"
                              variant="outline"
                            >
                              <XIcon data-icon="inline-start" />
                              取消
                            </Button>
                          ) : null}
                          {task.state === "failed" && task.retryable ? (
                            <Button
                              disabled={busy}
                              onClick={() => void retryFailed(new Set([task.id]))}
                              size="sm"
                              type="button"
                              variant="outline"
                            >
                              <RotateCcwIcon data-icon="inline-start" />
                              重试
                            </Button>
                          ) : null}
                        </div>
                        {task.ocrMessage === null ? null : (
                          <p className="text-sm text-muted-foreground">{task.ocrMessage}</p>
                        )}
                      </div>
                      {task.mediaId === undefined || task.bib === undefined ? null : (
                        <div className="sm:col-span-2">
                          <BibReviewControls
                            initial={task.bib}
                            mediaId={task.mediaId}
                            onChange={(bib) => updateTask(task.id, { bib })}
                            options={bibConfig.attributeOptions}
                          />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </UploadShell>
  );
}
