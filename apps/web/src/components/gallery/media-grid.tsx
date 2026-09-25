"use client";

import type { PublicMediaView } from "@photostream/contracts";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { CachedPhotoImage } from "@/components/gallery/cached-photo-image";
import { PhotoLightbox } from "@/components/gallery/photo-lightbox";
import { PhotoLikeButton, type PhotoLikeState } from "@/components/gallery/photo-like-button";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { clientGet } from "@/lib/client-api";
import { gridMicroPreviewOverscanRows } from "@/lib/grid-thumbnail-policy";
import { userFacingErrorMessage } from "@/lib/user-facing-error";
import { cn } from "@/lib/utils";

interface LikeListResponse {
  readonly items: readonly PhotoLikeState[];
}

interface NativeViewTransition {
  readonly finished: Promise<void>;
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => NativeViewTransition;
};

function variant(media: PublicMediaView, kind: "photo_480" | "photo_960") {
  return media.variants.find((candidate) => candidate.kind === kind) ?? null;
}

function freshAnimationIndex(freshIds: ReadonlySet<string>, mediaId: string): number | undefined {
  let index = 0;
  for (const id of freshIds) {
    if (id === mediaId) return index;
    index += 1;
  }
  return undefined;
}

function MediaTile({
  animateIn,
  animationIndex,
  likeState,
  likesEnabled = true,
  media,
  onLikeChange,
  onOpen,
  slug,
}: Readonly<{
  animateIn?: boolean;
  animationIndex?: number | undefined;
  likeState: PhotoLikeState | null;
  likesEnabled?: boolean;
  media: PublicMediaView;
  onLikeChange: (state: PhotoLikeState) => void;
  onOpen: (mediaId: string) => void;
  slug?: string;
}>) {
  const preview = variant(media, "photo_480") ?? variant(media, "photo_960");
  if (preview === null) {
    return (
      <div
        aria-hidden="true"
        className="aspect-[4/3] rounded-[10px] bg-muted sm:rounded-xl"
        data-media-id={media.id}
      />
    );
  }
  return (
    <div
      className={cn(
        "group relative aspect-[4/3] min-h-11 overflow-hidden rounded-[10px] bg-muted ring-1 ring-border/45 transition-[transform,box-shadow,ring-color] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] active:scale-[0.975] sm:rounded-xl sm:hover:-translate-y-0.5 sm:hover:shadow-md sm:hover:ring-border motion-reduce:transform-none motion-reduce:transition-none",
        animateIn &&
          "animate-in fade-in-0 slide-in-from-top-1 duration-300 motion-reduce:animate-none",
      )}
      data-media-id={media.id}
      style={
        animateIn && animationIndex !== undefined
          ? { animationDelay: `${animationIndex * 30}ms` }
          : undefined
      }
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-muted" />
      <CachedPhotoImage
        alt="活动照片"
        bytes={preview.bytes}
        className="object-cover transform-gpu transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] sm:group-hover:scale-[1.025] motion-reduce:transform-none motion-reduce:transition-none"
        kind={preview.kind === "photo_480" ? "photo_480" : "photo_960"}
        mediaId={media.id}
        scope={slug ?? "public-media"}
        sizes="(max-width: 479px) 50vw, (max-width: 639px) 33vw, (max-width: 767px) 25vw, (max-width: 1023px) 20vw, (max-width: 1799px) 16.7vw, 14.3vw"
        sourceUrl={preview.url}
      />
      <div className="pointer-events-none absolute inset-0 bg-black/0 transition-colors duration-200 sm:group-hover:bg-black/[0.055] sm:group-focus-within:bg-black/[0.055] motion-reduce:transition-none" />
      <button
        aria-label="打开活动照片"
        className="absolute inset-0 z-10 touch-manipulation rounded-[10px] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:rounded-xl"
        onClick={() => onOpen(media.id)}
        type="button"
      >
        <span className="sr-only">打开活动照片</span>
      </button>
      {slug === undefined || !likesEnabled ? null : (
        <div className="absolute bottom-1 left-1 z-20 transition-[transform,opacity] duration-200 sm:bottom-1.5 sm:left-1.5 sm:translate-y-0.5 sm:opacity-90 sm:group-hover:translate-y-0 sm:group-hover:opacity-100 motion-reduce:transform-none motion-reduce:transition-none">
          <PhotoLikeButton
            mediaId={media.id}
            mode="thumbnail"
            onChange={onLikeChange}
            slug={slug}
            state={likeState}
          />
        </div>
      )}
    </div>
  );
}

function gridLayout(width: number): { columns: number; gap: number } {
  if (width < 480) return { columns: 2, gap: 5 };
  if (width < 640) return { columns: 3, gap: 6 };
  if (width < 768) return { columns: 4, gap: 7 };
  if (width < 1_024) return { columns: 5, gap: 8 };
  if (width < 1_800) return { columns: 6, gap: 12 };
  return { columns: 7, gap: 14 };
}

const staticGridClass =
  "grid grid-cols-2 gap-[5px] min-[480px]:grid-cols-3 min-[480px]:gap-1.5 sm:grid-cols-4 sm:gap-[7px] md:grid-cols-5 md:gap-2 lg:grid-cols-6 lg:gap-3 min-[1800px]:grid-cols-7 min-[1800px]:gap-3.5";

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function transitionName(mediaId: string): string {
  return `photostream-photo-${mediaId.replace(/[^a-zA-Z0-9_-]/gu, "-")}`;
}

function thumbnailTransitionElement(mediaId: string): HTMLElement | null {
  const tile = document.querySelector<HTMLElement>(`[data-media-id="${mediaId}"]`);
  return tile?.querySelector<HTMLElement>(":scope > span") ?? null;
}

function lightboxTransitionElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-lightbox-transition-image]");
}

function setTransitionName(element: HTMLElement | null, name: string | null): void {
  if (element === null) return;
  if (name === null) element.style.removeProperty("view-transition-name");
  else element.style.setProperty("view-transition-name", name);
}

function createTransitionStyle(name: string): HTMLStyleElement {
  const style = document.createElement("style");
  style.dataset.photostreamViewTransition = name;
  style.textContent = `
    ::view-transition-group(${name}) {
      animation-duration: 280ms;
      animation-timing-function: cubic-bezier(0.2, 0.78, 0.2, 1);
    }
    ::view-transition-old(${name}),
    ::view-transition-new(${name}) {
      animation-duration: 280ms;
      animation-timing-function: cubic-bezier(0.2, 0.78, 0.2, 1);
    }
  `;
  document.head.append(style);
  return style;
}

function lightboxHistoryMediaId(state: unknown): string | null {
  if (typeof state !== "object" || state === null) return null;
  const mediaId = (state as { readonly photostreamLightbox?: unknown }).photostreamLightbox;
  return typeof mediaId === "string" ? mediaId : null;
}

function withLightboxHistoryState(mediaId: string): Record<string, unknown> {
  const state = window.history.state;
  return {
    ...(typeof state === "object" && state !== null ? state : {}),
    photostreamLightbox: mediaId,
  };
}

function VirtualMediaGrid({
  freshIds,
  items,
  likeStates,
  likesEnabled,
  onLikeChange,
  onOpen,
  slug,
}: Readonly<{
  freshIds: ReadonlySet<string>;
  items: readonly PublicMediaView[];
  likeStates: ReadonlyMap<string, PhotoLikeState>;
  likesEnabled: boolean;
  onLikeChange: (state: PhotoLikeState) => void;
  onOpen: (mediaId: string) => void;
  slug?: string;
}>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ columns: 2, gap: 5, width: 0, scrollMargin: 0 });
  const rowCount = Math.ceil(items.length / layout.columns);
  const tileWidth =
    layout.width === 0 ? 240 : (layout.width - layout.gap * (layout.columns - 1)) / layout.columns;
  const rowStep = tileWidth * 0.75 + layout.gap;
  const virtualizer = useWindowVirtualizer<HTMLDivElement>({
    count: rowCount,
    estimateSize: () => rowStep,
    getItemKey: (index) => items[index * layout.columns]?.id ?? index,
    overscan: gridMicroPreviewOverscanRows,
    scrollMargin: layout.scrollMargin,
  });

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const measure = () => {
      const bounds = container.getBoundingClientRect();
      const next = gridLayout(bounds.width);
      setLayout({
        ...next,
        width: bounds.width,
        scrollMargin: bounds.top + window.scrollY,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    if (layout.width > 0) virtualizer.measure();
  }, [layout.width, virtualizer]);

  if (layout.width === 0) {
    return (
      <section aria-label="活动照片网格" className="w-full" ref={containerRef}>
        <div className={staticGridClass}>
          {items.slice(0, 21).map((media) => (
            <MediaTile
              animateIn={freshIds.has(media.id)}
              animationIndex={freshAnimationIndex(freshIds, media.id)}
              key={media.id}
              likeState={likeStates.get(media.id) ?? null}
              likesEnabled={likesEnabled}
              media={media}
              onLikeChange={onLikeChange}
              onOpen={onOpen}
              {...(slug === undefined ? {} : { slug })}
            />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="活动照片网格"
      className="relative w-full"
      data-virtualized="true"
      ref={containerRef}
      style={{ height: Math.max(0, virtualizer.getTotalSize() - layout.gap) }}
    >
      {virtualizer.getVirtualItems().map((row) => {
        const rowItems = items.slice(row.index * layout.columns, (row.index + 1) * layout.columns);
        return (
          <div
            className="absolute top-0 left-0 grid w-full"
            data-index={row.index}
            key={row.key}
            style={{
              gap: layout.gap,
              gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
              transform: `translateY(${row.start - layout.scrollMargin}px)`,
            }}
          >
            {rowItems.map((media) => (
              <MediaTile
                animateIn={freshIds.has(media.id)}
                animationIndex={freshAnimationIndex(freshIds, media.id)}
                key={media.id}
                likeState={likeStates.get(media.id) ?? null}
                likesEnabled={likesEnabled}
                media={media}
                onLikeChange={onLikeChange}
                onOpen={onOpen}
                {...(slug === undefined ? {} : { slug })}
              />
            ))}
          </div>
        );
      })}
    </section>
  );
}

export function MediaGrid({
  initialSelectedId,
  items,
  shareId,
  slug,
}: Readonly<{
  initialSelectedId?: string;
  items: readonly PublicMediaView[];
  shareId?: string;
  slug?: string;
}>) {
  const [selectedId, setSelectedId] = useState<string | null>(() => initialSelectedId ?? null);
  const [likeStates, setLikeStates] = useState<ReadonlyMap<string, PhotoLikeState>>(new Map());
  const [likeError, setLikeError] = useState<string | null>(null);
  const [freshIds, setFreshIds] = useState<ReadonlySet<string>>(new Set());
  const previousIdsRef = useRef<Set<string> | null>(null);
  const freshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRevealIdsRef = useRef(new Set<string>());
  const transitionActiveRef = useRef(false);
  const mediaIds = useMemo(() => items.map((item) => item.id), [items]);
  const likesEnabled = shareId === undefined;

  const updateLikeState = useCallback((state: PhotoLikeState) => {
    setLikeStates((current) => {
      const next = new Map(current);
      next.set(state.mediaId, state);
      return next;
    });
  }, []);

  const loadLikeStates = useCallback(
    async (ids: readonly string[]): Promise<void> => {
      if (slug === undefined || shareId !== undefined || ids.length === 0) return;
      const chunks: string[][] = [];
      for (let index = 0; index < ids.length; index += 60) {
        chunks.push(ids.slice(index, index + 60));
      }
      const pages = await Promise.all(
        chunks.map((chunk) => {
          const query = new URLSearchParams({ mediaIds: chunk.join(",") });
          return clientGet<LikeListResponse>(
            `/api/v1/public/albums/${slug}/likes?${query.toString()}`,
          );
        }),
      );
      setLikeStates((current) => {
        const next = new Map(current);
        for (const page of pages) {
          for (const state of page.items) next.set(state.mediaId, state);
        }
        return next;
      });
    },
    [shareId, slug],
  );

  const openMedia = useCallback(
    (mediaId: string): void => {
      setSelectedId(mediaId);
      if (slug === undefined) return;
      // Keep the address unchanged so embedded browsers do not treat opening a photo as a new visit.
      window.history.pushState(withLightboxHistoryState(mediaId), "");
    },
    [slug],
  );

  const selectMedia = useCallback(
    (mediaId: string): void => {
      setSelectedId(mediaId);
      if (slug === undefined || lightboxHistoryMediaId(window.history.state) === null) return;
      window.history.replaceState(withLightboxHistoryState(mediaId), "");
    },
    [slug],
  );

  const closeMedia = useCallback((): void => {
    if (selectedId === null) return;
    if (lightboxHistoryMediaId(window.history.state) !== null) {
      window.history.back();
    }

    const documentWithTransition = document as ViewTransitionDocument;
    const source = lightboxTransitionElement();
    const target = thumbnailTransitionElement(selectedId);
    const targetBounds = target?.getBoundingClientRect();
    const galleryMain = target?.closest<HTMLElement>("#gallery-main") ?? null;
    const galleryShell = galleryMain?.closest<HTMLElement>(".public-theme") ?? null;
    const galleryHeaderBottom =
      galleryShell?.querySelector<HTMLElement>(":scope > header")?.getBoundingClientRect().bottom ??
      0;
    const galleryFooterTop =
      galleryShell?.querySelector<HTMLElement>(":scope > footer")?.getBoundingClientRect().top ??
      window.innerHeight;
    const filterNavBottom =
      galleryMain?.querySelector<HTMLElement>('nav[aria-label="相册筛选"]')?.getBoundingClientRect()
        .bottom ?? galleryHeaderBottom;
    const visibleTop = Math.max(0, galleryHeaderBottom, filterNavBottom);
    const visibleBottom = Math.min(window.innerHeight, galleryFooterTop);
    // Native View Transition snapshots are painted in the top layer, so they are not clipped
    // by the sticky gallery header/filter/footer. Only shrink back to a thumbnail when the
    // entire destination is inside the unobscured gallery viewport.
    const targetFullyVisible =
      targetBounds !== undefined &&
      targetBounds.top >= visibleTop &&
      targetBounds.bottom <= visibleBottom &&
      targetBounds.left >= 0 &&
      targetBounds.right <= window.innerWidth;

    if (
      transitionActiveRef.current ||
      documentWithTransition.startViewTransition === undefined ||
      source === null ||
      target === null ||
      !targetFullyVisible ||
      prefersReducedMotion()
    ) {
      setSelectedId(null);
      return;
    }

    const name = transitionName(selectedId);
    const style = createTransitionStyle(name);
    setTransitionName(source, name);
    transitionActiveRef.current = true;

    try {
      const transition = documentWithTransition.startViewTransition(() => {
        setTransitionName(source, null);
        flushSync(() => setSelectedId(null));
        setTransitionName(target, name);
      });
      void transition.finished.finally(() => {
        setTransitionName(source, null);
        setTransitionName(target, null);
        style.remove();
        transitionActiveRef.current = false;
      });
    } catch {
      setTransitionName(source, null);
      setTransitionName(target, null);
      style.remove();
      transitionActiveRef.current = false;
      setSelectedId(null);
    }
  }, [selectedId]);

  useEffect(() => {
    if (initialSelectedId === undefined) return;
    if (items.some((item) => item.id === initialSelectedId)) setSelectedId(initialSelectedId);
  }, [initialSelectedId, items]);

  useEffect(() => {
    const onPopState = () => {
      const mediaId = lightboxHistoryMediaId(window.history.state);
      setSelectedId(mediaId !== null && items.some((item) => item.id === mediaId) ? mediaId : null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [items]);

  useEffect(() => {
    setSelectedId((current) =>
      current === null || items.some((item) => item.id === current) ? current : null,
    );
  }, [items]);

  useEffect(() => {
    const nextIds = new Set(mediaIds);
    const previousIds = previousIdsRef.current;
    previousIdsRef.current = nextIds;
    if (previousIds === null) return;

    const added = mediaIds.filter((id) => !previousIds.has(id)).slice(0, 6);
    if (added.length === 0) return;
    if (freshTimerRef.current !== null) clearTimeout(freshTimerRef.current);
    setFreshIds(new Set(added));
    freshTimerRef.current = setTimeout(() => {
      setFreshIds(new Set());
      freshTimerRef.current = null;
    }, 520);
  }, [mediaIds]);

  useEffect(
    () => () => {
      if (freshTimerRef.current !== null) clearTimeout(freshTimerRef.current);
    },
    [],
  );

  const revealAvailableMedia = useCallback(() => {
    const available = [...pendingRevealIdsRef.current].filter((id) => mediaIds.includes(id));
    if (available.length === 0) return;
    for (const id of available) pendingRevealIdsRef.current.delete(id);
    const ids = available.slice(0, 12);
    if (freshTimerRef.current !== null) clearTimeout(freshTimerRef.current);
    setFreshIds(new Set(ids));
    freshTimerRef.current = setTimeout(() => {
      setFreshIds(new Set());
      freshTimerRef.current = null;
    }, 1_400);
  }, [mediaIds]);

  useEffect(() => {
    const reveal = (event: Event) => {
      const detail = (event as CustomEvent<{ readonly mediaIds?: readonly string[] }>).detail;
      for (const id of detail?.mediaIds ?? []) pendingRevealIdsRef.current.add(id);
      revealAvailableMedia();
    };
    window.addEventListener("photostream:reveal-new-media", reveal);
    return () => window.removeEventListener("photostream:reveal-new-media", reveal);
  }, [revealAvailableMedia]);

  useEffect(() => {
    revealAvailableMedia();
  }, [revealAvailableMedia]);

  useEffect(() => {
    if (slug === undefined || shareId !== undefined || mediaIds.length === 0) return;
    let disposed = false;
    void loadLikeStates(mediaIds).catch((caught: unknown) => {
      if (!disposed) {
        setLikeError(userFacingErrorMessage(caught, "无法加载点赞信息，请稍后重试。"));
      }
    });
    return () => {
      disposed = true;
    };
  }, [loadLikeStates, mediaIds, shareId, slug]);

  useEffect(() => {
    if (slug === undefined || shareId !== undefined) return;
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ readonly mediaId?: string }>).detail;
      if (typeof detail?.mediaId !== "string" || !mediaIds.includes(detail.mediaId)) return;
      void loadLikeStates([detail.mediaId]).catch((caught: unknown) => {
        setLikeError(userFacingErrorMessage(caught, "无法更新点赞信息，请稍后重试。"));
      });
    };
    window.addEventListener("photostream:likes-updated", refresh);
    return () => window.removeEventListener("photostream:likes-updated", refresh);
  }, [loadLikeStates, mediaIds, shareId, slug]);

  if (items.length === 0) {
    return (
      <Empty className="min-h-48 rounded-xl border border-dashed sm:min-h-56">
        <EmptyHeader>
          <EmptyTitle>暂无照片</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <>
      {items.length > 200 ? (
        <VirtualMediaGrid
          freshIds={freshIds}
          items={items}
          likeStates={likeStates}
          likesEnabled={likesEnabled}
          onLikeChange={updateLikeState}
          onOpen={openMedia}
          {...(slug === undefined ? {} : { slug })}
        />
      ) : (
        <div className={staticGridClass}>
          {items.map((media) => (
            <MediaTile
              animateIn={freshIds.has(media.id)}
              animationIndex={freshAnimationIndex(freshIds, media.id)}
              key={media.id}
              likeState={likeStates.get(media.id) ?? null}
              likesEnabled={likesEnabled}
              media={media}
              onLikeChange={updateLikeState}
              onOpen={openMedia}
              {...(slug === undefined ? {} : { slug })}
            />
          ))}
        </div>
      )}
      <PhotoLightbox
        items={items}
        likeStates={likeStates}
        onClose={closeMedia}
        onLikeChange={updateLikeState}
        onSelect={selectMedia}
        selectedId={selectedId}
        {...(shareId === undefined ? {} : { shareId })}
        {...(slug === undefined ? {} : { slug })}
      />
      <ErrorDialog
        message={likeError}
        nested={selectedId !== null}
        onClose={() => setLikeError(null)}
        title="点赞信息加载失败"
      />
    </>
  );
}
