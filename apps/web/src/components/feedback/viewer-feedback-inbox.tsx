"use client";

import {
  EyeIcon,
  EyeOffIcon,
  ImageIcon,
  LoaderCircleIcon,
  MessageSquareTextIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  ReviewLightbox,
  type ReviewLightboxItem,
} from "@/components/review/review-lightbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/components/ui/toast";
import { clientGet, clientMutation } from "@/lib/client-api";
import { internalImageKey } from "@/lib/internal-media-url";
import { loadMediaBlob } from "@/lib/media-blob-cache";
import {
  type ViewerFeedbackItem,
  viewerFeedbackKindLabel,
  viewerReportReasonLabel,
} from "@/lib/viewer-feedback";

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(date);
}

function mergeFeedback(
  current: readonly ViewerFeedbackItem[],
  incoming: ViewerFeedbackItem,
): ViewerFeedbackItem[] {
  if (current.some((item) => item.id === incoming.id)) return [...current];
  return [incoming, ...current].slice(0, 100);
}

export function ViewerFeedbackInbox({
  canModerate,
  initialItems,
  initialLatestId,
}: Readonly<{
  canModerate: boolean;
  initialItems: readonly ViewerFeedbackItem[];
  initialLatestId: number;
}>) {
  const [items, setItems] = useState<readonly ViewerFeedbackItem[]>(initialItems);
  const [connected, setConnected] = useState(false);
  const [changingMediaId, setChangingMediaId] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<ReviewLightboxItem | null>(null);
  const [previewLoadingMediaId, setPreviewLoadingMediaId] = useState<string | null>(null);
  const previewRequestId = useRef(0);
  const previewObjectUrl = useRef<string | null>(null);
  const [deleteFeedbackId, setDeleteFeedbackId] = useState<number | null>(null);
  const [deletingFeedbackId, setDeletingFeedbackId] = useState<number | null>(null);
  const lastEventId = useRef(initialLatestId);

  useEffect(() => {
    let disposed = false;
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (disposed) return;
      source?.close();
      source = new EventSource(`/api/v1/feedback/events?after=${lastEventId.current}`);
      source.addEventListener("open", () => setConnected(true));
      source.addEventListener("viewer.feedback.created", (event) => {
        try {
          const item = JSON.parse((event as MessageEvent<string>).data) as ViewerFeedbackItem;
          lastEventId.current = Math.max(lastEventId.current, item.id);
          setItems((current) => mergeFeedback(current, item));
        } catch {
          // Reconnection with the last durable id recovers any skipped valid events.
        }
      });
      source.addEventListener("error", () => {
        setConnected(false);
        if (disposed || source?.readyState !== EventSource.CLOSED || reconnectTimer !== null)
          return;
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, 500);
      });
    };

    connect();
    return () => {
      disposed = true;
      source?.close();
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    };
  }, []);

  function closeReportedPhoto(): void {
    previewRequestId.current += 1;
    if (previewObjectUrl.current !== null) {
      URL.revokeObjectURL(previewObjectUrl.current);
      previewObjectUrl.current = null;
    }
    setPreviewItem(null);
    setPreviewLoadingMediaId(null);
  }

  async function openReportedPhoto(item: ViewerFeedbackItem): Promise<void> {
    const mediaId = item.mediaId;
    if (mediaId === null) return;
    const requestId = previewRequestId.current + 1;
    previewRequestId.current = requestId;
    if (previewObjectUrl.current !== null) {
      URL.revokeObjectURL(previewObjectUrl.current);
      previewObjectUrl.current = null;
    }
    setPreviewItem(null);
    setPreviewLoadingMediaId(mediaId);

    for (const kind of ["photo_1920", "photo_960", "photo_480"] as const) {
      try {
        const endpoint = `/api/v1/media/${encodeURIComponent(mediaId)}/variants/${kind}`;
        const signed = await clientGet<{ readonly url: string; readonly bytes: number }>(endpoint);
        const blob = await loadMediaBlob({
          cacheName: "photostream-internal-images-v1",
          key: internalImageKey(signed.url),
          expectedBytes: null,
          sourceUrl: signed.url,
          refreshUrl: async () => (await clientGet<{ readonly url: string }>(endpoint)).url,
        });
        if (previewRequestId.current !== requestId) return;
        const bitmap = await createImageBitmap(blob);
        const width = bitmap.width;
        const height = bitmap.height;
        bitmap.close();
        const objectUrl = URL.createObjectURL(blob);
        if (previewRequestId.current !== requestId) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        previewObjectUrl.current = objectUrl;
        const key = `feedback:${item.id}:${mediaId}`;
        setPreviewItem({
          key,
          inspector: {
            key,
            title: item.albumTitle,
            mediaId,
            categoryId: null,
            uploaderName: null,
            sourceLabel: "投诉记录",
            featured: false,
            publicationStatus: item.mediaStatus ?? "hidden",
            ingestStatus: "ready",
            editPending: false,
            editActive: false,
            width,
            height,
            totalBytes: blob.size,
            createdAt: item.createdAt,
            capturedAt: null,
            bib: null,
            canDelete: false,
          },
          variants: [{ url: objectUrl, kind }],
          src: objectUrl,
          fallbackSrc: null,
          originalSrc: null,
          localPreferred: false,
          visualRevision: null,
          width,
          height,
          featured: false,
          publicationStatus: item.mediaStatus ?? "hidden",
          mediaId,
          localPhotoId: null,
          bib: null,
          canDelete: false,
          pendingAction: null,
        });
        setPreviewLoadingMediaId(null);
        return;
      } catch {
        // Try the next verified preview size.
      }
    }

    if (previewRequestId.current !== requestId) return;
    setPreviewLoadingMediaId(null);
    toast.add({
      title: "无法查看照片",
      description: "这张照片当前没有可读取的预览版本。",
      type: "error",
    });
  }

  async function setReportedPhotoVisibility(mediaId: string, visible: boolean): Promise<void> {
    if (!canModerate || changingMediaId !== null) return;
    setChangingMediaId(mediaId);
    try {
      await clientMutation<{ readonly ok: true }>(
        `/api/v1/media/${encodeURIComponent(mediaId)}/${visible ? "restore" : "hide"}`,
        {
          idempotencyKey: `feedback-${visible ? "publish" : "hide"}-${crypto.randomUUID()}`,
        },
      );
      setItems((current) =>
        current.map((item) =>
          item.mediaId === mediaId
            ? { ...item, mediaStatus: visible ? "published" : "hidden" }
            : item,
        ),
      );
      toast.add({
        title: visible ? "图片已重新上架" : "图片已下架",
        description: visible ? "该图片已恢复到公共相册。" : "该图片已从公共相册中隐藏。",
        type: "success",
      });
    } catch (error) {
      toast.add({
        title: visible ? "重新上架失败" : "下架失败",
        description: error instanceof Error ? error.message : "请稍后重试。",
        type: "error",
      });
    } finally {
      setChangingMediaId(null);
    }
  }

  async function deleteFeedback(): Promise<void> {
    const feedbackId = deleteFeedbackId;
    if (!canModerate || feedbackId === null || deletingFeedbackId !== null) return;
    setDeletingFeedbackId(feedbackId);
    try {
      await clientMutation<{ readonly ok: true }>(
        `/api/v1/feedback/${encodeURIComponent(String(feedbackId))}`,
        { method: "DELETE" },
      );
      setItems((current) => current.filter((item) => item.id !== feedbackId));
      setDeleteFeedbackId(null);
      if (previewItem?.key.startsWith(`feedback:${feedbackId}:`)) closeReportedPhoto();
      toast.add({ title: "投诉记录已删除", type: "success" });
    } catch (error) {
      toast.add({
        title: "删除投诉记录失败",
        description: error instanceof Error ? error.message : "请稍后重试。",
        type: "error",
      });
    } finally {
      setDeletingFeedbackId(null);
    }
  }

  return (
    <div className="grid gap-3">
      <section className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <MessageSquareTextIcon className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">观众反馈与图片投诉</h2>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            普通反馈和图片投诉会实时出现在这里。图片投诉会标出目标图片，并可直接执行下架处理。
          </p>
        </div>
        <Badge className="w-fit gap-1.5" variant={connected ? "secondary" : "outline"}>
          <span
            aria-hidden="true"
            className={`size-1.5 rounded-full ${connected ? "bg-emerald-500" : "bg-muted-foreground/45"}`}
          />
          {connected ? "实时连接" : "正在重连"}
        </Badge>
      </section>

      {items.length === 0 ? (
        <section className="grid min-h-56 place-items-center rounded-xl border border-dashed bg-card/40 p-6 text-center">
          <div>
            <MessageSquareTextIcon className="mx-auto size-7 text-muted-foreground/60" />
            <p className="mt-3 text-sm font-medium">暂时没有反馈</p>
            <p className="mt-1 text-xs text-muted-foreground">
              新的观众意见或图片投诉会实时显示在这里。
            </p>
          </div>
        </section>
      ) : (
        <div className="grid gap-2.5">
          {items.map((item) => {
            const isReport = item.kind === "report";
            const mediaId = item.mediaId;
            const mediaVisible = mediaId !== null && item.mediaStatus === "published";
            const mediaHidden = mediaId !== null && item.mediaStatus === "hidden";
            const mediaMissing = mediaId === null;
            const changing = mediaId !== null && changingMediaId === mediaId;
            return (
              <article
                className={`rounded-xl border bg-card p-4 shadow-xs ${isReport ? "border-destructive/30" : ""}`}
                key={item.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Badge
                      variant={isReport || item.kind === "problem" ? "destructive" : "secondary"}
                    >
                      {viewerFeedbackKindLabel(item.kind)}
                    </Badge>
                    {isReport && item.reportReason !== null ? (
                      <Badge variant="outline">{viewerReportReasonLabel(item.reportReason)}</Badge>
                    ) : null}
                    <span className="truncate text-sm font-medium">{item.albumTitle}</span>
                    {isReport ? (
                      <Badge variant={mediaVisible ? "outline" : "secondary"}>
                        {mediaMissing
                          ? "原图片已删除"
                          : mediaVisible
                            ? "图片仍显示"
                            : mediaHidden
                              ? "图片已下架"
                              : "图片已不可见"}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <time
                      className="text-[11px] tabular-nums text-muted-foreground"
                      dateTime={item.createdAt}
                    >
                      {formatTime(item.createdAt)}
                    </time>
                    {canModerate && isReport ? (
                      <Button
                        aria-label="删除投诉记录"
                        onClick={() => setDeleteFeedbackId(item.id)}
                        size="icon-sm"
                        title="删除投诉记录"
                        type="button"
                        variant="ghost"
                      >
                        <Trash2Icon className="text-destructive" />
                      </Button>
                    ) : null}
                  </div>
                </div>

                <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">
                  {item.message}
                </p>

                {isReport ? (
                  <div className="mt-3 flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-xs font-medium">目标图片</p>
                      {mediaId === null ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          原图片已被删除，投诉记录继续保留。
                        </p>
                      ) : (
                        <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                          {mediaId}
                        </p>
                      )}
                    </div>
                    {mediaId !== null ? (
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <Button
                          disabled={previewLoadingMediaId === mediaId}
                          onClick={() => void openReportedPhoto(item)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          {previewLoadingMediaId === mediaId ? (
                            <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
                          ) : (
                            <ImageIcon data-icon="inline-start" />
                          )}
                          查看照片
                        </Button>
                        {canModerate ? (
                          <Button
                            className={
                              mediaHidden
                                ? "border-emerald-300 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                                : undefined
                            }
                            disabled={(!mediaVisible && !mediaHidden) || changing}
                            onClick={() => void setReportedPhotoVisibility(mediaId, mediaHidden)}
                            size="sm"
                            type="button"
                            variant={mediaVisible ? "destructive" : "outline"}
                          >
                            {changing ? (
                              <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
                            ) : mediaHidden ? (
                              <EyeIcon data-icon="inline-start" />
                            ) : (
                              <EyeOffIcon data-icon="inline-start" />
                            )}
                            {mediaVisible ? "一键下架图片" : mediaHidden ? "重新上架" : "已不可见"}
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            仅管理员或审核员可上下架图片
                          </span>
                        )}
                      </div>
                    ) : canModerate ? (
                      <span className="text-xs text-muted-foreground">无需继续下架</span>
                    ) : null}
                  </div>
                ) : null}

                {item.pagePath === null ? null : (
                  <p className="mt-3 truncate rounded-md bg-muted/55 px-2 py-1 font-mono text-[10px] text-muted-foreground">
                    {item.pagePath}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}

      <ReviewLightbox
        categories={[]}
        items={previewItem === null ? [] : [previewItem]}
        onBibError={() => undefined}
        onBibStateChange={() => undefined}
        onCategoryChange={() => undefined}
        onClose={closeReportedPhoto}
        onDelete={() => undefined}
        onEditApplied={() => undefined}
        onLocalBibConfirmNoNumber={async () => {
          throw new Error("只读查看器不支持号码操作");
        }}
        onLocalBibConfirmNumbers={async () => {
          throw new Error("只读查看器不支持号码操作");
        }}
        onSelect={() => undefined}
        onStateAction={() => undefined}
        onToggleFeatured={() => undefined}
        onToggleVisibility={() => undefined}
        readOnly
        selectedKey={previewItem?.key ?? null}
      />

      <AlertDialog
        onOpenChange={(open) => {
          if (!open && deletingFeedbackId === null) setDeleteFeedbackId(null);
        }}
        open={deleteFeedbackId !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除投诉记录？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作只删除这条投诉记录，不会删除、隐藏或重新上架目标照片，且无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingFeedbackId !== null}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deletingFeedbackId !== null}
              onClick={() => void deleteFeedback()}
              variant="destructive"
            >
              {deletingFeedbackId !== null ? (
                <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
              ) : (
                <Trash2Icon data-icon="inline-start" />
              )}
              删除投诉
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
