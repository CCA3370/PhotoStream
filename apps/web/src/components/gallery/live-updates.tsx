"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { clientGet } from "@/lib/client-api";

interface PublicChange {
  readonly id: number;
  readonly type: string;
  readonly mediaId: string | null;
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
  const [count, setCount] = useState(0);
  const [pending, startTransition] = useTransition();
  const lastEventId = useRef(initialEventId);
  const knownIds = useRef(new Set(knownMediaIds));

  useEffect(() => {
    lastEventId.current = Math.max(lastEventId.current, initialEventId);
    for (const id of knownMediaIds) knownIds.current.add(id);
  }, [initialEventId, knownMediaIds]);

  useEffect(() => {
    let polling: ReturnType<typeof setInterval> | null = null;
    let disposed = false;

    const receive = (event: PublicChange) => {
      if (event.id <= lastEventId.current) return;
      lastEventId.current = event.id;
      if (event.type === "media.published") {
        if (event.mediaId !== null && !knownIds.current.has(event.mediaId)) {
          knownIds.current.add(event.mediaId);
          setCount((current) => current + 1);
        }
        return;
      }
      if (event.type === "media.updated") {
        startTransition(() => router.refresh());
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

    const poll = async () => {
      try {
        const result = await clientGet<{ readonly events: readonly PublicChange[] }>(
          `/api/v1/public/albums/${slug}/changes?after=${lastEventId.current}`,
        );
        for (const event of result.events) receive(event);
      } catch {
        // EventSource reconnect and the next bounded poll both remain available.
      }
    };
    const startPolling = () => {
      if (polling !== null || disposed) return;
      void poll();
      polling = setInterval(() => void poll(), 15_000);
    };
    const stopPolling = () => {
      if (polling === null) return;
      clearInterval(polling);
      polling = null;
    };

    const events = new EventSource(
      `/api/v1/public/albums/${slug}/events?after=${lastEventId.current}`,
    );
    const receiveSse = (type: string, event: Event) => {
      const message = event as MessageEvent<string>;
      try {
        const parsed = JSON.parse(message.data) as PublicChange;
        receive({ ...parsed, type });
      } catch {
        startPolling();
      }
    };
    const published = (event: Event) => receiveSse("media.published", event);
    const updated = (event: Event) => receiveSse("media.updated", event);
    const hidden = (event: Event) => receiveSse("media.hidden", event);
    const deleted = (event: Event) => receiveSse("media.deleted", event);
    const restored = (event: Event) => receiveSse("media.restored", event);
    events.addEventListener("media.published", published);
    events.addEventListener("media.updated", updated);
    events.addEventListener("media.hidden", hidden);
    events.addEventListener("media.deleted", deleted);
    events.addEventListener("media.restored", restored);
    events.addEventListener("open", stopPolling);
    events.addEventListener("error", startPolling);
    return () => {
      disposed = true;
      stopPolling();
      events.close();
    };
  }, [router, slug]);

  if (count === 0) return null;
  return (
    <Button
      className="fixed top-4 left-1/2 -translate-x-1/2"
      disabled={pending}
      onClick={() => {
        startTransition(() => {
          router.refresh();
          setCount(0);
          window.scrollTo({ top: 0, behavior: "smooth" });
        });
      }}
      type="button"
    >
      {pending ? "正在更新…" : `有 ${count} 条新影像`}
    </Button>
  );
}
