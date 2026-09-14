"use client";

import type { PublicMediaView } from "@photostream/contracts";
import { LoaderCircleIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MediaGrid } from "@/components/gallery/media-grid";
import { Button } from "@/components/ui/button";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { clientGet } from "@/lib/client-api";
import { orderFeaturedMedia } from "@/lib/featured-order";

interface MediaPage {
  readonly items: readonly PublicMediaView[];
  readonly nextCursor: string | null;
  readonly eventCursor: number;
}

const publicMediaPageSize = 60;
const publicMediaVisibilityDelayMs = 15_000;

function mergeMedia(
  current: readonly PublicMediaView[],
  incoming: readonly PublicMediaView[],
): readonly PublicMediaView[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()].sort((left, right) => right.publishSequence - left.publishSequence);
}

function appendMediaPage(
  current: readonly (readonly PublicMediaView[])[],
  incoming: readonly PublicMediaView[],
): readonly (readonly PublicMediaView[])[] {
  const seen = new Set(current.flatMap((page) => page.map((item) => item.id)));
  const nextPage = incoming.filter((item) => !seen.has(item.id));
  return nextPage.length === 0 ? current : [...current, nextPage];
}

function sameStringSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of right) {
    if (!left.has(value)) return false;
  }
  return true;
}

function visibleAt(item: PublicMediaView): number | null {
  const publishedAt = Date.parse(item.publishedAt);
  return Number.isFinite(publishedAt) ? publishedAt + publicMediaVisibilityDelayMs : null;
}

export function PaginatedMediaGrid({
  categoryId,
  featuredOnly = false,
  initialFeaturedIds,
  initialPage,
  initialSelectedId,
  initialVisibilityNow = Date.now(),
  slug,
}: Readonly<{
  categoryId?: string;
  featuredOnly?: boolean;
  initialFeaturedIds: readonly string[];
  initialPage: MediaPage;
  initialSelectedId?: string;
  initialVisibilityNow?: number;
  slug: string;
}>) {
  const [pages, setPages] = useState<readonly (readonly PublicMediaView[])[]>(() => [
    initialPage.items,
  ]);
  const [featuredIds, setFeaturedIds] = useState<ReadonlySet<string>>(
    () => new Set(initialFeaturedIds),
  );
  const [cursor, setCursor] = useState(initialPage.nextCursor);
  const [loading, setLoading] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [visibilityNow, setVisibilityNow] = useState(initialVisibilityNow);
  const loadMoreRef = useRef<HTMLButtonElement>(null);
  const requestInFlight = useRef(false);

  const allItems = useMemo(() => pages.flat(), [pages]);

  const refreshFeatured = useCallback(async () => {
    const result = await clientGet<{ readonly mediaIds: readonly string[] }>(
      `/api/v1/public/albums/${slug}/featured`,
    );
    const next = new Set(result.mediaIds);
    setFeaturedIds((current) => (sameStringSet(current, next) ? current : next));
  }, [slug]);

  useEffect(() => {
    setPages((current) => {
      const firstPage = current[0] ?? [];
      return [mergeMedia(firstPage, initialPage.items), ...current.slice(1)];
    });
    setCursor(initialPage.nextCursor);
  }, [initialPage.items, initialPage.nextCursor]);

  useEffect(() => {
    const next = new Set(initialFeaturedIds);
    setFeaturedIds((current) => (sameStringSet(current, next) ? current : next));
  }, [initialFeaturedIds]);

  useEffect(() => {
    let nextVisibleAt: number | null = null;
    for (const item of allItems) {
      const deadline = visibleAt(item);
      if (deadline === null || deadline <= visibilityNow) continue;
      nextVisibleAt = nextVisibleAt === null ? deadline : Math.min(nextVisibleAt, deadline);
    }
    if (nextVisibleAt === null) return;
    const delay = Math.max(0, nextVisibleAt - Date.now()) + 50;
    const timer = window.setTimeout(() => setVisibilityNow(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [allItems, visibilityNow]);

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
      setPages((current) =>
        current
          .map((page) => page.filter((item) => item.id !== detail.mediaId))
          .filter((page) => page.length > 0),
      );
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
          const query = new URLSearchParams({ limit: String(publicMediaPageSize) });
          if (categoryId !== undefined) query.set("categoryId", categoryId);
          const page = await clientGet<MediaPage>(
            `/api/v1/public/albums/${slug}/media?${query.toString()}`,
          );
          if (!disposed) {
            setPages((current) => {
              const firstPage = current[0] ?? [];
              return [mergeMedia(firstPage, page.items), ...current.slice(1)];
            });
            setLiveError(null);
            void refreshFeatured().catch(() => undefined);
          }
        } catch (caught) {
          if (!disposed) {
            setLiveError(caught instanceof Error ? caught.message : "无法同步新照片");
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
      const query = new URLSearchParams({ cursor, limit: String(publicMediaPageSize) });
      if (categoryId !== undefined) query.set("categoryId", categoryId);
      const page = await clientGet<MediaPage>(
        `/api/v1/public/albums/${slug}/media?${query.toString()}`,
      );
      setPages((current) => appendMediaPage(current, page.items));
      setCursor(page.nextCursor);
    } catch (caught) {
      setLoadMoreError(caught instanceof Error ? caught.message : "加载更多照片失败");
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
      { rootMargin: "500px 0px" },
    );
    observer.observe(button);
    return () => observer.disconnect();
  }, [cursor, featuredOnly, loadMore, loadMoreError]);

  const eligiblePages = useMemo(
    () =>
      pages.map((page) =>
        page.filter((item) => {
          const deadline = visibleAt(item);
          return deadline === null || deadline <= visibilityNow;
        }),
      ),
    [pages, visibilityNow],
  );
  const visibleItems = useMemo(
    () =>
      featuredOnly
        ? eligiblePages.flat().filter((item) => featuredIds.has(item.id))
        : eligiblePages.flatMap((page) => orderFeaturedMedia(page, featuredIds)),
    [eligiblePages, featuredIds, featuredOnly],
  );

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <MediaGrid
        {...(initialSelectedId === undefined ? {} : { initialSelectedId })}
        items={visibleItems}
        slug={slug}
      />
      {featuredOnly && cursor !== null ? (
        <div className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground">
          <LoaderCircleIcon className="size-4 animate-spin" />
          正在整理精选照片…
        </div>
      ) : cursor === null ? null : (
        <Button
          className="self-center rounded-full px-4"
          disabled={loading}
          onClick={() => void loadMore()}
          ref={loadMoreRef}
          size="sm"
          type="button"
          variant="outline"
        >
          {loading ? (
            <>
              <LoaderCircleIcon className="size-3.5 animate-spin" />
              正在加载…
            </>
          ) : (
            "加载更多"
          )}
        </Button>
      )}
      {featuredOnly && cursor === null && visibleItems.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">暂无精选照片</p>
      ) : null}
      <ErrorDialog
        message={loadMoreError}
        onClose={() => setLoadMoreError(null)}
        title="无法继续加载"
      />
      <ErrorDialog
        message={liveError}
        onClose={() => setLiveError(null)}
        title="无法实时更新照片"
      />
    </div>
  );
}
