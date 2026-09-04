"use client";

import type { PublicMediaView } from "@photostream/contracts";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  Maximize2Icon,
  Minimize2Icon,
  MinusIcon,
  PlusIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react";
import Image from "next/image";
import {
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { DownloadButton } from "@/components/gallery/download-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const minZoom = 1;
const maxZoom = 5;

type Point = { x: number; y: number };
type Gesture =
  | { mode: "idle" }
  | { mode: "pan"; start: Point; origin: Point }
  | { mode: "swipe"; start: Point }
  | { mode: "pinch"; distance: number; zoom: number };

function variant(media: PublicMediaView, kind: "photo_480" | "photo_960" | "photo_1920") {
  return media.variants.find((candidate) => candidate.kind === kind) ?? null;
}

function distance(points: readonly Point[]): number {
  const [first, second] = points;
  if (first === undefined || second === undefined) return 0;
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function PhotoLightbox({
  items,
  selectedId,
  slug,
  onClose,
  onSelect,
}: Readonly<{
  items: readonly PublicMediaView[];
  selectedId: string | null;
  slug?: string;
  onClose: () => void;
  onSelect: (mediaId: string) => void;
}>) {
  const selectedIndex =
    selectedId === null ? -1 : items.findIndex((item) => item.id === selectedId);
  const selected = selectedIndex < 0 ? null : (items[selectedIndex] ?? null);
  const large =
    selected === null ? null : (variant(selected, "photo_1920") ?? variant(selected, "photo_960"));
  const preview1920 = selected === null ? null : variant(selected, "photo_1920");
  const viewerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef(new Map<number, Point>());
  const gestureRef = useRef<Gesture>({ mode: "idle" });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenSupported, setFullscreenSupported] = useState(false);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);

  const clampPan = useCallback(
    (next: Point, nextZoom: number): Point => {
      const stage = stageRef.current;
      if (stage === null || selected === null || nextZoom <= 1) return { x: 0, y: 0 };
      const rect = stage.getBoundingClientRect();
      const fit = Math.min(rect.width / selected.width, rect.height / selected.height);
      const renderedWidth = selected.width * fit * nextZoom;
      const renderedHeight = selected.height * fit * nextZoom;
      const maxX = Math.max(0, (renderedWidth - rect.width) / 2);
      const maxY = Math.max(0, (renderedHeight - rect.height) / 2);
      return {
        x: clamp(next.x, -maxX, maxX),
        y: clamp(next.y, -maxY, maxY),
      };
    },
    [selected],
  );

  const changeZoom = useCallback(
    (value: number) => {
      const next = clamp(value, minZoom, maxZoom);
      setZoom(next);
      setPan((current) => clampPan(current, next));
    },
    [clampPan],
  );

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const selectOffset = useCallback(
    (offset: number) => {
      if (items.length < 2 || selectedIndex < 0) return;
      const index = (selectedIndex + offset + items.length) % items.length;
      const item = items[index];
      if (item !== undefined) onSelect(item.id);
    },
    [items, onSelect, selectedIndex],
  );

  const toggleFullscreen = useCallback(async () => {
    const viewer = viewerRef.current;
    if (!document.fullscreenEnabled || viewer === null) return;
    if (document.fullscreenElement === null) await viewer.requestFullscreen();
    else await document.exitFullscreen();
  }, []);

  useEffect(() => {
    if (selectedId === null) return;
    setLoaded(false);
    setDownloadMenuOpen(false);
    resetView();
    pointersRef.current.clear();
    gestureRef.current = { mode: "idle" };
  }, [resetView, selectedId]);

  useEffect(() => {
    setFullscreenSupported(document.fullscreenEnabled);
    const update = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  useEffect(() => {
    if (selectedIndex < 0 || items.length < 2) return;
    for (const offset of [-1, 1]) {
      const item = items[(selectedIndex + offset + items.length) % items.length];
      if (item === undefined) continue;
      const source = variant(item, "photo_1920") ?? variant(item, "photo_960");
      if (source !== null) {
        const image = document.createElement("img");
        image.src = source.url;
      }
    }
  }, [items, selectedIndex]);

  useEffect(() => {
    if (selected === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        selectOffset(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        selectOffset(1);
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        changeZoom(zoom + 0.5);
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        changeZoom(zoom - 0.5);
      } else if (event.key === "0") {
        event.preventDefault();
        resetView();
      } else if (event.key.toLowerCase() === "f" && fullscreenSupported) {
        event.preventDefault();
        void toggleFullscreen();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [changeZoom, fullscreenSupported, resetView, selectOffset, selected, toggleFullscreen, zoom]);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = { x: event.clientX, y: event.clientY };
    pointersRef.current.set(event.pointerId, point);
    const points = [...pointersRef.current.values()];
    if (points.length >= 2) {
      gestureRef.current = { mode: "pinch", distance: distance(points), zoom };
      setDragging(false);
      return;
    }
    if (zoom > 1) {
      gestureRef.current = { mode: "pan", start: point, origin: pan };
      setDragging(true);
    } else {
      gestureRef.current = { mode: "swipe", start: point };
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!pointersRef.current.has(event.pointerId)) return;
    const point = { x: event.clientX, y: event.clientY };
    pointersRef.current.set(event.pointerId, point);
    const gesture = gestureRef.current;
    const points = [...pointersRef.current.values()];
    if (gesture.mode === "pinch" && points.length >= 2 && gesture.distance > 0) {
      const next = clamp(gesture.zoom * (distance(points) / gesture.distance), minZoom, maxZoom);
      setZoom(next);
      setPan((current) => clampPan(current, next));
      return;
    }
    if (gesture.mode === "pan") {
      setPan(
        clampPan(
          {
            x: gesture.origin.x + point.x - gesture.start.x,
            y: gesture.origin.y + point.y - gesture.start.y,
          },
          zoom,
        ),
      );
    }
  }

  function finishPointer(event: ReactPointerEvent<HTMLDivElement>): void {
    const point = { x: event.clientX, y: event.clientY };
    const gesture = gestureRef.current;
    if (gesture.mode === "swipe") {
      const deltaX = point.x - gesture.start.x;
      const deltaY = point.y - gesture.start.y;
      if (Math.abs(deltaX) >= 60 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
        selectOffset(deltaX < 0 ? 1 : -1);
      }
    }
    pointersRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
    if (pointersRef.current.size === 0) gestureRef.current = { mode: "idle" };
  }

  function onWheel(event: ReactWheelEvent<HTMLDivElement>): void {
    event.preventDefault();
    changeZoom(zoom + (event.deltaY < 0 ? 0.35 : -0.35));
  }

  if (selected === null || large === null) return null;

  const canNavigate = items.length > 1;
  const canDownloadPreview =
    slug !== undefined && selected.downloads.preview && preview1920 !== null;
  const canDownloadOriginal =
    slug !== undefined && selected.downloads.original && selected.downloads.originalBytes !== null;
  const canDownload = canDownloadPreview || canDownloadOriginal;
  const imageTransform = `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="dark public-theme inset-0 top-0 left-0 h-dvh w-screen max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none bg-black p-0 text-white ring-0 sm:max-w-none"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">照片查看器</DialogTitle>
        <DialogDescription className="sr-only">
          可使用左右方向键切换照片，滚轮、双击或加减键缩放，拖动查看放大后的区域。
        </DialogDescription>

        <div className="relative h-full w-full overflow-hidden bg-black" ref={viewerRef}>
          <div
            aria-label="照片画布"
            className={cn(
              "absolute inset-0 touch-none select-none",
              zoom > 1 && (dragging ? "cursor-grabbing" : "cursor-grab"),
            )}
            onDoubleClick={() => (zoom === 1 ? changeZoom(2.5) : resetView())}
            onPointerCancel={finishPointer}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={finishPointer}
            onWheel={onWheel}
            ref={stageRef}
            role="application"
          >
            {!loaded ? (
              <div className="absolute inset-0 grid place-items-center text-sm text-white/60">
                正在加载高清图片…
              </div>
            ) : null}
            <div
              className="absolute inset-0 origin-center will-change-transform"
              style={{ transform: imageTransform }}
            >
              <Image
                alt="活动照片"
                className={cn(
                  "object-contain transition-opacity duration-150",
                  loaded ? "opacity-100" : "opacity-0",
                )}
                draggable={false}
                fill
                onLoad={() => setLoaded(true)}
                priority
                sizes="100vw"
                src={large.url}
                unoptimized
              />
            </div>
          </div>

          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-end bg-gradient-to-b from-black/70 via-black/20 to-transparent p-3 pb-14 sm:p-4 sm:pb-16">
            <div className="pointer-events-auto flex items-center gap-1.5">
              {fullscreenSupported ? (
                <Button
                  aria-label={fullscreen ? "退出全屏" : "进入全屏"}
                  className="border-white/15 bg-black/35 text-white backdrop-blur-md hover:bg-white/15 hover:text-white"
                  onClick={() => void toggleFullscreen()}
                  size="icon-lg"
                  title={fullscreen ? "退出全屏 (F)" : "全屏 (F)"}
                  type="button"
                  variant="outline"
                >
                  {fullscreen ? <Minimize2Icon /> : <Maximize2Icon />}
                </Button>
              ) : null}
              <Button
                aria-label="关闭照片查看器"
                className="border-white/15 bg-black/35 text-white backdrop-blur-md hover:bg-white/15 hover:text-white"
                onClick={onClose}
                size="icon-lg"
                title="关闭 (Esc)"
                type="button"
                variant="outline"
              >
                <XIcon />
              </Button>
            </div>
          </div>

          {canNavigate ? (
            <>
              <Button
                aria-label="上一张照片"
                className="absolute top-1/2 left-2 z-20 size-10 -translate-y-1/2 rounded-full border-white/15 bg-black/35 text-white backdrop-blur-md hover:bg-white/15 hover:text-white sm:left-4 sm:size-11"
                onClick={() => selectOffset(-1)}
                size="icon-lg"
                title="上一张 (←)"
                type="button"
                variant="outline"
              >
                <ChevronLeftIcon className="size-5 sm:size-6" />
              </Button>
              <Button
                aria-label="下一张照片"
                className="absolute top-1/2 right-2 z-20 size-10 -translate-y-1/2 rounded-full border-white/15 bg-black/35 text-white backdrop-blur-md hover:bg-white/15 hover:text-white sm:right-4 sm:size-11"
                onClick={() => selectOffset(1)}
                size="icon-lg"
                title="下一张 (→)"
                type="button"
                variant="outline"
              >
                <ChevronRightIcon className="size-5 sm:size-6" />
              </Button>
            </>
          ) : null}

          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-3 pt-16 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4 sm:pt-20">
            <div className="pointer-events-auto mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex items-center gap-2 text-xs text-white/70">
                <span>
                  {selected.width} × {selected.height}
                </span>
                <span aria-hidden="true">·</span>
                <span>{Math.round(zoom * 100)}%</span>
              </div>

              <div className="ml-auto flex max-w-full items-center overflow-hidden rounded-xl border border-white/10 bg-black/35 p-1 backdrop-blur-md">
                <div
                  aria-hidden={downloadMenuOpen}
                  className={cn(
                    "flex shrink-0 items-center overflow-hidden transition-[max-width,opacity,transform] duration-300 ease-out",
                    downloadMenuOpen
                      ? "pointer-events-none max-w-0 -translate-x-3 opacity-0"
                      : "max-w-48 translate-x-0 opacity-100",
                  )}
                >
                  <Button
                    aria-label="缩小"
                    className="text-white hover:bg-white/15 hover:text-white"
                    disabled={zoom <= minZoom}
                    onClick={() => changeZoom(zoom - 0.5)}
                    size="icon-sm"
                    title="缩小 (-)"
                    type="button"
                    variant="ghost"
                  >
                    <MinusIcon />
                  </Button>
                  <Button
                    aria-label="恢复适应屏幕"
                    className="min-w-14 text-white hover:bg-white/15 hover:text-white"
                    disabled={zoom === 1 && pan.x === 0 && pan.y === 0}
                    onClick={resetView}
                    size="sm"
                    title="适应屏幕 (0)"
                    type="button"
                    variant="ghost"
                  >
                    <RotateCcwIcon />
                    适应
                  </Button>
                  <Button
                    aria-label="放大"
                    className="text-white hover:bg-white/15 hover:text-white"
                    disabled={zoom >= maxZoom}
                    onClick={() => changeZoom(zoom + 0.5)}
                    size="icon-sm"
                    title="放大 (+)"
                    type="button"
                    variant="ghost"
                  >
                    <PlusIcon />
                  </Button>
                </div>

                {canDownload ? (
                  <>
                    <div
                      aria-hidden={downloadMenuOpen}
                      className={cn(
                        "flex shrink-0 items-center overflow-hidden transition-[max-width,opacity,transform] duration-300 ease-out",
                        downloadMenuOpen
                          ? "pointer-events-none max-w-0 translate-x-2 opacity-0"
                          : "max-w-36 translate-x-0 opacity-100",
                      )}
                    >
                      <Button
                        className="h-8 border-0 bg-transparent px-3 text-white shadow-none hover:bg-white/15 hover:text-white"
                        onClick={() => setDownloadMenuOpen(true)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <DownloadIcon data-icon="inline-start" />
                        下载图片
                      </Button>
                    </div>

                    <div
                      aria-hidden={!downloadMenuOpen}
                      className={cn(
                        "flex shrink-0 items-center overflow-hidden transition-[max-width,opacity,transform] duration-300 ease-out",
                        downloadMenuOpen
                          ? "max-w-[24rem] translate-x-0 opacity-100"
                          : "pointer-events-none max-w-0 translate-x-4 opacity-0",
                      )}
                    >
                      <div className="flex items-center gap-1">
                        {canDownloadPreview && slug !== undefined && preview1920 !== null ? (
                          <DownloadButton
                            bytes={preview1920.bytes}
                            className="h-8 border-0 bg-transparent px-3 text-white shadow-none hover:bg-white/15 hover:text-white"
                            kind="preview"
                            label="普通图"
                            mediaId={selected.id}
                            onSuccess={() => setDownloadMenuOpen(false)}
                            slug={slug}
                          />
                        ) : null}
                        {canDownloadOriginal &&
                        slug !== undefined &&
                        selected.downloads.originalBytes !== null ? (
                          <DownloadButton
                            bytes={selected.downloads.originalBytes}
                            className="h-8 border-0 bg-transparent px-3 text-white shadow-none hover:bg-white/15 hover:text-white"
                            kind="original"
                            label="原图"
                            mediaId={selected.id}
                            onSuccess={() => setDownloadMenuOpen(false)}
                            slug={slug}
                          />
                        ) : null}
                        <Button
                          aria-label="收起下载选项"
                          className="size-8 shrink-0 rounded-lg text-white hover:bg-white/15 hover:text-white"
                          onClick={() => setDownloadMenuOpen(false)}
                          size="icon-sm"
                          title="收起下载选项"
                          type="button"
                          variant="ghost"
                        >
                          <XIcon />
                        </Button>
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
