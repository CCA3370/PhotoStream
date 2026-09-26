"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { clientGet } from "@/lib/client-api";

interface PublicChange {
  readonly id: number;
  readonly type: string;
  readonly mediaId: string | null;
}

const changeBatchSize = 100;
const fallbackPollIntervalMs = 15_000;
const safetyReconcileIntervalMs = 60_000;
const reconnectDebounceMs = 150;
const connectionNoticeDelayMs = 2_500;
const nearLatestScrollY = 220;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function viewerNearLatest(): boolean {
  return window.scrollY <= nearLatestScrollY;
}

export function LiveUpdates({
  initialEventId,
  knownMediaIds,
  slug,
}: Readonly<{
  initialEventId: number;
  knownMediaIds: readonly string[];
  slug: string;
}>) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const lastEventId = useRef(initialEventId);
  const knownIds = useRef(new Set(knownMediaIds));
  const currentSlug = useRef(slug);
  const pendingMediaIdsRef = useRef(new Set<string>());
  const unpairedPublishedIdsRef = useRef<string[]>([]);
  const [pendingMediaCount, setPendingMediaCount] = useState(0);
  const [connectionInterrupted, setConnectionInterrupted] = useState(false);

  useEffect(() => {
    if (currentSlug.current !== slug) {
      currentSlug.current = slug;
      lastEventId.current = initialEventId;
      knownIds.current = new Set(knownMediaIds);
      pendingMediaIdsRef.current.clear();
      unpairedPublishedIdsRef.current = [];
      setPendingMediaCount(0);
      setConnectionInterrupted(false);
    }
  }, [initialEventId, knownMediaIds, slug]);

  const revealPendingMedia = useCallback((scroll: boolean) => {
    const mediaIds = [...pendingMediaIdsRef.current];
    pendingMediaIdsRef.current.clear();
    setPendingMediaCount(0);
    if (mediaIds.length > 0) {
      window.dispatchEvent(
        new CustomEvent("photostream:reveal-new-media", {
          detail: { mediaIds },
        }),
      );
    }
    if (!scroll) return;
    window.scrollTo({
      top: 0,
      left: 0,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, []);

  useEffect(() => {
    const onScroll = () => {
      if (pendingMediaIdsRef.current.size > 0 && viewerNearLatest()) {
        revealPendingMedia(false);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [revealPendingMedia]);

  useEffect(() => {
    let fallbackPolling: ReturnType<typeof setInterval> | null = null;
    let safetyReconcile: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let connectionNoticeTimer: ReturnType<typeof setTimeout> | null = null;
    let eventSource: EventSource | null = null;
    let disposed = false;
    let catchUpRunning = false;
    let catchUpQueued = false;
    let reconciliationRequired = true;
    const pendingSse = new Map<number, PublicChange>();

    const clearConnectionNoticeTimer = () => {
      if (connectionNoticeTimer === null) return;
      clearTimeout(connectionNoticeTimer);
      connectionNoticeTimer = null;
    };

    const markConnectionInterruptedSoon = () => {
      if (disposed || connectionNoticeTimer !== null) return;
      connectionNoticeTimer = setTimeout(() => {
        connectionNoticeTimer = null;
        if (!disposed) setConnectionInterrupted(true);
      }, connectionNoticeDelayMs);
    };

    const flushPublishedMediaPairs = () => {
      while (unpairedPublishedIdsRef.current.length >= 2) {
        const firstMediaId = unpairedPublishedIdsRef.current.shift();
        const secondMediaId = unpairedPublishedIdsRef.current.shift();
        if (firstMediaId === undefined || secondMediaId === undefined) return;

        if (!viewerNearLatest()) {
          pendingMediaIdsRef.current.add(firstMediaId);
          pendingMediaIdsRef.current.add(secondMediaId);
          setPendingMediaCount(pendingMediaIdsRef.current.size);
        }
      }
    };

    const applyChange = (event: PublicChange) => {
      if (event.id <= lastEventId.current) return;
      lastEventId.current = event.id;

      if (event.type === "media.published") {
        if (event.mediaId !== null && !knownIds.current.has(event.mediaId)) {
          knownIds.current.add(event.mediaId);
          window.dispatchEvent(
            new CustomEvent("photostream:media-published", {
              detail: { mediaId: event.mediaId },
            }),
          );
          unpairedPublishedIdsRef.current.push(event.mediaId);
          flushPublishedMediaPairs();
        }
        return;
      }
      if (event.type === "media.likes.updated" && event.mediaId !== null) {
        window.dispatchEvent(
          new CustomEvent("photostream:likes-updated", { detail: { mediaId: event.mediaId } }),
        );
        return;
      }
      if (event.type === "media.featured.updated" && event.mediaId !== null) {
        window.dispatchEvent(
          new CustomEvent("photostream:featured-updated", { detail: { mediaId: event.mediaId } }),
        );
        return;
      }
      if (event.type === "media.updated") {
        startTransition(() => router.refresh());
        return;
      }
      if (event.type === "media.bib.updated") {
        window.dispatchEvent(
          new CustomEvent("photostream:bib-updated", { detail: { mediaId: event.mediaId } }),
        );
        return;
      }
      if (
        (event.type === "media.hidden" || event.type === "media.deleted") &&
        event.mediaId !== null
      ) {
        window.dispatchEvent(
          new CustomEvent("photostream:media-removed", { detail: { mediaId: event.mediaId } }),
        );
        knownIds.current.delete(event.mediaId);
        unpairedPublishedIdsRef.current = unpairedPublishedIdsRef.current.filter(
          (mediaId) => mediaId !== event.mediaId,
        );
        pendingMediaIdsRef.current.delete(event.mediaId);
        setPendingMediaCount(pendingMediaIdsRef.current.size);
        return;
      }
      if (event.type === "media.restored") {
        startTransition(() => router.refresh());
      }
    };

    const flushPendingSse = () => {
      const pending = [...pendingSse.values()].sort((left, right) => left.id - right.id);
      pendingSse.clear();
      for (const event of pending) applyChange(event);
    };

    const drainChanges = async (): Promise<void> => {
      while (!disposed) {
        const after = lastEventId.current;
        const result = await clientGet<{ readonly events: readonly PublicChange[] }>(
          `/api/v1/public/albums/${encodeURIComponent(slug)}/changes?after=${after}`,
        );
        if (disposed) return;

        const ordered = [...result.events].sort((left, right) => left.id - right.id);
        let progressed = false;
        for (const event of ordered) {
          if (event.id <= lastEventId.current) continue;
          applyChange(event);
          progressed = true;
        }

        if (!progressed || result.events.length < changeBatchSize) return;
      }
    };

    const stopFallbackPolling = () => {
      if (fallbackPolling === null) return;
      clearInterval(fallbackPolling);
      fallbackPolling = null;
    };

    const requestCatchUp = () => {
      if (disposed) return;
      reconciliationRequired = true;
      catchUpQueued = true;
      if (catchUpRunning) return;

      catchUpRunning = true;
      void (async () => {
        try {
          while (catchUpQueued && !disposed) {
            catchUpQueued = false;
            await drainChanges();
          }
          if (disposed) return;
          reconciliationRequired = false;
          flushPendingSse();
        } catch {
          markConnectionInterruptedSoon();
          if (disposed || fallbackPolling !== null) return;
          fallbackPolling = setInterval(requestCatchUp, fallbackPollIntervalMs);
        } finally {
          catchUpRunning = false;
          if (catchUpQueued && !disposed) requestCatchUp();
        }
      })();
    };

    const receiveSse = (type: string, event: Event) => {
      const message = event as MessageEvent<string>;
      try {
        const parsed = JSON.parse(message.data) as PublicChange;
        const change = { ...parsed, type };
        if (reconciliationRequired || catchUpRunning) {
          pendingSse.set(change.id, change);
          requestCatchUp();
          return;
        }
        applyChange(change);
      } catch {
        requestCatchUp();
      }
    };

    const closeEventSource = () => {
      eventSource?.close();
      eventSource = null;
    };

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer !== null) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectEventSource();
      }, reconnectDebounceMs);
    };

    function connectEventSource() {
      if (disposed) return;
      closeEventSource();
      const source = new EventSource(
        `/api/v1/public/albums/${encodeURIComponent(slug)}/events?after=${lastEventId.current}`,
      );
      eventSource = source;

      const published = (event: Event) => receiveSse("media.published", event);
      const updated = (event: Event) => receiveSse("media.updated", event);
      const likesUpdated = (event: Event) => receiveSse("media.likes.updated", event);
      const featuredUpdated = (event: Event) => receiveSse("media.featured.updated", event);
      const hidden = (event: Event) => receiveSse("media.hidden", event);
      const deleted = (event: Event) => receiveSse("media.deleted", event);
      const restored = (event: Event) => receiveSse("media.restored", event);
      const bibUpdated = (event: Event) => receiveSse("media.bib.updated", event);

      source.addEventListener("media.published", published);
      source.addEventListener("media.updated", updated);
      source.addEventListener("media.likes.updated", likesUpdated);
      source.addEventListener("media.featured.updated", featuredUpdated);
      source.addEventListener("media.hidden", hidden);
      source.addEventListener("media.deleted", deleted);
      source.addEventListener("media.restored", restored);
      source.addEventListener("media.bib.updated", bibUpdated);
      source.addEventListener("open", () => {
        clearConnectionNoticeTimer();
        setConnectionInterrupted(false);
        stopFallbackPolling();
        requestCatchUp();
      });
      source.addEventListener("error", () => {
        markConnectionInterruptedSoon();
        requestCatchUp();
        if (fallbackPolling === null) {
          fallbackPolling = setInterval(requestCatchUp, fallbackPollIntervalMs);
        }
        if (source.readyState === EventSource.CLOSED) scheduleReconnect();
      });
    }

    const recoverAfterPause = () => {
      requestCatchUp();
      scheduleReconnect();
    };
    const visibilityChanged = () => {
      if (document.visibilityState === "visible") recoverAfterPause();
    };
    const offline = () => setConnectionInterrupted(true);

    connectEventSource();
    requestCatchUp();
    safetyReconcile = setInterval(requestCatchUp, safetyReconcileIntervalMs);
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("focus", recoverAfterPause);
    window.addEventListener("online", recoverAfterPause);
    window.addEventListener("offline", offline);
    window.addEventListener("pageshow", recoverAfterPause);

    return () => {
      disposed = true;
      stopFallbackPolling();
      clearConnectionNoticeTimer();
      if (safetyReconcile !== null) clearInterval(safetyReconcile);
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("focus", recoverAfterPause);
      window.removeEventListener("online", recoverAfterPause);
      window.removeEventListener("offline", offline);
      window.removeEventListener("pageshow", recoverAfterPause);
      closeEventSource();
    };
  }, [router, slug]);

  if (!connectionInterrupted && pendingMediaCount === 0) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-[max(4.5rem,calc(env(safe-area-inset-top)+4rem))] z-40 flex flex-col items-center gap-2 px-3"
    >
      {pendingMediaCount > 0 ? (
        <Button
          className="pointer-events-auto h-11 rounded-full border-blue-600 bg-blue-600 px-3.5 text-sm text-white shadow-lg shadow-black/10 backdrop-blur-md hover:border-blue-700 hover:bg-blue-700 hover:text-white focus-visible:border-blue-500 focus-visible:ring-blue-500/50 motion-reduce:transition-none sm:h-9"
          onClick={() => revealPendingMedia(true)}
          type="button"
          variant="outline"
        >
          有{pendingMediaCount}张新照片，点击查看
        </Button>
      ) : null}
      {connectionInterrupted ? (
        <div className="rounded-full border border-border/70 bg-background/88 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur-md">
          实时更新暂时中断，正在重连…
        </div>
      ) : null}
    </div>
  );
}
