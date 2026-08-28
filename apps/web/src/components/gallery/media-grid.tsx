"use client";

import type { PublicMediaView } from "@photostream/contracts";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

function variant(media: PublicMediaView, kind: "photo_480" | "photo_960" | "photo_1920") {
  return media.variants.find((candidate) => candidate.kind === kind) ?? null;
}

function MediaTile({
  media,
  onOpen,
}: Readonly<{ media: PublicMediaView; onOpen: (media: PublicMediaView) => void }>) {
  const preview = variant(media, "photo_480") ?? variant(media, "photo_960");
  if (preview === null) {
    return (
      <div
        aria-hidden="true"
        className="aspect-square rounded-lg bg-muted"
        data-media-id={media.id}
      />
    );
  }
  return (
    <button
      aria-label="打开活动照片"
      className="relative aspect-square min-h-11 overflow-hidden rounded-lg bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      data-media-id={media.id}
      onClick={() => onOpen(media)}
      type="button"
    >
      <Image
        alt="活动照片"
        fill
        sizes="(max-width: 479px) 50vw, (max-width: 767px) 33vw, (max-width: 1023px) 25vw, 176px"
        src={preview.url}
        style={{ objectFit: "cover" }}
        unoptimized
      />
    </button>
  );
}

function gridLayout(width: number): { columns: number; gap: number } {
  if (width < 480) return { columns: 2, gap: 8 };
  if (width < 768) return { columns: 3, gap: 8 };
  if (width < 1_024) return { columns: 4, gap: 12 };
  return { columns: Math.max(4, Math.floor((width + 12) / 188)), gap: 12 };
}

function VirtualMediaGrid({
  items,
  onOpen,
}: Readonly<{ items: readonly PublicMediaView[]; onOpen: (media: PublicMediaView) => void }>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ columns: 2, gap: 8, width: 0, scrollMargin: 0 });
  const rowCount = Math.ceil(items.length / layout.columns);
  const tileSize =
    layout.width === 0 ? 176 : (layout.width - layout.gap * (layout.columns - 1)) / layout.columns;
  const rowStep = tileSize + layout.gap;
  const virtualizer = useWindowVirtualizer<HTMLDivElement>({
    count: rowCount,
    estimateSize: () => rowStep,
    getItemKey: (index) => items[index * layout.columns]?.id ?? index,
    overscan: 3,
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
        <div className="grid grid-cols-2 gap-2 min-[480px]:grid-cols-3 md:grid-cols-4 md:gap-3 lg:grid-cols-[repeat(auto-fit,minmax(176px,1fr))]">
          {items.slice(0, 12).map((media) => (
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

export function MediaGrid({ items }: Readonly<{ items: readonly PublicMediaView[] }>) {
  const [selected, setSelected] = useState<PublicMediaView | null>(null);

  if (items.length === 0) {
    return (
      <Empty className="min-h-64 border">
        <EmptyHeader>
          <EmptyTitle>还没有已发布影像</EmptyTitle>
          <EmptyDescription>新照片发布后会出现在这里。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const large =
    selected === null ? null : (variant(selected, "photo_1920") ?? variant(selected, "photo_960"));
  return (
    <>
      {items.length > 200 ? (
        <VirtualMediaGrid items={items} onOpen={setSelected} />
      ) : (
        <div className="grid grid-cols-2 gap-2 min-[480px]:grid-cols-3 md:grid-cols-4 md:gap-3 lg:grid-cols-[repeat(auto-fit,minmax(176px,1fr))]">
          {items.map((media) => (
            <MediaTile key={media.id} media={media} onOpen={setSelected} />
          ))}
        </div>
      )}
      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="public-theme max-w-[calc(100%-1rem)] bg-background sm:max-w-5xl">
          <DialogTitle className="sr-only">活动照片预览</DialogTitle>
          <DialogDescription className="sr-only">完整比例查看当前活动照片</DialogDescription>
          {large === null || selected === null ? null : (
            <div className="relative h-[min(80dvh,900px)] w-full">
              <Image
                alt="活动照片"
                fill
                sizes="100vw"
                src={large.url}
                style={{ objectFit: "contain" }}
                unoptimized
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
