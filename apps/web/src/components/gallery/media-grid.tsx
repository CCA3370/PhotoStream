"use client";

import type { PublicMediaView } from "@photostream/contracts";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { Maximize2Icon } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { PhotoLightbox } from "@/components/gallery/photo-lightbox";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

function variant(media: PublicMediaView, kind: "photo_480" | "photo_960") {
  return media.variants.find((candidate) => candidate.kind === kind) ?? null;
}

function MediaTile({
  media,
  onOpen,
}: Readonly<{ media: PublicMediaView; onOpen: (mediaId: string) => void }>) {
  const preview = variant(media, "photo_480") ?? variant(media, "photo_960");
  if (preview === null) {
    return (
      <div
        aria-hidden="true"
        className="aspect-[4/3] rounded-lg bg-muted"
        data-media-id={media.id}
      />
    );
  }
  return (
    <button
      aria-label="打开活动照片"
      className="group relative aspect-[4/3] min-h-11 overflow-hidden rounded-lg bg-muted ring-1 ring-border/60 transition hover:ring-border focus-visible:ring-2 focus-visible:ring-ring"
      data-media-id={media.id}
      onClick={() => onOpen(media.id)}
      type="button"
    >
      <Image
        alt="活动照片"
        fill
        sizes="(max-width: 479px) 50vw, (max-width: 767px) 33vw, (max-width: 1279px) 25vw, 20vw"
        src={preview.url}
        style={{ objectFit: "cover" }}
        unoptimized
      />
      <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/10 group-focus-visible:bg-black/10" />
      <div className="absolute top-2 right-2 grid size-8 place-items-center rounded-full bg-black/45 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        <Maximize2Icon aria-hidden="true" className="size-4" />
      </div>
    </button>
  );
}

function gridLayout(width: number): { columns: number; gap: number } {
  if (width < 480) return { columns: 2, gap: 8 };
  if (width < 768) return { columns: 3, gap: 8 };
  if (width < 1_024) return { columns: 4, gap: 10 };
  if (width < 1_440) return { columns: 5, gap: 10 };
  return { columns: 6, gap: 12 };
}

function VirtualMediaGrid({
  items,
  onOpen,
}: Readonly<{ items: readonly PublicMediaView[]; onOpen: (mediaId: string) => void }>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ columns: 2, gap: 8, width: 0, scrollMargin: 0 });
  const rowCount = Math.ceil(items.length / layout.columns);
  const tileWidth =
    layout.width === 0 ? 240 : (layout.width - layout.gap * (layout.columns - 1)) / layout.columns;
  const rowStep = tileWidth * 0.75 + layout.gap;
  const virtualizer = useWindowVirtualizer<HTMLDivElement>({
    count: rowCount,
    estimateSize: () => rowStep,
    getItemKey: (index) => items[index * layout.columns]?.id ?? index,
    overscan: 4,
    scrollMargin: layout.scrollMargin,
  });

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const measure = () => {
      const width = container.getBoundingClientRect().width;
      const next = gridLayout(width);
      setLayout({
        ...next,
        width,
        scrollMargin: container.getBoundingClientRect().top + window.scrollY,
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
      <section aria-label="活动影像网格" className="w-full" ref={containerRef}>
        <div className="grid grid-cols-2 gap-2 min-[480px]:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {items.slice(0, 18).map((media) => (
            <MediaTile key={media.id} media={media} onOpen={onOpen} />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="活动影像网格"
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
              <MediaTile key={media.id} media={media} onOpen={onOpen} />
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

  useEffect(() => {
    setSelectedId((current) =>
      current === null || items.some((item) => item.id === current) ? current : null,
    );
  }, [items]);

  if (items.length === 0) {
    return (
      <Empty className="min-h-64 rounded-xl border border-dashed">
        <EmptyHeader>
          <EmptyTitle>暂无照片</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <>
      {items.length > 200 ? (
        <VirtualMediaGrid items={items} onOpen={setSelectedId} />
      ) : (
        <div className="grid grid-cols-2 gap-2 min-[480px]:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {items.map((media) => (
            <MediaTile key={media.id} media={media} onOpen={setSelectedId} />
          ))}
        </div>
      )}
      <PhotoLightbox
        items={items}
        onClose={() => setSelectedId(null)}
        onSelect={setSelectedId}
        selectedId={selectedId}
        slug={slug}
      />
    </>
  );
}
