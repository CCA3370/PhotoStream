"use client";

import type { PublicMediaView } from "@photostream/contracts";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  Maximize2Icon,
  Minimize2Icon,
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
import { PhotoLikeButton, type PhotoLikeState } from "@/components/gallery/photo-like-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const minZoom = 1;
const maxZoom = 5;
const toolbarButtonClass =
  "h-9 rounded-xl border-white/10 bg-white/[0.07] px-3 text-white shadow-none backdrop-blur-md hover:border-white/20 hover:bg-white/[0.13] hover:text-white active:not-aria-[haspopup]:translate-y-0";

type Point = { x: number; y: number };
type Gesture =
  | { mode: "idle" }
  | { mode: "pan"; start: Point; origin: Point }
  | { mode: "swipe"; start: Point }
  | { mode: "pinch"; distance: number; zoom: number };

function variant(media: PublicMediaView, kind: "photo_960" | "photo_1920") {
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
  likeStates,
  selectedId,
  slug,
  onClose,
  onLikeChange,
  onSelect,
}: Readonly<{
  items: readonly PublicMediaView[];
  likeStates: ReadonlyMap<string, PhotoLikeState>;
  selectedId: string | null;
  slug?: string;
  onClose: () => void;
  onLikeChange: (state: PhotoLikeState) => void;
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
      return {
        x: clamp(next.x, -Math.max(0, (renderedWidth - rect.width) / 2), Math.max(0, (renderedWidth - rect.width) / 2)),
        y: clamp(next.y, -Math.max(0, (renderedHeight - rect.height) / 2), Math.max(0, (renderedHeight - rect.height) / 2)),
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
      if (Math.abs(deltaX) >= 52 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
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
  const selectedLikeState = likeStates.get(selected.id) ?? null;
  const imageTransform = `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="dark public-theme inset-0 top-0 left-0 h-dvh w-screen max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none bg-black p-0 text-white ring-0 sm:max-w-none"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">照片查看器</DialogTitle>
        <DialogDescription className="sr-only">
          左右滑动或使用方向键切换照片；双指、双击、滚轮或键盘加减键可以缩放。
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
              <div className="absolute inset-0 grid place-items-center text-sm text-white/55">
                正在加载高清图片…
              </div>
            ) : null}
            <div className="absolute inset-0 origin-center will-change-transform" style={{ transform: imageTransform }}>
              <Image
                alt="活动照片"
                className={cn("object-contain transition-opacity duration-150", loaded ? "opacity-100" : "opacity-0")}
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

          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-end bg-gradient-to-b from-black/65 via-black/15 to-transparent p-2.5 pb-14 sm:p-4 sm:pb-16">
            <div className="pointer-events-auto flex items-center gap-1.5">
              {fullscreenSupported ? (
                <Button
                  aria-label={fullscreen ? "退出全屏" : "进入全屏"}
                  className="size-9 rounded-full border-white/10 bg-black/30 text-white backdrop-blur-md hover:bg-white/15 hover:text-white sm:size-10"
                  onClick={() => void toggleFullscreen()}
                  size="icon"
                  title={fullscreen ? "退出全屏 (F)" : "全屏 (F)"}
                  type="button"
                  variant="outline"
                >
                  {fullscreen ? <Minimize2Icon /> : <Maximize2Icon />}
                </Button>
              ) : null}
              <Button
                aria-label="关闭照片查看器"
                className="size-9 rounded-full border-white/10 bg-black/30 text-white backdrop-blur-md hover:bg-white/15 hover:text-white sm:size-10"
                onClick={onClose}
                size="icon"
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
                className="absolute top-1/2 left-3 z-20 hidden size-10 -translate-y-1/2 rounded-full border-white/10 bg-black/25 text-white backdrop-blur-md hover:bg-white/15 hover:text-white sm:flex"
                onClick={() => selectOffset(-1)}
                size="icon"
                title="上一张 (←)"
                type="button"
                variant="outline"
              >
                <ChevronLeftIcon className="size-5" />
              </Button>
              <Button
                aria-label="下一张照片"
                className="absolute top-1/2 right-3 z-20 hidden size-10 -translate-y-1/2 rounded-full border-white/10 bg-black/25 text-white backdrop-blur-md hover:bg-white/15 hover:text-white sm:flex"
                onClick={() => selectOffset(1)}
                size="icon"
                title="下一张 (→)"
                type="button"
                variant="outline"
              >
                <ChevronRightIcon className="size-5" />
              </Button>
            </>
          ) : null}

          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/80 via-black/35 to-transparent px-2.5 pt-16 pb-[max(0.65rem,env(safe-area-inset-bottom))] sm:px-4 sm:pt-20">
            <div className="pointer-events-auto mx-auto flex max-w-5xl items-end justify-between gap-3">
              <div className="hidden shrink-0 text-[11px] text-white/55 sm:block">
                {selected.width} × {selected.height} · {Math.round(zoom * 100)}%
              </div>

              <div className="ml-auto flex min-w-0 max-w-full items-center justify-end gap-1.5 rounded-2xl border border-white/10 bg-black/30 p-1.5 shadow-xl shadow-black/20 backdrop-blur-xl">
                {slug === undefined ? null : (
                  <PhotoLikeButton
                    mediaId={selected.id}
                    mode="toolbar"
                    onChange={onLikeChange}
                    slug={slug}
                    state={selectedLikeState}
                  />
                )}

                {canDownload ? (
                  downloadMenuOpen ? (
                    <div className="flex min-w-0 items-center gap-1.5">
                      {canDownloadPreview && slug !== undefined && preview1920 !== null ? (
                        <DownloadButton
                          bytes={preview1920.bytes}
                          className={cn(toolbarButtonClass, "min-w-0 px-2.5 text-xs")}
                          kind="preview"
                          label="普通图"
                          mediaId={selected.id}
                          onSuccess={() => setDownloadMenuOpen(false)}
                          showBytes={false}
                          slug={slug}
                        />
                      ) : null}
                      {canDownloadOriginal && slug !== undefined && selected.downloads.originalBytes !== null ? (
                        <DownloadButton
                          bytes={selected.downloads.originalBytes}
                          className={cn(toolbarButtonClass, "min-w-0 px-2.5 text-xs")}
                          kind="original"
                          label="原图"
                          mediaId={selected.id}
                          onSuccess={() => setDownloadMenuOpen(false)}
                          showBytes={false}
                          slug={slug}
                        />
                      ) : null}
                      <Button
                        aria-label="收起下载选项"
                        className="size-9 shrink-0 rounded-xl border-white/10 bg-white/[0.07] text-white hover:bg-white/[0.13] hover:text-white"
                        onClick={() => setDownloadMenuOpen(false)}
                        size="icon"
                        type="button"
                        variant="outline"
                      >
                        <XIcon />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      className={toolbarButtonClass}
                      onClick={() => setDownloadMenuOpen(true)}
                      type="button"
                      variant="outline"
                    >
                      <DownloadIcon data-icon="inline-start" />
                      下载
                    </Button>
                  )
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
