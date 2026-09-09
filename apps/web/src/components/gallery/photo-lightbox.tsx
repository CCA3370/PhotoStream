"use client";

import type { PublicMediaView } from "@photostream/contracts";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  ImageIcon,
  LoaderCircleIcon,
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

import { CachedPhotoImage } from "@/components/gallery/cached-photo-image";
import { DownloadButton } from "@/components/gallery/download-button";
import { PhotoLikeButton, type PhotoLikeState } from "@/components/gallery/photo-like-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { publicMutation } from "@/lib/client-api";
import { isWarmDerivedImageDecoded, loadDerivedImage } from "@/lib/derived-image-cache";
import { readCachedOriginalImage, writeCachedOriginalImage } from "@/lib/original-image-cache";
import { cn } from "@/lib/utils";

const minZoom = 1;
const maxZoom = 5;
const swipeSettleMs = 180;
const neighborScale = 0.93;
const toolbarButtonClass =
  "h-11 rounded-xl border-white/10 bg-white/[0.07] px-3 text-white shadow-none backdrop-blur-md transition-[transform,background-color,border-color] duration-150 hover:border-white/20 hover:bg-white/[0.13] hover:text-white active:not-aria-[haspopup]:translate-y-0 active:scale-[0.97] sm:h-9 motion-reduce:transform-none motion-reduce:transition-none";

type Point = { x: number; y: number };
type Gesture =
  | { mode: "idle" }
  | { mode: "pan"; start: Point; origin: Point }
  | { mode: "swipe"; start: Point }
  | { mode: "pinch"; distance: number; zoom: number };

interface SignedOriginal {
  readonly url: string;
  readonly filename: string;
  readonly bytes: number;
  readonly expiresAt: string;
}

function variant(media: PublicMediaView, kind: "photo_960" | "photo_1920") {
  return media.variants.find((candidate) => candidate.kind === kind) ?? null;
}

function displayVariant(media: PublicMediaView) {
  return variant(media, "photo_1920") ?? variant(media, "photo_960");
}

function distance(points: readonly Point[]): number {
  const [first, second] = points;
  if (first === undefined || second === undefined) return 0;
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function fittedImageWidth(media: PublicMediaView): string {
  return `min(100%, calc(100dvh * ${media.width / media.height}))`;
}

function slideScale(side: -1 | 0 | 1, offset: number, width: number): number {
  if (width <= 0) return side === 0 ? 1 : neighborScale;
  const centerDistance = Math.min(1, Math.abs(side * width + offset) / width);
  return 1 - (1 - neighborScale) * centerDistance;
}

async function decodeObjectUrl(url: string): Promise<void> {
  if (typeof window === "undefined") return;
  const decoder = new window.Image();
  decoder.decoding = "async";
  decoder.src = url;
  if (typeof decoder.decode === "function") {
    await decoder.decode().catch(() => undefined);
    return;
  }
  await new Promise<void>((resolve) => {
    decoder.onload = () => resolve();
    decoder.onerror = () => resolve();
  });
}

function NeighborSlide({
  media,
  offset,
  scale,
  slug,
}: Readonly<{
  media: PublicMediaView | null;
  offset: number;
  scale: number;
  slug?: string | undefined;
}>) {
  if (media === null) return null;
  const source = displayVariant(media);
  if (source === null) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 will-change-transform"
      style={{ transform: `translate3d(${offset}px, 0, 0) scale(${scale})` }}
    >
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ aspectRatio: `${media.width} / ${media.height}`, width: fittedImageWidth(media) }}
      >
        <CachedPhotoImage
          alt=""
          bytes={source.bytes}
          className="object-contain"
          draggable={false}
          kind={source.kind === "photo_1920" ? "photo_1920" : "photo_960"}
          mediaId={media.id}
          priority
          scope={slug ?? "public-media"}
          sizes="100vw"
          sourceUrl={source.url}
        />
      </div>
    </div>
  );
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
  const large = selected === null ? null : displayVariant(selected);
  const previous =
    selectedIndex < 0 || items.length < 2
      ? null
      : (items[(selectedIndex - 1 + items.length) % items.length] ?? null);
  const next =
    selectedIndex < 0 || items.length < 2
      ? null
      : (items[(selectedIndex + 1) % items.length] ?? null);
  const preview1920 = selected === null ? null : variant(selected, "photo_1920");
  const viewerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef(new Map<number, Point>());
  const gestureRef = useRef<Gesture>({ mode: "idle" });
  const swipeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsEntranceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewerOpenRef = useRef(false);
  const originalObjectUrlRef = useRef<string | null>(null);
  const originalRequestRef = useRef(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [swipeSettling, setSwipeSettling] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenSupported, setFullscreenSupported] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(false);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [originalPending, setOriginalPending] = useState(false);
  const [originalCacheChecking, setOriginalCacheChecking] = useState(false);

  const clearControlsHideTimer = useCallback(() => {
    if (controlsHideTimerRef.current === null) return;
    clearTimeout(controlsHideTimerRef.current);
    controlsHideTimerRef.current = null;
  }, []);

  const scheduleControlsHide = useCallback(() => {
    clearControlsHideTimer();
    if (!fullscreen || downloadMenuOpen) return;
    controlsHideTimerRef.current = setTimeout(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.closest("[data-lightbox-controls]")) {
        controlsHideTimerRef.current = null;
        return;
      }
      setControlsVisible(false);
      controlsHideTimerRef.current = null;
    }, 2_500);
  }, [clearControlsHideTimer, downloadMenuOpen, fullscreen]);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    scheduleControlsHide();
  }, [scheduleControlsHide]);

  const clampPan = useCallback(
    (value: Point, nextZoom: number): Point => {
      const stage = stageRef.current;
      if (stage === null || selected === null || nextZoom <= 1) return { x: 0, y: 0 };
      const rect = stage.getBoundingClientRect();
      const fit = Math.min(rect.width / selected.width, rect.height / selected.height);
      const renderedWidth = selected.width * fit * nextZoom;
      const renderedHeight = selected.height * fit * nextZoom;
      return {
        x: clamp(
          value.x,
          -Math.max(0, (renderedWidth - rect.width) / 2),
          Math.max(0, (renderedWidth - rect.width) / 2),
        ),
        y: clamp(
          value.y,
          -Math.max(0, (renderedHeight - rect.height) / 2),
          Math.max(0, (renderedHeight - rect.height) / 2),
        ),
      };
    },
    [selected],
  );

  const changeZoom = useCallback(
    (value: number) => {
      const nextZoom = clamp(value, minZoom, maxZoom);
      setZoom(nextZoom);
      setPan((current) => clampPan(current, nextZoom));
    },
    [clampPan],
  );

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const commitOffset = useCallback(
    (offset: number) => {
      if (items.length < 2 || selectedIndex < 0) return;
      const index = (selectedIndex + offset + items.length) % items.length;
      const item = items[index];
      if (item !== undefined) onSelect(item.id);
    },
    [items, onSelect, selectedIndex],
  );

  const animateOffset = useCallback(
    (offset: -1 | 1) => {
      if (items.length < 2 || selectedIndex < 0 || swipeSettling) return;
      const width = stageRef.current?.clientWidth ?? window.innerWidth;
      setSwipeSettling(true);
      setSwipeOffset(offset > 0 ? -width : width);
      if (swipeTimerRef.current !== null) clearTimeout(swipeTimerRef.current);
      swipeTimerRef.current = setTimeout(() => {
        swipeTimerRef.current = null;
        setSwipeSettling(false);
        setSwipeOffset(0);
        commitOffset(offset);
      }, swipeSettleMs);
    },
    [commitOffset, items.length, selectedIndex, swipeSettling],
  );

  const toggleFullscreen = useCallback(async () => {
    const viewer = viewerRef.current;
    if (!document.fullscreenEnabled || viewer === null) return;
    if (document.fullscreenElement === null) await viewer.requestFullscreen();
    else await document.exitFullscreen();
  }, []);

  useEffect(() => {
    if (selectedId === null) {
      viewerOpenRef.current = false;
      setControlsVisible(false);
      if (controlsEntranceTimerRef.current !== null) {
        clearTimeout(controlsEntranceTimerRef.current);
        controlsEntranceTimerRef.current = null;
      }
      clearControlsHideTimer();
      return;
    }
    if (viewerOpenRef.current) return;
    viewerOpenRef.current = true;
    setControlsVisible(false);
    if (controlsEntranceTimerRef.current !== null) clearTimeout(controlsEntranceTimerRef.current);
    controlsEntranceTimerRef.current = setTimeout(() => {
      setControlsVisible(true);
      controlsEntranceTimerRef.current = null;
    }, 110);
  }, [clearControlsHideTimer, selectedId]);

  useEffect(() => {
    if (selectedId === null || selected === null || large === null) return;
    originalRequestRef.current += 1;
    if (originalObjectUrlRef.current !== null) {
      URL.revokeObjectURL(originalObjectUrlRef.current);
      originalObjectUrlRef.current = null;
    }
    setLoaded(
      isWarmDerivedImageDecoded({
        scope: slug ?? "public-media",
        mediaId: selected.id,
        kind: large.kind === "photo_1920" ? "photo_1920" : "photo_960",
        bytes: large.bytes,
      }),
    );
    setDownloadMenuOpen(false);
    setOriginalUrl(null);
    setOriginalPending(false);
    setOriginalCacheChecking(false);
    resetView();
    pointersRef.current.clear();
    gestureRef.current = { mode: "idle" };
    if (swipeTimerRef.current !== null) {
      clearTimeout(swipeTimerRef.current);
      swipeTimerRef.current = null;
    }
    setSwipeSettling(false);
    setSwipeOffset(0);
  }, [large, resetView, selected, selectedId, slug]);

  useEffect(() => {
    if (slug === undefined || selected === null || !selected.downloads.original) return;
    let cancelled = false;
    const mediaId = selected.id;
    const expectedBytes = selected.downloads.originalBytes;
    setOriginalCacheChecking(true);

    void readCachedOriginalImage(slug, mediaId, expectedBytes)
      .then(async (blob) => {
        if (cancelled || blob === null) return;
        const objectUrl = URL.createObjectURL(blob);
        await decodeObjectUrl(objectUrl);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        if (originalObjectUrlRef.current !== null) {
          URL.revokeObjectURL(originalObjectUrlRef.current);
        }
        originalObjectUrlRef.current = objectUrl;
        setOriginalUrl(objectUrl);
        setLoaded(true);
      })
      .finally(() => {
        if (!cancelled) setOriginalCacheChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selected, slug]);

  useEffect(
    () => () => {
      if (swipeTimerRef.current !== null) clearTimeout(swipeTimerRef.current);
      if (controlsEntranceTimerRef.current !== null) clearTimeout(controlsEntranceTimerRef.current);
      clearControlsHideTimer();
      if (originalObjectUrlRef.current !== null) {
        URL.revokeObjectURL(originalObjectUrlRef.current);
        originalObjectUrlRef.current = null;
      }
    },
    [clearControlsHideTimer],
  );

  useEffect(() => {
    setFullscreenSupported(document.fullscreenEnabled);
    const update = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  useEffect(() => {
    if (!fullscreen) {
      clearControlsHideTimer();
      if (viewerOpenRef.current) setControlsVisible(true);
      return;
    }
    revealControls();
  }, [clearControlsHideTimer, fullscreen, revealControls]);

  useEffect(() => {
    if (!fullscreen) return;
    if (downloadMenuOpen) {
      clearControlsHideTimer();
      setControlsVisible(true);
      return;
    }
    scheduleControlsHide();
  }, [clearControlsHideTimer, downloadMenuOpen, fullscreen, scheduleControlsHide]);

  useEffect(() => {
    if (selectedIndex < 0 || items.length < 2) return;
    for (const item of [previous, next]) {
      if (item === null) continue;
      const source = displayVariant(item);
      if (source === null) continue;
      void loadDerivedImage({
        scope: slug ?? "public-media",
        mediaId: item.id,
        kind: source.kind === "photo_1920" ? "photo_1920" : "photo_960",
        bytes: source.bytes,
        sourceUrl: source.url,
      }).catch(() => undefined);
    }
  }, [items.length, next, previous, selectedIndex, slug]);

  useEffect(() => {
    if (selected === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      revealControls();
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        animateOffset(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        animateOffset(1);
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
  }, [
    animateOffset,
    changeZoom,
    fullscreenSupported,
    resetView,
    revealControls,
    selected,
    toggleFullscreen,
    zoom,
  ]);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (swipeSettling) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = { x: event.clientX, y: event.clientY };
    pointersRef.current.set(event.pointerId, point);
    const points = [...pointersRef.current.values()];
    if (points.length >= 2) {
      gestureRef.current = { mode: "pinch", distance: distance(points), zoom };
      setDragging(false);
      setSwipeOffset(0);
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
      const nextZoom = clamp(gesture.zoom * (distance(points) / gesture.distance), minZoom, maxZoom);
      setZoom(nextZoom);
      setPan((current) => clampPan(current, nextZoom));
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
      return;
    }
    if (gesture.mode === "swipe" && points.length === 1) {
      const width = stageRef.current?.clientWidth ?? window.innerWidth;
      const deltaX = point.x - gesture.start.x;
      setSwipeOffset(clamp(deltaX, -width, width));
    }
  }

  function finishPointer(event: ReactPointerEvent<HTMLDivElement>): void {
    const point = { x: event.clientX, y: event.clientY };
    const gesture = gestureRef.current;
    if (gesture.mode === "swipe") {
      const deltaX = point.x - gesture.start.x;
      const deltaY = point.y - gesture.start.y;
      const shouldNavigate = Math.abs(deltaX) >= 52 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2;
      if (shouldNavigate) {
        animateOffset(deltaX < 0 ? 1 : -1);
      } else {
        setSwipeSettling(true);
        setSwipeOffset(0);
        if (swipeTimerRef.current !== null) clearTimeout(swipeTimerRef.current);
        swipeTimerRef.current = setTimeout(() => {
          setSwipeSettling(false);
          swipeTimerRef.current = null;
        }, swipeSettleMs);
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

  async function loadOriginal(): Promise<void> {
    if (
      slug === undefined ||
      selected === null ||
      !selected.downloads.original ||
      originalPending ||
      originalCacheChecking ||
      originalUrl !== null
    ) {
      return;
    }

    const mediaId = selected.id;
    const expectedBytes = selected.downloads.originalBytes;
    const requestId = originalRequestRef.current + 1;
    originalRequestRef.current = requestId;
    setOriginalPending(true);

    try {
      const signed = await publicMutation<SignedOriginal>(
        `/api/v1/public/albums/${slug}/downloads/${mediaId}/original`,
        { idempotencyKey: crypto.randomUUID() },
      );
      const response = await fetch(signed.url, {
        cache: "no-store",
        credentials: "omit",
        mode: "cors",
      });
      if (!response.ok) throw new Error("原图加载失败，请稍后重试。");
      const blob = await response.blob();
      if (blob.size === 0) throw new Error("原图内容为空，请稍后重试。");

      await writeCachedOriginalImage(slug, mediaId, expectedBytes, blob);
      if (originalRequestRef.current !== requestId) return;

      const objectUrl = URL.createObjectURL(blob);
      await decodeObjectUrl(objectUrl);
      if (originalRequestRef.current !== requestId) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      if (originalObjectUrlRef.current !== null) {
        URL.revokeObjectURL(originalObjectUrlRef.current);
      }
      originalObjectUrlRef.current = objectUrl;
      setOriginalUrl(objectUrl);
      setLoaded(true);
      resetView();
    } catch (caught) {
      if (originalRequestRef.current !== requestId) return;
      toast.add({
        title: "原图加载失败",
        description: caught instanceof Error ? caught.message : "暂时无法加载原图，请稍后重试。",
        type: "error",
        timeout: 4_000,
      });
    } finally {
      if (originalRequestRef.current === requestId) setOriginalPending(false);
    }
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
  const stageWidth = stageRef.current?.clientWidth ?? (typeof window === "undefined" ? 1 : window.innerWidth);
  const previousOffset = -stageWidth + swipeOffset;
  const currentOffset = swipeOffset;
  const nextOffset = stageWidth + swipeOffset;
  const previousScale = slideScale(-1, swipeOffset, stageWidth);
  const currentScale = slideScale(0, swipeOffset, stageWidth);
  const nextScale = slideScale(1, swipeOffset, stageWidth);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="dark public-theme inset-0 top-0 left-0 h-dvh w-screen max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none bg-black p-0 text-white ring-0 duration-200 data-open:zoom-in-100 data-closed:zoom-out-100 data-closed:duration-150 sm:max-w-none motion-reduce:duration-0"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">照片查看器</DialogTitle>
        <DialogDescription className="sr-only">
          左右滑动或使用方向键切换照片；双指、双击、滚轮或键盘加减键可以缩放。
        </DialogDescription>

        <div
          className="relative h-full w-full overflow-hidden bg-black"
          onFocusCapture={() => revealControls()}
          onPointerDownCapture={() => revealControls()}
          onPointerMove={() => {
            if (fullscreen) revealControls();
          }}
          ref={viewerRef}
        >
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
            {!loaded && originalUrl === null ? (
              <div className="absolute inset-0 grid place-items-center text-sm text-white/55">
                <div className="flex items-center gap-2 animate-pulse motion-reduce:animate-none">
                  <LoaderCircleIcon
                    aria-hidden="true"
                    className="size-4 animate-spin motion-reduce:animate-none"
                  />
                  正在加载高清图片…
                </div>
              </div>
            ) : null}

            <div
              className={cn(
                "absolute inset-0",
                swipeSettling &&
                  "[&_[data-swipe-slide]]:transition-transform [&_[data-swipe-slide]]:duration-180 [&_[data-swipe-slide]]:ease-out motion-reduce:[&_[data-swipe-slide]]:transition-none",
              )}
            >
              <div data-swipe-slide>
                <NeighborSlide
                  media={previous}
                  offset={previousOffset}
                  scale={previousScale}
                  slug={slug}
                />
              </div>

              <div
                className="absolute inset-0 will-change-transform"
                data-swipe-slide
                style={{ transform: `translate3d(${currentOffset}px, 0, 0) scale(${currentScale})` }}
              >
                <div
                  className="absolute inset-0 origin-center will-change-transform"
                  style={{ transform: imageTransform }}
                >
                  <div
                    className="absolute top-1/2 left-1/2 origin-center -translate-x-1/2 -translate-y-1/2"
                    data-lightbox-transition-image
                    style={{
                      aspectRatio: `${selected.width} / ${selected.height}`,
                      width: fittedImageWidth(selected),
                    }}
                  >
                    {originalUrl === null ? (
                      <CachedPhotoImage
                        alt="活动照片"
                        bytes={large.bytes}
                        className={cn(
                          "object-contain transition-[opacity,filter] duration-160 ease-out motion-reduce:transition-none",
                          loaded ? "opacity-100 blur-0" : "opacity-0 blur-[1px]",
                        )}
                        draggable={false}
                        kind={large.kind === "photo_1920" ? "photo_1920" : "photo_960"}
                        mediaId={selected.id}
                        onLoad={() => setLoaded(true)}
                        priority
                        scope={slug ?? "public-media"}
                        sizes="100vw"
                        sourceUrl={large.url}
                      />
                    ) : (
                      <Image
                        alt="活动照片"
                        className="object-contain"
                        draggable={false}
                        fill
                        key={originalUrl}
                        priority
                        sizes="100vw"
                        src={originalUrl}
                        unoptimized
                      />
                    )}
                  </div>
                </div>
              </div>

              <div data-swipe-slide>
                <NeighborSlide media={next} offset={nextOffset} scale={nextScale} slug={slug} />
              </div>
            </div>
          </div>

          <div
            aria-hidden={!controlsVisible}
            className={cn(
              "pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-end bg-gradient-to-b from-black/65 via-black/15 to-transparent px-2.5 pt-[max(0.65rem,env(safe-area-inset-top))] pb-14 transition-[opacity,transform] duration-200 ease-out sm:p-4 sm:pb-16 motion-reduce:transition-none",
              controlsVisible
                ? "translate-y-0 opacity-100"
                : "pointer-events-none -translate-y-2 opacity-0",
            )}
            data-lightbox-controls
            inert={!controlsVisible}
          >
            <div className="pointer-events-auto flex items-center gap-1.5">
              {fullscreenSupported ? (
                <Button
                  aria-label={fullscreen ? "退出全屏" : "进入全屏"}
                  className="size-11 rounded-full border-white/10 bg-black/30 text-white backdrop-blur-md transition-[transform,background-color] duration-150 hover:bg-white/15 hover:text-white active:scale-[0.94] sm:size-10 motion-reduce:transform-none motion-reduce:transition-none"
                  onClick={() => void toggleFullscreen()}
                  size="icon"
                  title={fullscreen ? "退出全屏 (F)" : "全屏 (F)"}
                  type="button"
                  variant="outline"
                >
                  <span className="relative grid size-5 place-items-center">
                    <Maximize2Icon
                      className={cn(
                        "absolute size-5 transition-[opacity,transform] duration-150 motion-reduce:transition-none",
                        fullscreen ? "scale-75 opacity-0" : "scale-100 opacity-100",
                      )}
                    />
                    <Minimize2Icon
                      className={cn(
                        "absolute size-5 transition-[opacity,transform] duration-150 motion-reduce:transition-none",
                        fullscreen ? "scale-100 opacity-100" : "scale-75 opacity-0",
                      )}
                    />
                  </span>
                </Button>
              ) : null}
              <Button
                aria-label="关闭照片查看器"
                className="size-11 rounded-full border-white/10 bg-black/30 text-white backdrop-blur-md transition-[transform,background-color] duration-150 hover:bg-white/15 hover:text-white active:scale-[0.94] sm:size-10 motion-reduce:transform-none motion-reduce:transition-none"
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
                className={cn(
                  "absolute top-1/2 left-3 z-20 hidden size-11 -translate-y-1/2 rounded-full border-white/10 bg-black/25 text-white backdrop-blur-md transition-[transform,background-color,opacity] duration-200 hover:bg-white/15 hover:text-white active:scale-[0.94] md:flex motion-reduce:transition-none",
                  controlsVisible ? "opacity-100" : "pointer-events-none -translate-x-1 opacity-0",
                )}
                data-lightbox-controls
                inert={!controlsVisible}
                onClick={() => animateOffset(-1)}
                size="icon"
                title="上一张 (←)"
                type="button"
                variant="outline"
              >
                <ChevronLeftIcon className="size-5" />
              </Button>
              <Button
                aria-label="下一张照片"
                className={cn(
                  "absolute top-1/2 right-3 z-20 hidden size-11 -translate-y-1/2 rounded-full border-white/10 bg-black/25 text-white backdrop-blur-md transition-[transform,background-color,opacity] duration-200 hover:bg-white/15 hover:text-white active:scale-[0.94] md:flex motion-reduce:transition-none",
                  controlsVisible ? "opacity-100" : "pointer-events-none translate-x-1 opacity-0",
                )}
                data-lightbox-controls
                inert={!controlsVisible}
                onClick={() => animateOffset(1)}
                size="icon"
                title="下一张 (→)"
                type="button"
                variant="outline"
              >
                <ChevronRightIcon className="size-5" />
              </Button>
            </>
          ) : null}

          <div
            aria-hidden={!controlsVisible}
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/80 via-black/35 to-transparent px-2.5 pt-16 pb-[max(0.65rem,env(safe-area-inset-bottom))] transition-[opacity,transform] duration-200 ease-out sm:px-4 sm:pt-20 motion-reduce:transition-none",
              controlsVisible
                ? "translate-y-0 opacity-100"
                : "pointer-events-none translate-y-3 opacity-0",
            )}
            data-lightbox-controls
            inert={!controlsVisible}
          >
            <div className="pointer-events-auto mx-auto flex w-full max-w-5xl items-end justify-between gap-3">
              <div className="hidden shrink-0 text-[11px] text-white/55 sm:block">
                {selected.width} × {selected.height} · {Math.round(zoom * 100)}%
                {originalUrl === null ? null : " · 原图"}
              </div>

              <div className="ml-auto grid w-full min-w-0 items-center overflow-hidden rounded-2xl border border-white/10 bg-black/30 p-1.5 shadow-xl shadow-black/20 backdrop-blur-xl sm:w-auto sm:max-w-full">
                <div
                  aria-hidden={downloadMenuOpen}
                  inert={downloadMenuOpen}
                  className={cn(
                    "col-start-1 row-start-1 flex w-full origin-left items-center transition-[opacity,transform] ease-out sm:w-max motion-reduce:transition-none",
                    downloadMenuOpen
                      ? "pointer-events-none -translate-x-1 opacity-0 duration-100 delay-0"
                      : "translate-x-0 opacity-100 duration-150 delay-[70ms]",
                  )}
                >
                  <div className="flex w-full min-w-0 items-center gap-1.5 sm:w-auto">
                    {slug === undefined ? null : (
                      <PhotoLikeButton
                        className="shrink-0"
                        mediaId={selected.id}
                        mode="toolbar"
                        onChange={onLikeChange}
                        slug={slug}
                        state={selectedLikeState}
                      />
                    )}

                    {canDownloadOriginal ? (
                      <Button
                        className={cn(
                          toolbarButtonClass,
                          "min-w-0 flex-1 px-2.5 text-xs sm:flex-none sm:px-3 sm:text-sm",
                        )}
                        disabled={originalPending || originalCacheChecking || originalUrl !== null}
                        onClick={() => void loadOriginal()}
                        type="button"
                        variant="outline"
                      >
                        {originalPending ? (
                          <LoaderCircleIcon
                            aria-hidden="true"
                            className="animate-spin motion-reduce:animate-none"
                            data-icon="inline-start"
                          />
                        ) : (
                          <ImageIcon data-icon="inline-start" />
                        )}
                        <span className="truncate">
                          {originalPending
                            ? "加载中…"
                            : originalUrl === null
                              ? "查看原图"
                              : "已加载原图"}
                        </span>
                      </Button>
                    ) : null}

                    {canDownload ? (
                      <Button
                        className={cn(toolbarButtonClass, "min-w-0 flex-1 sm:flex-none")}
                        onClick={() => setDownloadMenuOpen(true)}
                        type="button"
                        variant="outline"
                      >
                        <DownloadIcon data-icon="inline-start" />
                        下载
                      </Button>
                    ) : null}
                  </div>
                </div>

                {canDownload ? (
                  <div
                    aria-hidden={!downloadMenuOpen}
                    inert={!downloadMenuOpen}
                    className={cn(
                      "col-start-1 row-start-1 flex w-full origin-right items-center justify-self-end transition-[opacity,transform] ease-out sm:w-max motion-reduce:transition-none",
                      downloadMenuOpen
                        ? "translate-x-0 opacity-100 duration-180 delay-[70ms]"
                        : "pointer-events-none translate-x-1 opacity-0 duration-100 delay-0",
                    )}
                  >
                    <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.75rem] items-center gap-1.5 sm:flex sm:w-auto">
                      {canDownloadPreview && slug !== undefined && preview1920 !== null ? (
                        <DownloadButton
                          bytes={preview1920.bytes}
                          className={cn(
                            toolbarButtonClass,
                            "w-full min-w-0 px-2 text-[11px] sm:w-auto sm:shrink-0 sm:px-2.5 sm:text-xs",
                          )}
                          kind="preview"
                          label="普通图"
                          mediaId={selected.id}
                          showIcon={false}
                          slug={slug}
                        />
                      ) : null}
                      {canDownloadOriginal &&
                      slug !== undefined &&
                      selected.downloads.originalBytes !== null ? (
                        <DownloadButton
                          bytes={selected.downloads.originalBytes}
                          className={cn(
                            toolbarButtonClass,
                            "w-full min-w-0 px-2 text-[11px] sm:w-auto sm:shrink-0 sm:px-2.5 sm:text-xs",
                          )}
                          kind="original"
                          label="原图"
                          mediaId={selected.id}
                          showIcon={false}
                          slug={slug}
                        />
                      ) : null}
                      <Button
                        aria-label="收起下载选项"
                        className="size-11 shrink-0 rounded-xl border-white/10 bg-white/[0.07] text-white transition-[transform,background-color] duration-150 hover:bg-white/[0.13] hover:text-white active:scale-[0.94] sm:size-9 motion-reduce:transform-none motion-reduce:transition-none"
                        onClick={() => setDownloadMenuOpen(false)}
                        size="icon"
                        title="关闭下载选项"
                        type="button"
                        variant="outline"
                      >
                        <XIcon />
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
