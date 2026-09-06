"use client";

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  EyeIcon,
  EyeOffIcon,
  ImageIcon,
  LoaderCircleIcon,
  Maximize2Icon,
  Minimize2Icon,
  MinusIcon,
  PlusIcon,
  RotateCcwIcon,
  SendIcon,
  StarIcon,
  Trash2Icon,
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

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const minZoom = 1;
const maxZoom = 5;
const toolbarButtonClass =
  "rounded-lg border-white/10 bg-white/[0.06] text-white shadow-none backdrop-blur-md transition-colors hover:border-white/20 hover:bg-white/[0.12] hover:text-white active:not-aria-[haspopup]:translate-y-0 disabled:border-white/5 disabled:bg-white/[0.03] disabled:text-white/35";

type Point = { x: number; y: number };
type Gesture =
  | { mode: "idle" }
  | { mode: "pan"; start: Point; origin: Point }
  | { mode: "swipe"; start: Point }
  | { mode: "pinch"; distance: number; zoom: number };

export type ReviewPendingAction = "delete" | "featured" | "state";

export interface ReviewLightboxItem {
  readonly key: string;
  readonly src: string | null;
  readonly fallbackSrc: string | null;
  readonly originalSrc: string | null;
  readonly localPreferred: boolean;
  readonly width: number;
  readonly height: number;
  readonly featured: boolean;
  readonly publicationStatus: string;
  readonly canDelete: boolean;
  readonly pendingAction: ReviewPendingAction | null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function distance(points: readonly Point[]): number {
  const [first, second] = points;
  if (first === undefined || second === undefined) return 0;
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function stateLabel(status: string): string {
  if (status === "published") return "隐藏";
  if (status === "hidden") return "显示";
  return "发布";
}

export function ReviewLightbox({
  items,
  selectedKey,
  onClose,
  onDelete,
  onSelect,
  onStateAction,
  onToggleFeatured,
  onToggleVisibility,
}: Readonly<{
  items: readonly ReviewLightboxItem[];
  selectedKey: string | null;
  onClose: () => void;
  onDelete: (key: string) => void;
  onSelect: (key: string) => void;
  onStateAction: (key: string) => void;
  onToggleFeatured: (key: string) => void;
  onToggleVisibility: (key: string) => void;
}>) {
  const selectedIndex =
    selectedKey === null ? -1 : items.findIndex((item) => item.key === selectedKey);
  const selected = selectedIndex < 0 ? null : (items[selectedIndex] ?? null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef(new Map<number, Point>());
  const gestureRef = useRef<Gesture>({ mode: "idle" });
  const deleteTapRef = useRef<{ readonly key: string; readonly at: number } | null>(null);
  const spaceTapRef = useRef<{ readonly key: string; readonly at: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [displaySrc, setDisplaySrc] = useState<string | null>(null);
  const [sourceFailed, setSourceFailed] = useState(false);
  const [showingOriginal, setShowingOriginal] = useState(false);
  const [originalFailed, setOriginalFailed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenSupported, setFullscreenSupported] = useState(false);

  const clampPan = useCallback(
    (next: Point, nextZoom: number): Point => {
      const stage = stageRef.current;
      if (stage === null || selected === null || nextZoom <= 1) return { x: 0, y: 0 };
      const rect = stage.getBoundingClientRect();
      const fit = Math.min(rect.width / selected.width, rect.height / selected.height);
      const renderedWidth = selected.width * fit * nextZoom;
      const renderedHeight = selected.height * fit * nextZoom;
      return {
        x: clamp(
          next.x,
          -Math.max(0, (renderedWidth - rect.width) / 2),
          Math.max(0, (renderedWidth - rect.width) / 2),
        ),
        y: clamp(
          next.y,
          -Math.max(0, (renderedHeight - rect.height) / 2),
          Math.max(0, (renderedHeight - rect.height) / 2),
        ),
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
      if (item !== undefined) onSelect(item.key);
    },
    [items, onSelect, selectedIndex],
  );

  const toggleFullscreen = useCallback(async () => {
    const viewer = viewerRef.current;
    if (!document.fullscreenEnabled || viewer === null) return;
    if (document.fullscreenElement === null) await viewer.requestFullscreen();
    else await document.exitFullscreen();
  }, []);

  const loadRemoteOriginal = useCallback(() => {
    if (selected?.originalSrc === null || selected?.originalSrc === undefined) return;
    setDisplaySrc(selected.originalSrc);
    setShowingOriginal(true);
    setOriginalFailed(false);
    setLoaded(false);
    setLoadFailed(false);
    resetView();
  }, [resetView, selected]);

  useEffect(() => {
    setDisplaySrc(selected?.src ?? null);
    setLoaded(false);
    setLoadFailed(false);
    setSourceFailed(false);
    setShowingOriginal(false);
    setOriginalFailed(false);
    resetView();
    pointersRef.current.clear();
    gestureRef.current = { mode: "idle" };
    deleteTapRef.current = null;
    spaceTapRef.current = null;
  }, [resetView, selected?.src]);

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
      if (item?.src !== null && item?.src !== undefined) {
        const image = document.createElement("img");
        image.src = item.src;
      }
    }
  }, [items, selectedIndex]);

  useEffect(() => {
    if (selected === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopPropagation();
        selectOffset(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
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
      } else if (event.code === "Space") {
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat || selected.pendingAction !== null) return;
        if (selected.publicationStatus === "published" || selected.publicationStatus === "hidden") {
          spaceTapRef.current = null;
          onToggleVisibility(selected.key);
          return;
        }
        const now = Date.now();
        if (spaceTapRef.current?.key === selected.key && now - spaceTapRef.current.at <= 700) {
          spaceTapRef.current = null;
          onStateAction(selected.key);
        } else {
          spaceTapRef.current = { key: selected.key, at: now };
        }
      } else if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        if (selected.pendingAction === null) onToggleFeatured(selected.key);
      } else if (event.key === "Delete" && selected.canDelete) {
        event.preventDefault();
        if (selected.pendingAction !== null) return;
        const now = Date.now();
        if (deleteTapRef.current?.key === selected.key && now - deleteTapRef.current.at <= 900) {
          deleteTapRef.current = null;
          onDelete(selected.key);
        } else {
          deleteTapRef.current = { key: selected.key, at: now };
        }
      } else if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    changeZoom,
    fullscreenSupported,
    onClose,
    onDelete,
    onStateAction,
    onToggleFeatured,
    onToggleVisibility,
    resetView,
    selectOffset,
    selected,
    toggleFullscreen,
    zoom,
  ]);

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

  function onImageError(): void {
    if (selected === null) return;
    setLoaded(false);
    if (showingOriginal) {
      setOriginalFailed(true);
      setShowingOriginal(false);
      if (selected.fallbackSrc !== null && displaySrc !== selected.fallbackSrc) {
        setDisplaySrc(selected.fallbackSrc);
        setLoadFailed(false);
        return;
      }
      setLoadFailed(true);
      return;
    }
    if (selected.localPreferred) setSourceFailed(true);
    if (selected.fallbackSrc !== null && displaySrc !== selected.fallbackSrc) {
      setDisplaySrc(selected.fallbackSrc);
      setLoadFailed(false);
      return;
    }
    setLoadFailed(true);
  }

  if (selected === null) return null;

  const published = selected.publicationStatus === "published";
  const hidden = selected.publicationStatus === "hidden";
  const busy = selected.pendingAction !== null;
  const canNavigate = items.length > 1;
  const canLoadOriginal =
    selected.originalSrc !== null &&
    displaySrc !== selected.originalSrc &&
    !originalFailed &&
    (!selected.localPreferred || sourceFailed);
  const imageTransform = `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="dark inset-0 left-0 top-0 h-dvh w-screen max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none bg-black p-0 text-white ring-0 sm:max-w-none"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">审核图片查看器</DialogTitle>
        <DialogDescription className="sr-only">
          左右键切换，滚轮、双击或加减键缩放，拖动查看；已发布照片空格切换显示状态，未发布照片连续两次空格发布，回车切换精选，连续两次
          Delete 删除。
        </DialogDescription>

        <div className="relative h-full w-full overflow-hidden bg-black" ref={viewerRef}>
          <div
            aria-label="审核图片画布"
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
            {displaySrc === null ? (
              <div className="absolute inset-0 grid place-items-center text-sm text-white/60">
                暂无可预览图片
              </div>
            ) : (
              <>
                {!loaded && !loadFailed ? (
                  <div className="absolute inset-0 grid place-items-center text-sm text-white/60">
                    {showingOriginal ? "正在加载原图…" : "正在加载图片…"}
                  </div>
                ) : null}
                {loadFailed ? (
                  <div className="absolute inset-0 grid place-items-center text-sm text-white/60">
                    图片加载失败
                  </div>
                ) : null}
                <div
                  className="absolute inset-0 origin-center will-change-transform"
                  style={{ transform: imageTransform }}
                >
                  <Image
                    alt="审核图片"
                    className={cn(
                      "object-contain transition-opacity duration-150",
                      loaded ? "opacity-100" : "opacity-0",
                    )}
                    draggable={false}
                    fill
                    key={displaySrc}
                    onError={onImageError}
                    onLoad={() => {
                      setLoaded(true);
                      setLoadFailed(false);
                    }}
                    priority
                    sizes="100vw"
                    src={displaySrc}
                    unoptimized
                  />
                </div>
              </>
            )}
          </div>

          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between bg-gradient-to-b from-black/70 via-black/20 to-transparent p-3 pb-14 sm:p-4 sm:pb-16">
            <div className="text-xs text-white/65">
              {selectedIndex + 1} / {items.length}
            </div>
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
                aria-label="关闭审核图片查看器"
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
                className="absolute left-2 top-1/2 z-20 size-10 -translate-y-1/2 rounded-full border-white/15 bg-black/35 text-white backdrop-blur-md hover:bg-white/15 hover:text-white sm:left-4 sm:size-11"
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
                className="absolute right-2 top-1/2 z-20 size-10 -translate-y-1/2 rounded-full border-white/15 bg-black/35 text-white backdrop-blur-md hover:bg-white/15 hover:text-white sm:right-4 sm:size-11"
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

          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/80 via-black/35 to-transparent px-3 pt-16 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4 sm:pt-20">
            <div className="pointer-events-auto mx-auto flex max-w-6xl flex-col gap-2.5 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex items-center gap-2 text-[11px] text-white/60 sm:text-xs">
                <span>
                  {selected.width} × {selected.height}
                </span>
                <span aria-hidden="true">·</span>
                <span>{Math.round(zoom * 100)}%</span>
              </div>

              <div className="flex max-w-full flex-wrap items-center gap-1.5 rounded-2xl border border-white/10 bg-black/35 p-1.5 shadow-lg shadow-black/20 backdrop-blur-xl">
                <Button
                  aria-label="缩小"
                  className={cn(toolbarButtonClass, "size-8")}
                  disabled={zoom <= minZoom}
                  onClick={() => changeZoom(zoom - 0.5)}
                  size="icon-sm"
                  title="缩小 (-)"
                  type="button"
                  variant="outline"
                >
                  <MinusIcon />
                </Button>
                <Button
                  aria-label="恢复适应屏幕"
                  className={cn(toolbarButtonClass, "h-8 px-2.5")}
                  disabled={zoom === 1 && pan.x === 0 && pan.y === 0}
                  onClick={resetView}
                  size="sm"
                  title="适应屏幕 (0)"
                  type="button"
                  variant="outline"
                >
                  <RotateCcwIcon />
                  适应
                </Button>
                <Button
                  aria-label="放大"
                  className={cn(toolbarButtonClass, "size-8")}
                  disabled={zoom >= maxZoom}
                  onClick={() => changeZoom(zoom + 0.5)}
                  size="icon-sm"
                  title="放大 (+)"
                  type="button"
                  variant="outline"
                >
                  <PlusIcon />
                </Button>

                {canLoadOriginal ? (
                  <Button
                    aria-label="查看原图"
                    className={cn(toolbarButtonClass, "h-8 px-2.5")}
                    onClick={loadRemoteOriginal}
                    size="sm"
                    title="从 CDN 加载原图"
                    type="button"
                    variant="outline"
                  >
                    <ImageIcon />
                    查看原图
                  </Button>
                ) : null}

                <div className="mx-0.5 h-5 w-px bg-white/10" />

                <Button
                  aria-label={selected.featured ? "取消精选" : "设为精选"}
                  className={cn(
                    toolbarButtonClass,
                    "size-8",
                    selected.featured && "text-amber-400 hover:text-amber-300",
                  )}
                  disabled={busy}
                  onClick={() => onToggleFeatured(selected.key)}
                  size="icon-sm"
                  title={selected.featured ? "取消精选 (Enter)" : "精选 (Enter)"}
                  type="button"
                  variant="outline"
                >
                  {selected.pendingAction === "featured" ? (
                    <LoaderCircleIcon className="animate-spin" />
                  ) : (
                    <StarIcon className={cn(selected.featured && "fill-current")} />
                  )}
                </Button>
                <Button
                  aria-label={stateLabel(selected.publicationStatus)}
                  className={cn(
                    toolbarButtonClass,
                    "size-8",
                    published &&
                      "border-blue-600 bg-blue-600 text-white hover:border-blue-700 hover:bg-blue-700 hover:text-white",
                  )}
                  disabled={busy}
                  onClick={() => onStateAction(selected.key)}
                  size="icon-sm"
                  style={
                    hidden
                      ? {
                          backgroundColor: "rgba(255, 255, 255, 0.06)",
                          borderColor: "rgba(255, 255, 255, 0.1)",
                          color: "white",
                        }
                      : undefined
                  }
                  title={
                    published ? "隐藏 (Space)" : hidden ? "显示 (Space)" : "发布（双击 Space）"
                  }
                  type="button"
                  variant="outline"
                >
                  {selected.pendingAction === "state" ? (
                    <LoaderCircleIcon className="animate-spin" />
                  ) : published ? (
                    <EyeIcon />
                  ) : hidden ? (
                    <EyeOffIcon />
                  ) : (
                    <SendIcon />
                  )}
                </Button>
                <Button
                  aria-label="删除"
                  className="size-8 rounded-lg border-red-400/20 bg-red-500/25 text-red-100 shadow-none backdrop-blur-md hover:border-red-400/35 hover:bg-red-500/40 hover:text-white disabled:border-white/5 disabled:bg-white/[0.03] disabled:text-white/35"
                  disabled={busy || !selected.canDelete}
                  onClick={() => onDelete(selected.key)}
                  size="icon-sm"
                  title={selected.canDelete ? "删除（键盘连续按两次 Delete）" : "仅管理员可删除"}
                  type="button"
                  variant="outline"
                >
                  {selected.pendingAction === "delete" ? (
                    <LoaderCircleIcon className="animate-spin" />
                  ) : (
                    <Trash2Icon />
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
