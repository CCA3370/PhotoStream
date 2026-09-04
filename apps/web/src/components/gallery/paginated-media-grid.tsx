"use client";

import type { PublicMediaView } from "@photostream/contracts";
import { useEffect, useRef, useState } from "react";

import { MediaGrid } from "@/components/gallery/media-grid";
import { Button } from "@/components/ui/button";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { clientGet } from "@/lib/client-api";

interface MediaPage {
  readonly items: readonly PublicMediaView[];
  readonly nextCursor: string | null;
  readonly eventCursor: number;
}

function mergeMedia(
  current: readonly PublicMediaView[],
  incoming: readonly PublicMediaView[],
): readonly PublicMediaView[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()].sort((left, right) => right.publishSequence - left.publishSequence);
}

export function PaginatedMediaGrid({
  categoryId,
  initialPage,
  slug,
}: Readonly<{
  categoryId?: string;
  initialPage: MediaPage;
  slug: string;
}>) {
  const [items, setItems] = useState<readonly PublicMediaView[]>(initialPage.items);
  const [cursor, setCursor] = useState(initialPage.nextCursor);
  const [loading, setLoading] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const loadMoreRef = useRef<HTMLButtonElement>(null);
  const requestInFlight = useRef(false);

  useEffect(() => {
    setItems((current) => mergeMedia(current, initialPage.items));
  }, [initialPage.items]);

  useEffect(() => {
    const remove = (event: Event) => {
      const detail = (event as CustomEvent<{ readonly mediaId?: string }>).detail;
      if (typeof detail?.mediaId !== "string") return;
      setItems((current) => current.filter((item) => item.id !== detail.mediaId));
    };
    window.addEventListener("photostream:media-removed", remove);
    return () => window.removeEventListener("photostream:media-removed", remove);
  }, []);

  useEffect(() => {
    let disposed = false;
    let refreshInFlight = false;
    let refreshQueued = false;

    const refreshPublishedMedia = async (): Promise<void> => {
      if (refreshInFlight) {
        refreshQueued = true;
        return;
      }
      refreshInFlight = true;
      do {
        refreshQueued = false;
        try {
          const query = new URLSearchParams({ limit: "60" });
          if (categoryId !== undefined) query.set("categoryId", categoryId);
          const page = await clientGet<MediaPage>(
            `/api/v1/public/albums/${slug}/media?${query.toString()}`,
          );
          if (!disposed) {
            setItems((current) => mergeMedia(current, page.items));
            setLiveError(null);
          }
        } catch (caught) {
          if (!disposed) {
            setLiveError(caught instanceof Error ? caught.message : "无法同步新影像");
          }
        }
      } while (refreshQueued && !disposed);
      refreshInFlight = false;
    };

    const published = (event: Event) => {
      const detail = (event as CustomEvent<{ readonly mediaId?: string }>).detail;
      if (typeof detail?.mediaId !== "string") return;
      void refreshPublishedMedia();
    };

    window.addEventListener("photostream:media-published", published);
    return () => {
      disposed = true;
      window.removeEventListener("photostream:media-published", published);
    };
  }, [categoryId, slug]);

  async function loadMore(): Promise<void> {
    if (cursor === null || requestInFlight.current) return;
    requestInFlight.current = true;
    setLoading(true);
    setLoadMoreError(null);
    try {
      const query = new URLSearchParams({ cursor, limit: "60" });
      if (categoryId !== undefined) query.set("categoryId", categoryId);
      const page = await clientGet<MediaPage>(
        `/api/v1/public/albums/${slug}/media?${query.toString()}`,
      );
      setItems((current) => mergeMedia(current, page.items));
      setCursor(page.nextCursor);
    } catch (caught) {
      setLoadMoreError(caught instanceof Error ? caught.message : "加载更多影像失败");
    } finally {
      requestInFlight.current = false;
      setLoading(false);
    }
  }

  useEffect(() => {
    const button = loadMoreRef.current;
    if (button === null || cursor === null || loadMoreError !== null) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(button);
    return () => observer.disconnect();
  });

  return (
    <div className="flex flex-col gap-5">
      <MediaGrid items={items} slug={slug} />
      {cursor === null ? null : (
        <Button
          className="self-center"
          disabled={loading}
          onClick={() => void loadMore()}
          ref={loadMoreRef}
          type="button"
          variant="outline"
        >
          {loading ? "正在加载…" : "加载更多影像"}
        </Button>
      )}
      <ErrorDialog
        message={loadMoreError}
        onClose={() => setLoadMoreError(null)}
        title="无法继续加载"
      />
      <ErrorDialog
        message={liveError}
        onClose={() => setLiveError(null)}
        title="无法实时更新影像"
      />
    </div>
  );
}
