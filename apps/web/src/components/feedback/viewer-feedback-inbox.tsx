"use client";

import { EyeOffIcon, ImageIcon, LoaderCircleIcon, MessageSquareTextIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { InternalCachedImage } from "@/components/media/internal-cached-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { clientGet, clientMutation } from "@/lib/client-api";
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
  const [hidingMediaId, setHidingMediaId] = useState<string | null>(null);
  const [previewMediaId, setPreviewMediaId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    readonly mediaId: string;
    readonly kind: "photo_1920" | "photo_960" | "photo_480";
    readonly url: string;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewRequestId = useRef(0);
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

  async function openReportedPhoto(mediaId: string): Promise<void> {
    const requestId = previewRequestId.current + 1;
    previewRequestId.current = requestId;
    setPreviewMediaId(mediaId);
    setPreview(null);
    setPreviewError(null);
    setPreviewLoading(true);
    for (const kind of ["photo_1920", "photo_960", "photo_480"] as const) {
      try {
        const result = await clientGet<{ readonly url: string }>(
          `/api/v1/media/${encodeURIComponent(mediaId)}/variants/${kind}`,
        );
        if (previewRequestId.current !== requestId) return;
        setPreview({ mediaId, kind, url: result.url });
        setPreviewLoading(false);
        return;
      } catch {
        // Try the next verified preview size.
      }
    }
    if (previewRequestId.current !== requestId) return;
    setPreviewLoading(false);
    setPreviewError("这张照片当前没有可查看的预览版本。");
  }

  async function hideReportedPhoto(mediaId: string): Promise<void> {
    if (!canModerate || hidingMediaId !== null) return;
    setHidingMediaId(mediaId);
    try {
      await clientMutation<{ readonly ok: true }>(
        `/api/v1/media/${encodeURIComponent(mediaId)}/hide`,
        {
          idempotencyKey: `feedback-hide-${crypto.randomUUID()}`,
        },
      );
      setItems((current) =>
        current.map((item) =>
          item.mediaId === mediaId ? { ...item, mediaStatus: "hidden" } : item,
        ),
      );
      toast.add({
        title: "图片已下架",
        description: "该图片已从公共相册中隐藏。",
        type: "success",
      });
    } catch (error) {
      toast.add({
        title: "下架失败",
        description: error instanceof Error ? error.message : "请稍后重试。",
        type: "error",
      });
    } finally {
      setHidingMediaId(null);
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
            const mediaMissing = mediaId === null;
            const hiding = mediaId !== null && hidingMediaId === mediaId;
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
                            : "图片已不可见"}
                      </Badge>
                    ) : null}
                  </div>
                  <time
                    className="shrink-0 text-[11px] tabular-nums text-muted-foreground"
                    dateTime={item.createdAt}
                  >
                    {formatTime(item.createdAt)}
                  </time>
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
                          onClick={() => void openReportedPhoto(mediaId)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          <ImageIcon data-icon="inline-start" />
                          查看照片
                        </Button>
                        {canModerate ? (
                          <Button
                            disabled={!mediaVisible || hiding}
                            onClick={() => void hideReportedPhoto(mediaId)}
                            size="sm"
                            type="button"
                            variant={mediaVisible ? "destructive" : "secondary"}
                          >
                            {hiding ? (
                              <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
                            ) : (
                              <EyeOffIcon data-icon="inline-start" />
                            )}
                            {mediaVisible ? "一键下架图片" : "已不可见"}
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            仅管理员或审核员可下架图片
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

      <Dialog
        onOpenChange={(open) => {
          if (open) return;
          previewRequestId.current += 1;
          setPreviewMediaId(null);
          setPreview(null);
          setPreviewError(null);
          setPreviewLoading(false);
        }}
        open={previewMediaId !== null}
      >
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>投诉目标照片</DialogTitle>
            <DialogDescription>
              {previewMediaId === null ? "" : `媒体 ID：${previewMediaId}`}
            </DialogDescription>
          </DialogHeader>
          <div className="relative h-[min(72vh,48rem)] min-h-64 overflow-hidden rounded-lg bg-black">
            {previewLoading ? (
              <div className="absolute inset-0 grid place-items-center text-sm text-white/65">
                <LoaderCircleIcon className="mr-2 inline size-4 animate-spin" />
                正在加载照片…
              </div>
            ) : previewError !== null ? (
              <div className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-white/65">
                {previewError}
              </div>
            ) : preview !== null ? (
              <InternalCachedImage
                alt="投诉目标照片"
                className="object-contain"
                fill
                mediaId={preview.mediaId}
                sizes="min(90vw, 80rem)"
                src={preview.url}
                unoptimized
                variantKind={preview.kind}
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
