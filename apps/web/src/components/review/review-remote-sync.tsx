"use client";

import { useEffect, useRef } from "react";

import { clientGet } from "@/lib/client-api";

export const REVIEW_REMOTE_CHANGED_EVENT = "photostream:review-remote-changed";

const fallbackPollIntervalMs = 60_000;
const reconnectDelayMs = 1_000;

export function ReviewRemoteSync({
  albumId,
  initialRevision,
}: Readonly<{
  albumId: string;
  initialRevision: string;
}>) {
  const revisionRef = useRef(initialRevision);

  useEffect(() => {
    revisionRef.current = initialRevision;
  }, [initialRevision]);

  useEffect(() => {
    let disposed = false;
    let source: EventSource | null = null;
    let fallbackTimer: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let checking = false;

    const publishRevision = (revision: string) => {
      if (revision === revisionRef.current) return;
      revisionRef.current = revision;
      window.dispatchEvent(
        new CustomEvent(REVIEW_REMOTE_CHANGED_EVENT, {
          detail: { albumId, revision, realtime: true },
        }),
      );
    };

    const checkRevision = async (): Promise<void> => {
      if (disposed || checking || document.visibilityState !== "visible") return;
      checking = true;
      try {
        const result = await clientGet<{ readonly revision: string }>(
          `/api/v1/albums/${encodeURIComponent(albumId)}/review-revision`,
        );
        if (!disposed) publishRevision(result.revision);
      } catch {
        // SSE reconnect and the next low-frequency fallback check will retry.
      } finally {
        checking = false;
      }
    };

    const stopFallback = () => {
      if (fallbackTimer === null) return;
      clearInterval(fallbackTimer);
      fallbackTimer = null;
    };

    const startFallback = () => {
      if (fallbackTimer !== null || disposed) return;
      fallbackTimer = setInterval(() => void checkRevision(), fallbackPollIntervalMs);
    };

    const connect = () => {
      if (disposed) return;
      source?.close();
      const next = new EventSource(
        `/api/v1/albums/${encodeURIComponent(albumId)}/review-events`,
      );
      source = next;
      next.addEventListener("review.changed", (event) => {
        try {
          const parsed = JSON.parse((event as MessageEvent<string>).data) as {
            readonly revision?: string;
          };
          if (typeof parsed.revision === "string") publishRevision(parsed.revision);
        } catch {
          void checkRevision();
        }
      });
      next.addEventListener("open", () => {
        stopFallback();
        void checkRevision();
      });
      next.addEventListener("error", () => {
        startFallback();
        if (next.readyState !== EventSource.CLOSED || disposed || reconnectTimer !== null) return;
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, reconnectDelayMs);
      });
    };

    const recover = () => {
      void checkRevision();
      if (source?.readyState === EventSource.CLOSED) connect();
    };
    const visibilityChanged = () => {
      if (document.visibilityState === "visible") recover();
    };

    connect();
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("focus", recover);
    window.addEventListener("online", recover);
    window.addEventListener("pageshow", recover);

    return () => {
      disposed = true;
      source?.close();
      stopFallback();
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("focus", recover);
      window.removeEventListener("online", recover);
      window.removeEventListener("pageshow", recover);
    };
  }, [albumId]);

  return null;
}
