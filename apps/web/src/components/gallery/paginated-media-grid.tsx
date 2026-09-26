"use client";

import type { PublicMediaView } from "@photostream/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MediaGrid } from "@/components/gallery/media-grid";
import { Button } from "@/components/ui/button";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { Spinner } from "@/components/ui/spinner";
import { ClientApiError, clientGet } from "@/lib/client-api";
import {
  getWarmDerivedImageUrl,
  isWarmDerivedImageDecoded,
  loadDerivedImage,
  markDerivedImageDecoded,
} from "@/lib/derived-image-cache";
import { orderFeaturedMedia } from "@/lib/featured-order";
import { userFacingErrorMessage } from "@/lib/user-facing-error";

interface MediaPage {
  readonly items: readonly PublicMediaView[];
  readonly nextCursor: string | null;
  readonly eventCursor: number;
}

interface GridPreviewVariant {
  readonly kind: "photo_480" | "photo_960";
  readonly bytes: number;
  readonly url: string;
}

const publicMediaPageSize = 60;
const dataSaverMediaPageSize = 30;
const publicMediaVisibilityDelayMs = 15_000;
const livePreviewRetryDelays = [0, 400, 1_000, 2_500, 5_000, 10_000, 30_000] as const;

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

function gridPreviewVariant(media: PublicMediaView): GridPreviewVariant | null {
  const preview480 = media.variants.find((candidate) => candidate.kind === "photo_480");
  if (preview480?.kind === "photo_480") {
    return { kind: preview480.kind, bytes: preview480.bytes, url: preview480.url };
  }
  const preview960 = media.variants.find((candidate) => candidate.kind === "photo_960");
  if (preview960?.kind === "photo_960") {
    return { kind: preview960.kind, bytes: preview960.bytes, url: preview960.url };
  }
  return null;
}

async function decodeImage(url: string): Promise<void> {
  const image = new window.Image();
  if (typeof image.decode === "function") {
    image.src = url;
    await image.decode();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("缩略图解码失败"));
    image.src = url;
  });
}

async function prepareGridPreview(media: PublicMediaView, slug: string): Promise<void> {
  const preview = gridPreviewVariant(media);
  if (preview === null) throw new Error("新照片没有可用的列表缩略图");

  const request = {
    scope: slug,
    mediaId: media.id,
    kind: preview.kind,
    bytes: preview.bytes,
  };
  await loadDerivedImage({
    ...request,
    sourceUrl: preview.url,
    refreshUrl: async () => {
      const result = await clientGet<{ readonly url: string }>(
        `/api/v1/public/albums/${encodeURIComponent(slug)}/media/${encodeURIComponent(media.id)}/variants/${preview.kind}`,
      );
      return result.url;
    },
  });
  if (isWarmDerivedImageDecoded(request)) return;

  const warmUrl = getWarmDerivedImageUrl(request);
  if (warmUrl === null) throw new Error("新照片缩略图未能进入本地缓存");
  await decodeImage(warmUrl);
  markDerivedImageDecoded(request);
}

function wait(delay: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, delay));
}

function currentViewportAnchor(): { readonly mediaId: string; readonly top: number } | null {
  if (window.scrollY <= 220) return null;
  for (const element of document.querySelectorAll<HTMLElement>("[data-media-id]")) {
    const rect = element.getBoundingClientRect();
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) continue;
    const mediaId = element.dataset.mediaId;
    if (mediaId) return { mediaId, top: rect.top };
  }
  return null;
}

function restoreViewportAnchor(
  anchor: { readonly mediaId: string; readonly top: number } | null,
): void {
  if (anchor === null) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const target = [...document.querySelectorAll<HTMLElement>("[data-media-id]")].find(
        (element) => element.dataset.mediaId === anchor.mediaId,
      );
      if (target === undefined) return;
      const delta = target.getBoundingClientRect().top - anchor.top;
      if (Math.abs(delta) > 0.5) window.scrollBy({ top: delta, behavior: "auto" });
    });
  });
}

function livePreviewRetryDelay(attempt: number): number {
  return (
    livePreviewRetryDelays[Math.min(attempt, livePreviewRetryDelays.length - 1)] ??
    livePreviewRetryDelays[livePreviewRetryDelays.length - 1] ??
    30_000
  );
}

export function PaginatedMediaGrid({
  categoryId,
  dataSaverEnabled = false,
  featuredOnly = false,
  initialFeaturedIds,
  initialPage,
  initialSelectedId,
  initialVisibilityNow = Date.now(),
  slug,
}: Readonly<{
  categoryId?: string;
  dataSaverEnabled?: boolean;
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
  const [preparedLiveIds, setPreparedLiveIds] = useState<ReadonlySet<string>>(() => new Set());
  const [cursor, setCursor] = useState(initialPage.nextCursor);
  const [loading, setLoading] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [visibilityNow, setVisibilityNow] = useState(initialVisibilityNow);
  const loadMoreRef = useRef<HTMLButtonElement>(null);
  const requestInFlight = useRef(false);
  const cancelledLiveIds = useRef(new Set<string>());
  const liveQueueRef = useRef<string[]>([]);
  const preparedLiveMediaRef = useRef(new Map<string, PublicMediaView>());
  const pendingFeaturedIdsRef = useRef<string[]>([]);
  const pageSize = dataSaverEnabled ? dataSaverMediaPageSize : publicMediaPageSize;

  const allItems = useMemo(() => pages.flat(), [pages]);

  const refreshFeatured = useCallback(async () => {
    const result = await clientGet<{ readonly mediaIds: readonly string[] }>(
      `/api/v1/public/albums/${slug}/featured`,
    );
    const next = new Set(result.mediaIds);
    setFeaturedIds((current) => {
      if (!featuredOnly) {
        pendingFeaturedIdsRef.current = [];
        return sameStringSet(current, next) ? current : next;
      }

      pendingFeaturedIdsRef.current = pendingFeaturedIdsRef.current.filter(
        (mediaId) => next.has(mediaId) && !current.has(mediaId),
      );
      const pending = new Set(pendingFeaturedIdsRef.current);
      for (const mediaId of result.mediaIds) {
        if (!current.has(mediaId) && !pending.has(mediaId)) {
          pendingFeaturedIdsRef.current.push(mediaId);
          pending.add(mediaId);
        }
      }

      const visible = new Set([...current].filter((mediaId) => next.has(mediaId)));
      while (pendingFeaturedIdsRef.current.length >= 2) {
        const firstMediaId = pendingFeaturedIdsRef.current.shift();
        const secondMediaId = pendingFeaturedIdsRef.current.shift();
        if (firstMediaId === undefined || secondMediaId === undefined) break;
        if (next.has(firstMediaId)) visible.add(firstMediaId);
        if (next.has(secondMediaId)) visible.add(secondMediaId);
      }
      return sameStringSet(current, visible) ? current : visible;
    });
  }, [featuredOnly, slug]);

  useEffect(() => {
    setPages((current) => {
      const heldLiveIds = new Set(liveQueueRef.current);
      const safeInitialItems = initialPage.items.filter((item) => !heldLiveIds.has(item.id));
      const firstPage = current[0] ?? [];
      return [mergeMedia(firstPage, safeInitialItems), ...current.slice(1)];
    });
    setCursor(initialPage.nextCursor);
  }, [initialPage.items, initialPage.nextCursor]);

  useEffect(() => {
    const next = new Set(initialFeaturedIds);
    setFeaturedIds((current) => {
      if (featuredOnly && pendingFeaturedIdsRef.current.length > 0) {
        const held = new Set(pendingFeaturedIdsRef.current);
        const visible = new Set([...next].filter((mediaId) => !held.has(mediaId)));
        return sameStringSet(current, visible) ? current : visible;
      }
      return sameStringSet(current, next) ? current : next;
    });
  }, [featuredOnly, initialFeaturedIds]);

  useEffect(() => {
    let nextVisibleAt: number | null = null;
    for (const item of allItems) {
      if (preparedLiveIds.has(item.id)) continue;
      const deadline = visibleAt(item);
      if (deadline === null || deadline <= visibilityNow) continue;
      nextVisibleAt = nextVisibleAt === null ? deadline : Math.min(nextVisibleAt, deadline);
    }
    if (nextVisibleAt === null) return;
    const delay = Math.max(0, nextVisibleAt - Date.now()) + 50;
    const timer = window.setTimeout(() => setVisibilityNow(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [allItems, preparedLiveIds, visibilityNow]);

  useEffect(() => {
    if (!dataSaverEnabled) void refreshFeatured().catch(() => undefined);
    const changed = () => void refreshFeatured().catch(() => undefined);
    window.addEventListener("photostream:featured-updated", changed);
    return () => window.removeEventListener("photostream:featured-updated", changed);
  }, [dataSaverEnabled, refreshFeatured]);

  useEffect(() => {
    const remove = (event: Event) => {
      const detail = (event as CustomEvent<{ readonly mediaId?: string }>).detail;
      if (typeof detail?.mediaId !== "string") return;
      cancelledLiveIds.current.add(detail.mediaId);
      liveQueueRef.current = liveQueueRef.current.filter((mediaId) => mediaId !== detail.mediaId);
      preparedLiveMediaRef.current.delete(detail.mediaId);
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
      setPreparedLiveIds((current) => {
        if (!current.has(detail.mediaId as string)) return current;
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
    const inFlightIds = new Set<string>();

    const removeQueuedLiveMedia = (mediaId: string) => {
      liveQueueRef.current = liveQueueRef.current.filter((queuedId) => queuedId !== mediaId);
      preparedLiveMediaRef.current.delete(mediaId);
    };

    const flushPreparedLivePairs = () => {
      if (disposed) return;
      const batch: PublicMediaView[] = [];
      while (liveQueueRef.current.length >= 2) {
        const firstId = liveQueueRef.current[0];
        const secondId = liveQueueRef.current[1];
        if (firstId === undefined || secondId === undefined) break;
        const first = preparedLiveMediaRef.current.get(firstId);
        const second = preparedLiveMediaRef.current.get(secondId);
        if (first === undefined || second === undefined) break;

        liveQueueRef.current.splice(0, 2);
        preparedLiveMediaRef.current.delete(firstId);
        preparedLiveMediaRef.current.delete(secondId);
        batch.push(first, second);
      }
      if (batch.length === 0) return;

      const viewportAnchor = currentViewportAnchor();
      setPreparedLiveIds((current) => {
        const next = new Set(current);
        for (const media of batch) next.add(media.id);
        return next;
      });
      setPages((current) => {
        const firstPage = current[0] ?? [];
        return [mergeMedia(firstPage, batch), ...current.slice(1)];
      });
      restoreViewportAnchor(viewportAnchor);
      setLiveError(null);
      void refreshFeatured().catch(() => undefined);
    };

    const resolvePublishedMedia = async (mediaId: string): Promise<PublicMediaView | null> => {
      if (categoryId === undefined) {
        return clientGet<PublicMediaView>(
          `/api/v1/public/albums/${encodeURIComponent(slug)}/media/${encodeURIComponent(mediaId)}`,
        );
      }
      const query = new URLSearchParams({ limit: String(pageSize), categoryId });
      const page = await clientGet<MediaPage>(
        `/api/v1/public/albums/${encodeURIComponent(slug)}/media?${query.toString()}`,
      );
      return page.items.find((item) => item.id === mediaId) ?? null;
    };

    const preparePublishedMedia = async (mediaId: string): Promise<void> => {
      if (inFlightIds.has(mediaId)) return;
      inFlightIds.add(mediaId);
      let attempt = 0;
      let errorReported = false;
      try {
        while (!disposed && !cancelledLiveIds.current.has(mediaId)) {
          const delay = livePreviewRetryDelay(attempt);
          if (delay > 0) await wait(delay);
          if (disposed || cancelledLiveIds.current.has(mediaId)) return;

          try {
            const media = await resolvePublishedMedia(mediaId);
            if (media === null) {
              removeQueuedLiveMedia(mediaId);
              flushPreparedLivePairs();
              return;
            }
            if (disposed || cancelledLiveIds.current.has(mediaId)) return;
            await prepareGridPreview(media, slug);
            if (disposed || cancelledLiveIds.current.has(mediaId)) return;

            preparedLiveMediaRef.current.set(media.id, media);
            flushPreparedLivePairs();
            return;
          } catch (caught) {
            if (caught instanceof ClientApiError && caught.response?.code === "MEDIA_NOT_FOUND") {
              removeQueuedLiveMedia(mediaId);
              flushPreparedLivePairs();
              return;
            }
            attempt += 1;
            if (!errorReported && attempt >= 3 && !disposed) {
              errorReported = true;
              setLiveError(userFacingErrorMessage(caught, "新照片缩略图加载失败，正在重试。"));
            }
          }
        }
      } finally {
        inFlightIds.delete(mediaId);
      }
    };

    const published = (event: Event) => {
      const detail = (event as CustomEvent<{ readonly mediaId?: string }>).detail;
      if (typeof detail?.mediaId !== "string") return;
      cancelledLiveIds.current.delete(detail.mediaId);
      if (
        !liveQueueRef.current.includes(detail.mediaId) &&
        !preparedLiveMediaRef.current.has(detail.mediaId)
      ) {
        liveQueueRef.current.push(detail.mediaId);
      }
      void preparePublishedMedia(detail.mediaId);
    };

    window.addEventListener("photostream:media-published", published);
    return () => {
      disposed = true;
      liveQueueRef.current = [];
      preparedLiveMediaRef.current.clear();
      pendingFeaturedIdsRef.current = [];
      window.removeEventListener("photostream:media-published", published);
    };
  }, [categoryId, pageSize, refreshFeatured, slug]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (cursor === null || requestInFlight.current) return;
    requestInFlight.current = true;
    setLoading(true);
    setLoadMoreError(null);
    try {
      const query = new URLSearchParams({ cursor, limit: String(pageSize) });
      if (categoryId !== undefined) query.set("categoryId", categoryId);
      const page = await clientGet<MediaPage>(
        `/api/v1/public/albums/${slug}/media?${query.toString()}`,
      );
      setPages((current) => appendMediaPage(current, page.items));
      setCursor(page.nextCursor);
    } catch (caught) {
      setLoadMoreError(userFacingErrorMessage(caught, "加载更多照片失败，请稍后重试。"));
    } finally {
      requestInFlight.current = false;
      setLoading(false);
    }
  }, [categoryId, cursor, pageSize, slug]);

  useEffect(() => {
    if (!featuredOnly || cursor === null || loading || loadMoreError !== null) return;
    void loadMore();
  }, [cursor, featuredOnly, loadMore, loadMoreError, loading]);

  useEffect(() => {
    if (featuredOnly || dataSaverEnabled) return;
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
  }, [cursor, dataSaverEnabled, featuredOnly, loadMore, loadMoreError]);

  const eligiblePages = useMemo(
    () =>
      pages.map((page) =>
        page.filter((item) => {
          if (preparedLiveIds.has(item.id)) return true;
          const deadline = visibleAt(item);
          return deadline === null || deadline <= visibilityNow;
        }),
      ),
    [pages, preparedLiveIds, visibilityNow],
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
          <Spinner className="size-4 animate-spin" />
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
              <Spinner className="size-3.5 animate-spin" />
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
        nested
        onClose={() => setLoadMoreError(null)}
        title="无法继续加载"
      />
      <ErrorDialog
        message={liveError}
        nested
        onClose={() => setLiveError(null)}
        title="无法实时更新照片"
      />
    </div>
  );
}
