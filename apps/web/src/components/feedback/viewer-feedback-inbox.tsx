"use client";

import { MessageSquareTextIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import type { ViewerFeedbackItem } from "@/lib/viewer-feedback";
import { viewerFeedbackKindLabel } from "@/lib/viewer-feedback";

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
  initialItems,
  initialLatestId,
}: Readonly<{
  initialItems: readonly ViewerFeedbackItem[];
  initialLatestId: number;
}>) {
  const [items, setItems] = useState<readonly ViewerFeedbackItem[]>(initialItems);
  const [connected, setConnected] = useState(false);
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
        if (disposed || source?.readyState !== EventSource.CLOSED || reconnectTimer !== null) return;
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

  return (
    <div className="grid gap-3">
      <section className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <MessageSquareTextIcon className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">观众反馈收件箱</h2>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            观众提交后会直接出现在这里，无需刷新页面。当前保留最近 100 条用于快速处理。
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
            <p className="mt-1 text-xs text-muted-foreground">新的观众意见会实时显示在这里。</p>
          </div>
        </section>
      ) : (
        <div className="grid gap-2.5">
          {items.map((item) => (
            <article className="rounded-xl border bg-card p-4 shadow-xs" key={item.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge variant={item.kind === "problem" ? "destructive" : "secondary"}>
                    {viewerFeedbackKindLabel(item.kind)}
                  </Badge>
                  <span className="truncate text-sm font-medium">{item.albumTitle}</span>
                </div>
                <time
                  className="shrink-0 text-[11px] tabular-nums text-muted-foreground"
                  dateTime={item.createdAt}
                >
                  {formatTime(item.createdAt)}
                </time>
              </div>
              <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">{item.message}</p>
              {item.pagePath === null ? null : (
                <p className="mt-3 truncate rounded-md bg-muted/55 px-2 py-1 font-mono text-[10px] text-muted-foreground">
                  {item.pagePath}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
