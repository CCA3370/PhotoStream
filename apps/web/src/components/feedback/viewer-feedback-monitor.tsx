"use client";

import { useEffect } from "react";

import { toast } from "@/components/ui/toast";
import { clientGet } from "@/lib/client-api";
import {
  type ViewerFeedbackItem,
  type ViewerFeedbackList,
  viewerFeedbackKindLabel,
} from "@/lib/viewer-feedback";

export function ViewerFeedbackMonitor() {
  useEffect(() => {
    let disposed = false;
    let eventSource: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let lastEventId = 0;

    const connect = () => {
      if (disposed) return;
      eventSource?.close();
      const source = new EventSource(`/api/v1/feedback/events?after=${lastEventId}`);
      eventSource = source;

      source.addEventListener("viewer.feedback.created", (event) => {
        try {
          const item = JSON.parse((event as MessageEvent<string>).data) as ViewerFeedbackItem;
          lastEventId = Math.max(lastEventId, item.id);
          if (window.location.pathname === "/studio/feedback") return;
          const preview = item.message.length > 68 ? `${item.message.slice(0, 68)}…` : item.message;
          toast.add({
            title: item.kind === "report" ? "收到新的图片投诉" : "收到新的观众反馈",
            description: `${item.albumTitle} · ${viewerFeedbackKindLabel(item.kind)}：${preview}`,
            type: "info",
            timeout: 7_000,
          });
        } catch {
          // Ignore malformed events; the persistent feedback inbox remains authoritative.
        }
      });

      source.addEventListener("error", () => {
        if (disposed || source.readyState !== EventSource.CLOSED || reconnectTimer !== null) return;
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, 500);
      });
    };

    const initialize = async (): Promise<void> => {
      try {
        const initial = await clientGet<ViewerFeedbackList>("/api/v1/feedback?limit=1");
        if (disposed) return;
        lastEventId = initial.latestId;
        connect();
      } catch {
        if (disposed || reconnectTimer !== null) return;
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          void initialize();
        }, 1_000);
      }
    };

    void initialize();
    return () => {
      disposed = true;
      eventSource?.close();
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    };
  }, []);

  return null;
}
