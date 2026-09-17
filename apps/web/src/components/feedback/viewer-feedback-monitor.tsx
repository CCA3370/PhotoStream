"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { toast } from "@/components/ui/toast";
import {
  type ViewerFeedbackItem,
  viewerFeedbackCreatedEvent,
  viewerFeedbackKindLabel,
} from "@/lib/viewer-feedback";

export function ViewerFeedbackMonitor() {
  const pathname = usePathname();

  useEffect(() => {
    let disposed = false;
    let eventSource: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (disposed) return;
      eventSource?.close();
      const source = new EventSource("/api/v1/feedback/events");
      eventSource = source;

      source.addEventListener("viewer.feedback.created", (event) => {
        try {
          const item = JSON.parse((event as MessageEvent<string>).data) as ViewerFeedbackItem;
          window.dispatchEvent(new CustomEvent(viewerFeedbackCreatedEvent, { detail: item }));
          if (pathname === "/studio/feedback") return;
          const preview = item.message.length > 68 ? `${item.message.slice(0, 68)}…` : item.message;
          toast.add({
            title: "收到新的观众反馈",
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

    connect();
    return () => {
      disposed = true;
      eventSource?.close();
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    };
  }, [pathname]);

  return null;
}
