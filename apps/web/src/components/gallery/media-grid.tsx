"use client";

import type { PublicMediaView } from "@photostream/contracts";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CachedPhotoImage } from "@/components/gallery/cached-photo-image";
import { PhotoLightbox } from "@/components/gallery/photo-lightbox";
import { PhotoLikeButton, type PhotoLikeState } from "@/components/gallery/photo-like-button";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { clientGet } from "@/lib/client-api";

interface LikeListResponse {
  readonly items: readonly PhotoLikeState[];
}

function variant(media: PublicMediaView, kind: "photo_480" | "photo_960") {
  return media.variants.find((candidate) => candidate.kind === kind) ?? null;
}

function MediaTile({
  likeState,
  media,
  onLikeChange,
  onOpen,
  slug,
}: Readonly<{
  likeState: PhotoLikeState | null;
  media: PublicMediaView;
  onLikeChange: (state: PhotoLikeState) => void;
  onOpen: (mediaId: string) => void;
  slug?: string;
}>) {
  const preview = variant(media, "photo_480") ?? variant(media, "photo_960");
  const portrait = media.height > media.width;
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
      className="group relative aspect-[4/3] min-h-11 overflow-hidden rounded-[10px] bg-muted ring-1 ring-border/45 transition-[transform,box-shadow,ring-color] duration-150 active:scale-[0.985] sm:rounded-xl sm:hover:-translate-y-px sm:hover:shadow-md sm:hover:ring-border"
      data-media-id={media.id}
    >
      <CachedPhotoImage
        alt="活动照片"
        bytes={preview.bytes}
        className={portrait ? "bg-muted object-contain" : "object-cover"}
        kind={preview.kind === "photo_480" ? "photo_480" : "photo_960"}
        mediaId={media.id}
        scope={slug ?? "public-media"}
        sizes="(max-width: 479px) 50vw, (max-width: 639px) 33vw, (max-width: 767px) 25vw, (max-width: 1023px) 20vw, (max-width: 1279px) 17vw, 15vw"
        sourceUrl={preview.url}
      />
      <div className="pointer-events-none absolute inset-0 bg-black/0 transition-colors duration-150 sm:group-hover:bg-black/[0.06] sm:group-focus-within:bg-black/[0.06]" />
      <button
        aria-label="打开活动照片"
        className="absolute inset-0 z-10 touch-manipulation rounded-[10px] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:rounded-xl"
        onClick={() => onOpen(media.id)}
        type="button"
      >
        <span className="sr-only">打开活动照片</span>
      </button>
      {slug === undefined ? null : (
        <div className="absolute bottom-1 left-1 z-20 sm:bottom-1.5 sm:left-1.5">
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
  if (width < 1_280) return { columns: 6, gap: 9 };
  return { columns: 7, gap: 10 };
}

const staticGridClass =
  "grid grid-cols-2 gap-[5px] min-[480px]:grid-cols-3 min-[480px]:gap-1.5 sm:grid-cols-4 sm:gap-[7px] md:grid-cols-5 md:gap-2 lg:grid-cols-6 lg:gap-[9px] xl:grid-cols-7 xl:gap-2.5";

function VirtualMediaGrid({
  items,
  likeStates,
  onLikeChange,
  onOpen,
  slug,
}: Readonly<{
  items: readonly PublicMediaView[];
  likeStates: ReadonlyMap<string, PhotoLikeState>;
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
    overscan: 5,
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
              key={media.id}
              likeState={likeStates.get(media.id) ?? null}
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
                key={media.id}
                likeState={likeStates.get(media.id) ?? null}
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
  items,
  slug,
}: Readonly<{ items: readonly PublicMediaView[]; slug?: string }>) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [likeStates, setLikeStates] = useState<ReadonlyMap<string, PhotoLikeState>>(new Map());
  const [likeError, setLikeError] = useState<string | null>(null);
  const mediaIds = useMemo(() => items.map((item) => item.id), [items]);

  const updateLikeState = useCallback((state: PhotoLikeState) => {
    setLikeStates((current) => {
      const next = new Map(current);
      next.set(state.mediaId, state);
      return next;
    });
  }, []);

  const loadLikeStates = useCallback(
    async (ids: readonly string[]): Promise<void> => {
      if (slug === undefined || ids.length === 0) return;
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
    [slug],
  );

  useEffect(() => {
    setSelectedId((current) =>
      current === null || items.some((item) => item.id === current) ? current : null,
    );
  }, [items]);

  useEffect(() => {
    if (slug === undefined || mediaIds.length === 0) return;
    let disposed = false;
    void loadLikeStates(mediaIds).catch((caught: unknown) => {
      if (!disposed) {
        setLikeError(caught instanceof Error ? caught.message : "无法加载点赞信息");
      }
    });
    return () => {
      disposed = true;
    };
  }, [loadLikeStates, mediaIds, slug]);

  useEffect(() => {
    if (slug === undefined) return;
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ readonly mediaId?: string }>).detail;
      if (typeof detail?.mediaId !== "string" || !mediaIds.includes(detail.mediaId)) return;
      void loadLikeStates([detail.mediaId]).catch((caught: unknown) => {
        setLikeError(caught instanceof Error ? caught.message : "无法更新点赞信息");
      });
    };
    window.addEventListener("photostream:likes-updated", refresh);
    return () => window.removeEventListener("photostream:likes-updated", refresh);
  }, [loadLikeStates, mediaIds, slug]);

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
          items={items}
          likeStates={likeStates}
          onLikeChange={updateLikeState}
          onOpen={setSelectedId}
          {...(slug === undefined ? {} : { slug })}
        />
      ) : (
        <div className={staticGridClass}>
          {items.map((media) => (
            <MediaTile
              key={media.id}
              likeState={likeStates.get(media.id) ?? null}
              media={media}
              onLikeChange={updateLikeState}
              onOpen={setSelectedId}
              {...(slug === undefined ? {} : { slug })}
            />
          ))}
        </div>
      )}
      <PhotoLightbox
        items={items}
        likeStates={likeStates}
        onClose={() => setSelectedId(null)}
        onLikeChange={updateLikeState}
        onSelect={setSelectedId}
        selectedId={selectedId}
        {...(slug === undefined ? {} : { slug })}
      />
      <ErrorDialog
        message={likeError}
        onClose={() => setLikeError(null)}
        title="点赞信息加载失败"
      />
    </>
  );
}
