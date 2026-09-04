"use client";

import type { PublicMediaView } from "@photostream/contracts";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { DownloadIcon, Maximize2Icon } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { DownloadButton } from "@/components/gallery/download-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
        className="aspect-[4/3] rounded-2xl bg-muted"
        data-media-id={media.id}
      />
    );
  }
  return (
    <button
      aria-label={`打开活动照片 ${media.publishSequence}`}
      className="group relative aspect-[4/3] min-h-11 overflow-hidden rounded-2xl bg-muted shadow-sm ring-1 ring-border/60 transition duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring"
      data-media-id={media.id}
      onClick={() => onOpen(media)}
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
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/65 via-black/15 to-transparent p-3 pt-10 text-white opacity-95 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-visible:opacity-100">
        <span className="text-xs font-medium tracking-wide">#{media.publishSequence}</span>
        <Maximize2Icon aria-hidden="true" className="size-4" />
      </div>
    </button>
  );
}

function gridLayout(width: number): { columns: number; gap: number } {
  if (width < 480) return { columns: 2, gap: 8 };
  if (width < 768) return { columns: 3, gap: 10 };
  if (width < 1_024) return { columns: 4, gap: 12 };
  if (width < 1_440) return { columns: 5, gap: 14 };
  return { columns: 6, gap: 16 };
}

function VirtualMediaGrid({
  items,
  onOpen,
}: Readonly<{ items: readonly PublicMediaView[]; onOpen: (media: PublicMediaView) => void }>) {
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
        <div className="grid grid-cols-2 gap-2 min-[480px]:grid-cols-3 md:grid-cols-4 md:gap-3 xl:grid-cols-5 2xl:grid-cols-6">
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
  const [selected, setSelected] = useState<PublicMediaView | null>(null);

  useEffect(() => {
    setSelected((current) =>
      current === null ? null : (items.find((item) => item.id === current.id) ?? null),
    );
  }, [items]);

  if (items.length === 0) {
    return (
      <Empty className="min-h-72 rounded-2xl border border-dashed bg-muted/20">
        <EmptyHeader>
          <EmptyTitle>还没有已发布影像</EmptyTitle>
          <EmptyDescription>新照片发布后会自动出现在这里。</EmptyDescription>
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
        <div className="grid grid-cols-2 gap-2 min-[480px]:grid-cols-3 md:grid-cols-4 md:gap-3 xl:grid-cols-5 xl:gap-4 2xl:grid-cols-6">
          {items.map((media) => (
            <MediaTile key={media.id} media={media} onOpen={setSelected} />
          ))}
        </div>
      )}
      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="public-theme max-h-[calc(100dvh-1rem)] max-w-[calc(100%-1rem)] overflow-y-auto bg-background p-3 sm:max-w-6xl sm:p-4">
          <DialogTitle className="sr-only">活动照片预览</DialogTitle>
          <DialogDescription className="sr-only">完整比例查看当前活动照片</DialogDescription>
          {large === null || selected === null ? null : (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div className="relative h-[min(72dvh,820px)] min-h-72 overflow-hidden rounded-xl bg-black/95">
                <Image
                  alt="活动照片"
                  fill
                  sizes="100vw"
                  src={large.url}
                  style={{ objectFit: "contain" }}
                  unoptimized
                />
              </div>
              <aside className="flex flex-col gap-4 rounded-xl border bg-card p-4">
                <div>
                  <Badge variant="secondary">照片 #{selected.publishSequence}</Badge>
                  <p className="mt-3 text-sm text-muted-foreground">
                    选择已开放的下载规格。下载次数会计入活动统计。
                  </p>
                </div>

                {slug === undefined ? null : (
                  <div className="flex flex-col gap-2">
                    <div className="mb-1 flex items-center gap-2 text-sm font-medium">
                      <DownloadIcon aria-hidden="true" className="size-4" />
                      下载
                    </div>
                    {selected.downloads.preview && variant(selected, "photo_1920") !== null ? (
                      <DownloadButton
                        bytes={(variant(selected, "photo_1920") as NonNullable<typeof large>).bytes}
                        kind="preview"
                        label="普通图"
                        mediaId={selected.id}
                        slug={slug}
                      />
                    ) : null}
                    {selected.downloads.original && selected.downloads.originalBytes !== null ? (
                      <DownloadButton
                        bytes={selected.downloads.originalBytes}
                        kind="original"
                        label="原图"
                        mediaId={selected.id}
                        slug={slug}
                      />
                    ) : null}
                  </div>
                )}

                {selected.downloads.original && selected.downloads.originalBytes !== null ? (
                  <Alert className="mt-auto">
                    <AlertTitle>原图可能包含相机元数据</AlertTitle>
                    <AlertDescription>
                      原始文件可能仍含拍摄时间、相机信息或 GPS；请勿再次公开传播。
                    </AlertDescription>
                  </Alert>
                ) : null}
              </aside>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
