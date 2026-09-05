"use client";

import type { PublicMediaView } from "@photostream/contracts";
import { LoaderCircleIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

function distributeFeatured(
  source: readonly PublicMediaView[],
  featuredIds: ReadonlySet<string>,
): readonly PublicMediaView[] {
  const featured = source.filter((item) => featuredIds.has(item.id));
  const regular = source.filter((item) => !featuredIds.has(item.id));
  if (featured.length === 0 || regular.length === 0) return source;

  const result: PublicMediaView[] = [];
  let featuredIndex = 0;
  let regularIndex = 0;
  while (featuredIndex < featured.length || regularIndex < regular.length) {
    const slot = result.length;
    const preferFeatured = slot % 4 === 1 && featuredIndex < featured.length;
    if (preferFeatured || regularIndex >= regular.length) {
      const item = featured[featuredIndex];
      if (item !== undefined) result.push(item);
      featuredIndex += 1;
    } else {
      const item = regular[regularIndex];
      if (item !== undefined) result.push(item);
      regularIndex += 1;
    }
  }
  return result;
}

export function PaginatedMediaGrid({
  categoryId,
  featuredOnly = false,
  initialPage,
  slug,
}: Readonly<{
  categoryId?: string;
  featuredOnly?: boolean;
  initialPage: MediaPage;
  slug: string;
}>) {
  const [items, setItems] = useState<readonly PublicMediaView[]>(initialPage.items);
  const [featuredIds, setFeaturedIds] = useState<ReadonlySet<string>>(new Set());
  const [cursor, setCursor] = useState(initialPage.nextCursor);
  const [loading, setLoading] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const loadMoreRef = useRef<HTMLButtonElement>(null);
  const requestInFlight = useRef(false);

  const refreshFeatured = useCallback(async () => {
    const result = await clientGet<{ readonly mediaIds: readonly string[] }>(
      `/api/v1/public/albums/${slug}/featured`,
    );
    setFeaturedIds(new Set(result.mediaIds));
  }, [slug]);

  useEffect(() => {
    setItems((current) => mergeMedia(current, initialPage.items));
  }, [initialPage.items]);

  useEffect(() => {
    void refreshFeatured().catch(() => undefined);
    const changed = () => void refreshFeatured().catch(() => undefined);
    window.addEventListener("photostream:featured-updated", changed);
    return () => window.removeEventListener("photostream:featured-updated", changed);
  }, [refreshFeatured]);

  useEffect(() => {
    const remove = (event: Event) => {
      const detail = (event as CustomEvent<{ readonly mediaId?: string }>).detail;
      if (typeof detail?.mediaId !== "string") return;
      setItems((current) => current.filter((item) => item.id !== detail.mediaId));
      setFeaturedIds((current) => {
        const next = new Set(current);
        next.delete(detail.mediaId as string);
        return next;
      });
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
            void refreshFeatured().catch(() => undefined);
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
  }, [categoryId, refreshFeatured, slug]);

  const loadMore = useCallback(async (): Promise<void> => {
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
  }, [categoryId, cursor, slug]);

  useEffect(() => {
    if (!featuredOnly || cursor === null || loading || loadMoreError !== null) return;
    void loadMore();
  }, [cursor, featuredOnly, loadMore, loadMoreError, loading]);

  useEffect(() => {
    if (featuredOnly) return;
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
  }, [cursor, featuredOnly, loadMore, loadMoreError]);

  const visibleItems = useMemo(
    () =>
      featuredOnly
        ? items.filter((item) => featuredIds.has(item.id))
        : distributeFeatured(items, featuredIds),
    [featuredIds, featuredOnly, items],
  );

  return (
    <div className="flex flex-col gap-5">
      <MediaGrid items={visibleItems} slug={slug} />
      {featuredOnly && cursor !== null ? (
        <div className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground">
          <LoaderCircleIcon className="size-4 animate-spin" />
          正在整理精选照片…
        </div>
      ) : cursor === null ? null : (
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
      {featuredOnly && cursor === null && visibleItems.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">暂无精选照片</p>
      ) : null}
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
