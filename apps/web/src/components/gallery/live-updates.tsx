"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";

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

  useEffect(() => {
    if (currentSlug.current !== slug) {
      currentSlug.current = slug;
      lastEventId.current = initialEventId;
      knownIds.current = new Set(knownMediaIds);
    }
  }, [initialEventId, knownMediaIds, slug]);

  useEffect(() => {
    let fallbackPolling: ReturnType<typeof setInterval> | null = null;
    let safetyReconcile: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let eventSource: EventSource | null = null;
    let disposed = false;
    let catchUpRunning = false;
    let catchUpQueued = false;
    let reconciliationRequired = true;
    const pendingSse = new Map<number, PublicChange>();

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
        stopFallbackPolling();
        requestCatchUp();
      });
      source.addEventListener("error", () => {
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

    connectEventSource();
    requestCatchUp();
    safetyReconcile = setInterval(requestCatchUp, safetyReconcileIntervalMs);
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("focus", recoverAfterPause);
    window.addEventListener("online", recoverAfterPause);
    window.addEventListener("pageshow", recoverAfterPause);

    return () => {
      disposed = true;
      stopFallbackPolling();
      if (safetyReconcile !== null) clearInterval(safetyReconcile);
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("focus", recoverAfterPause);
      window.removeEventListener("online", recoverAfterPause);
      window.removeEventListener("pageshow", recoverAfterPause);
      closeEventSource();
    };
  }, [router, slug]);

  return null;
}
