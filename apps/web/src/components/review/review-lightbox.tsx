"use client";

import type { BibMediaState } from "@photostream/contracts";
import {
  BadgeCheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EyeIcon,
  EyeOffIcon,
  ImageIcon,
  LoaderCircleIcon,
  Maximize2Icon,
  Minimize2Icon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  StarIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  BibReviewDialog,
  BibReviewEditor,
  isBibReviewConfirmed,
} from "@/components/bib/bib-review-editor";
import { InternalCachedImage } from "@/components/media/internal-cached-image";
import { PhotoBeforeAfterSlider } from "@/components/review/photo-before-after-slider";
import {
  PhotoEditorPanel,
  type PhotoEditorPreviewState,
} from "@/components/review/photo-editor-dialog";
import {
  ReviewInspector,
  type ReviewInspectorCategory,
  type ReviewInspectorItem,
} from "@/components/review/review-inspector";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { internalImageSourceIdentity } from "@/lib/internal-media-url";
import { resolveMediaEditSource } from "@/lib/photo-edit/source-resolver";
import { cn } from "@/lib/utils";

const minZoom = 1;
const maxZoom = 5;
const toolbarButtonClass = "rounded-lg";

type Point = { x: number; y: number };
type Gesture =
  | { mode: "idle" }
  | { mode: "pan"; start: Point; origin: Point }
  | { mode: "swipe"; start: Point }
  | { mode: "pinch"; distance: number; zoom: number };

export type ReviewPendingAction = "category" | "delete" | "featured" | "state";

export interface ReviewLightboxItem {
  readonly key: string;
  readonly inspector: ReviewInspectorItem;
  readonly variants?: readonly { readonly url: string; readonly kind: string }[];
  readonly src: string | null;
  readonly fallbackSrc: string | null;
  readonly originalSrc: string | null;
  readonly localPreferred: boolean;
  readonly visualRevision: string | null;
  readonly width: number;
  readonly height: number;
  readonly featured: boolean;
  readonly publicationStatus: string;
  readonly mediaId: string | null;
  readonly localPhotoId: string | null;
  readonly bib: BibMediaState | null;
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
  return "等待上传";
}

function isInteractiveKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  ) {
    return true;
  }
  if (
    target instanceof HTMLButtonElement &&
    target.closest('[data-lightbox-toolbar="true"]') === null
  ) {
    return true;
  }
  const role = target.getAttribute("role");
  return (
    role === "combobox" ||
    role === "listbox" ||
    role === "menuitem" ||
    role === "option" ||
    role === "slider" ||
    target.closest('[data-slot="select-content"]') !== null
  );
}

export function ReviewLightbox({
  items,
  categories,
  selectedKey,
  onClose,
  onDelete,
  onEditApplied,
  onSelect,
  onViewed,
  onToggleFeatured,
  onToggleVisibility,
  onBibStateChange,
  onLocalBibConfirmNumbers,
  onLocalBibConfirmNoNumber,
  onBibError,
  onCategoryChange,
  readOnly = false,
}: Readonly<{
  items: readonly ReviewLightboxItem[];
  categories: readonly ReviewInspectorCategory[];
  selectedKey: string | null;
  onClose: () => void;
  onDelete: (key: string) => void;
  onEditApplied: () => void | Promise<void>;
  onSelect: (key: string) => void;
  onViewed: (key: string) => void;
  onStateAction: (key: string) => void;
  onToggleFeatured: (key: string) => void;
  onToggleVisibility: (key: string) => void;
  onBibStateChange: (mediaId: string, state: BibMediaState) => void;
  onLocalBibConfirmNumbers: (key: string, numbers: readonly string[]) => Promise<BibMediaState>;
  onLocalBibConfirmNoNumber: (key: string) => Promise<BibMediaState>;
  onBibError: (message: string) => void;
  onCategoryChange: (key: string, categoryId: string | null) => void;
  readOnly?: boolean;
}>) {
  const selectedIndex =
    selectedKey === null ? -1 : items.findIndex((item) => item.key === selectedKey);
  const selected = selectedIndex < 0 ? null : (items[selectedIndex] ?? null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef(new Map<number, Point>());
  const gestureRef = useRef<Gesture>({ mode: "idle" });
  const deleteTapRef = useRef<{ readonly key: string; readonly at: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [displaySrc, setDisplaySrc] = useState<string | null>(null);
  const displayIdentityRef = useRef<string | null>(null);
  const selectedKeyRef = useRef<string | null>(selectedKey);
  selectedKeyRef.current = selectedKey;
  const originalObjectUrlRef = useRef<string | null>(null);
  const [viewingOriginal, setViewingOriginal] = useState(false);
  const [originalLoading, setOriginalLoading] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenSupported, setFullscreenSupported] = useState(false);
  const [bibDialogOpen, setBibDialogOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(() => !readOnly);
  const [editMode, setEditMode] = useState(false);
  const [editPreview, setEditPreview] = useState<PhotoEditorPreviewState>({
    beforeUrl: null,
    afterUrl: null,
    loading: false,
  });

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

  const focusViewer = useCallback(() => {
    requestAnimationFrame(() => stageRef.current?.focus({ preventScroll: true }));
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

  useEffect(() => {
    if (selectedKey === null) return;
    setBibDialogOpen(false);
    setEditMode(false);
    setEditPreview({ beforeUrl: null, afterUrl: null, loading: false });
    setViewingOriginal(false);
    setOriginalLoading(false);
    if (originalObjectUrlRef.current !== null) {
      URL.revokeObjectURL(originalObjectUrlRef.current);
      originalObjectUrlRef.current = null;
    }
    resetView();
    pointersRef.current.clear();
    gestureRef.current = { mode: "idle" };
    deleteTapRef.current = null;
    focusViewer();
  }, [focusViewer, resetView, selectedKey]);

  useEffect(() => {
    if (editMode || viewingOriginal) return;
    const nextSource = selected?.src ?? null;
    const nextIdentity =
      selected === null
        ? null
        : `${selected.key}\u0000${selected.visualRevision ?? "base"}\u0000${internalImageSourceIdentity(nextSource) ?? "none"}`;
    if (displayIdentityRef.current === nextIdentity) return;
    displayIdentityRef.current = nextIdentity;
    setDisplaySrc(nextSource);
    setLoaded(false);
    setLoadFailed(false);
  }, [editMode, selected, viewingOriginal]);

  const handleEditPreviewChange = useCallback((preview: PhotoEditorPreviewState) => {
    setEditPreview(preview);
  }, []);

  useEffect(
    () => () => {
      if (originalObjectUrlRef.current !== null) {
        URL.revokeObjectURL(originalObjectUrlRef.current);
        originalObjectUrlRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    setFullscreenSupported(document.fullscreenEnabled);
    const update = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  useEffect(() => {
    if (editMode || selectedKey === null) return;
    const stage = stageRef.current;
    if (stage === null) return;
    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();
      changeZoom(zoom + (event.deltaY < 0 ? 0.35 : -0.35));
    };
    stage.addEventListener("wheel", handleWheel, { passive: false });
    return () => stage.removeEventListener("wheel", handleWheel);
  }, [changeZoom, editMode, selectedKey, zoom]);

  useEffect(() => {
    if (selected === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isInteractiveKeyboardTarget(event.target)) return;
      if (editMode) {
        if (event.key === "Escape") {
          event.preventDefault();
          setEditMode(false);
          setEditPreview({ beforeUrl: null, afterUrl: null, loading: false });
        }
        return;
      }
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
      } else if (!readOnly && event.code === "Space") {
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat || selected.pendingAction !== null) return;
        if (selected.publicationStatus === "published" || selected.publicationStatus === "hidden") {
          onToggleVisibility(selected.key);
          focusViewer();
        }
      } else if (!readOnly && event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        if (selected.pendingAction === null) {
          onToggleFeatured(selected.key);
          focusViewer();
        }
      } else if (!readOnly && event.key === "Delete" && selected.canDelete) {
        event.preventDefault();
        if (selected.pendingAction !== null) return;
        const now = Date.now();
        if (deleteTapRef.current?.key === selected.key && now - deleteTapRef.current.at <= 900) {
          deleteTapRef.current = null;
          onDelete(selected.key);
          focusViewer();
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
    editMode,
    focusViewer,
    fullscreenSupported,
    onClose,
    onDelete,
    onToggleFeatured,
    onToggleVisibility,
    readOnly,
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

  async function showOriginal(): Promise<void> {
    if (selected === null) return;

    const selectedKeyAtStart = selected.key;
    setOriginalLoading(true);
    try {
      let objectUrl: string;
      if (selected.localPreferred && selected.originalSrc !== null) {
        objectUrl = selected.originalSrc;
      } else {
        if (selected.mediaId === null) return;
        const cached = originalObjectUrlRef.current;
        if (cached !== null) {
          objectUrl = cached;
        } else {
          const resolved = await resolveMediaEditSource(selected.mediaId);
          if (selectedKeyRef.current !== selectedKeyAtStart) return;
          objectUrl = URL.createObjectURL(resolved.blob);
          originalObjectUrlRef.current = objectUrl;
        }
      }
      if (selectedKeyRef.current !== selectedKeyAtStart) return;

      displayIdentityRef.current = `${selected.key}\u0000original\u0000${internalImageSourceIdentity(objectUrl) ?? "local-original"}`;
      setDisplaySrc(objectUrl);
      setViewingOriginal(true);
      setLoaded(false);
      setLoadFailed(false);
      resetView();
    } catch {
      if (selectedKeyRef.current === selectedKeyAtStart) setLoadFailed(true);
    } finally {
      if (selectedKeyRef.current === selectedKeyAtStart) setOriginalLoading(false);
    }
  }

  function showPreview(): void {
    if (selected === null) return;
    const nextSource = selected.src;
    displayIdentityRef.current = `${selected.key}\u0000${selected.visualRevision ?? "base"}\u0000${internalImageSourceIdentity(nextSource) ?? "none"}`;
    setDisplaySrc(nextSource);
    setViewingOriginal(false);
    setLoaded(false);
    setLoadFailed(false);
    resetView();
  }

  function onImageError(): void {
    if (selected === null) return;
    setLoaded(false);
    if (selected.fallbackSrc !== null && displaySrc !== selected.fallbackSrc) {
      displayIdentityRef.current = `${selected.key}\u0000${selected.visualRevision ?? "base"}\u0000${internalImageSourceIdentity(selected.fallbackSrc) ?? "none"}`;
      setDisplaySrc(selected.fallbackSrc);
      setLoadFailed(false);
      return;
    }
    setLoadFailed(true);
  }

  if (selected === null) return null;

  const published = selected.publicationStatus === "published";
  const hidden = selected.publicationStatus === "hidden";
  const canToggleVisibility = published || (hidden && !selected.inspector.editPending);
  const busy = selected.pendingAction !== null;
  const canNavigate = items.length > 1;
  const bibConfirmed = isBibReviewConfirmed(selected.bib);
  const localActions =
    selected.mediaId === null
      ? {
          confirmNumbers: (numbers: readonly string[]) =>
            onLocalBibConfirmNumbers(selected.key, numbers),
          confirmNoNumber: () => onLocalBibConfirmNoNumber(selected.key),
        }
      : undefined;
  const imageTransform = `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`;

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent
          className="inset-0 left-0 top-0 h-dvh w-screen max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none bg-black p-0 text-white ring-0 sm:max-w-none"
          padding="none"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">审核图片查看器</DialogTitle>
          <DialogDescription className="sr-only">
            左右键切换，滚轮、双击或加减键缩放，拖动查看；空格切换显示状态，回车切换精选，连续两次
            Delete 删除。
          </DialogDescription>

          <div className="flex h-full w-full overflow-hidden bg-black" ref={viewerRef}>
            <div className="relative min-w-0 flex-1 overflow-hidden bg-black">
              <div
                aria-label="审核图片画布"
                className={cn(
                  "absolute inset-0 touch-none select-none",
                  zoom > 1 && (dragging ? "cursor-grabbing" : "cursor-grab"),
                )}
                onDoubleClick={
                  editMode ? undefined : () => (zoom === 1 ? changeZoom(2.5) : resetView())
                }
                onPointerCancel={editMode ? undefined : finishPointer}
                onPointerDown={editMode ? undefined : onPointerDown}
                onPointerMove={editMode ? undefined : onPointerMove}
                onPointerUp={editMode ? undefined : finishPointer}
                ref={stageRef}
                role="application"
                tabIndex={-1}
              >
                {editMode ? (
                  editPreview.beforeUrl !== null ? (
                    <>
                      <PhotoBeforeAfterSlider
                        afterUrl={editPreview.afterUrl}
                        beforeUrl={editPreview.beforeUrl}
                        disabled={editPreview.loading}
                      />
                      {editPreview.loading ? (
                        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-black/35 text-sm text-white">
                          正在准备修图源…
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="absolute inset-0 grid place-items-center text-sm text-white/60">
                      正在准备修图源…
                    </div>
                  )
                ) : displaySrc === null ? (
                  <div className="absolute inset-0 grid place-items-center text-sm text-white/60">
                    暂无可预览图片
                  </div>
                ) : (
                  <>
                    {!loaded && !loadFailed ? (
                      <div className="absolute inset-0 grid place-items-center text-sm text-white/60">
                        正在加载图片…
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
                      <InternalCachedImage
                        alt={readOnly ? "投诉目标照片" : "审核图片"}
                        className={cn(
                          "object-contain transition-opacity duration-150",
                          loaded ? "opacity-100" : "opacity-0",
                        )}
                        draggable={false}
                        fill
                        key={`${selected.key}:${selected.visualRevision ?? "base"}`}
                        onError={onImageError}
                        onLoad={() => {
                          setLoaded(true);
                          setLoadFailed(false);
                          if (!readOnly) onViewed(selected.key);
                        }}
                        loading="eager"
                        sizes="100vw"
                        src={displaySrc}
                        mediaId={selected.mediaId}
                        variantKind={
                          selected.variants?.find((variant) => variant.url === displaySrc)?.kind
                        }
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
                  {(selected.localPreferred && selected.originalSrc !== null) ||
                  (!selected.localPreferred && selected.mediaId !== null) ? (
                    <Button
                      aria-label={viewingOriginal ? "返回 1920" : "查看原图"}
                      className="border-white/15 bg-black/35 text-white backdrop-blur-md hover:bg-white/15 hover:text-white"
                      disabled={originalLoading}
                      onClick={() => {
                        if (viewingOriginal) showPreview();
                        else void showOriginal();
                      }}
                      size="sm"
                      title={viewingOriginal ? "返回 1920 预览" : "查看上传原图"}
                      type="button"
                      variant="review-lightbox"
                    >
                      {originalLoading ? (
                        <Spinner className="animate-spin"  />
                      ) : (
                        <ImageIcon />
                      )}
                      <span>{viewingOriginal ? "返回 1920" : "查看原图"}</span>
                    </Button>
                  ) : null}
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
                    aria-label={readOnly ? "关闭图片查看器" : "关闭审核图片查看器"}
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

              {!readOnly && !bibConfirmed && !editMode ? (
                <div className="pointer-events-none absolute inset-x-3 top-16 z-30 sm:left-auto sm:right-4 sm:w-[22rem]">
                  <div className="pointer-events-auto rounded-2xl border border-white/10 bg-black/60 p-3 shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-4">
                    <BibReviewEditor
                      compact
                      localActions={localActions}
                      mediaId={selected.mediaId}
                      onChange={(state) => {
                        if (selected.mediaId !== null) onBibStateChange(selected.mediaId, state);
                      }}
                      onError={onBibError}
                      state={selected.bib}
                      tone="dark"
                    />
                  </div>
                </div>
              ) : null}

              {canNavigate && !editMode ? (
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

                  <div
                    className={cn(
                      "flex max-w-full flex-wrap items-center gap-1.5 rounded-2xl border border-white/10 bg-black/35 p-1.5 shadow-lg shadow-black/20 backdrop-blur-xl",
                      readOnly && "hidden",
                    )}
                    data-lightbox-toolbar="true"
                  >
                    {bibConfirmed ? (
                      <Button
                        aria-label="修改号码确认"
                        className="size-8 rounded-lg border-emerald-400/30 bg-emerald-500/80 text-white shadow-none hover:border-emerald-300/40 hover:bg-emerald-500 hover:text-white"
                        onClick={(event) => {
                          event.currentTarget.blur();
                          setBibDialogOpen(true);
                        }}
                        size="icon-sm"
                        title="号码已确认，点击修改"
                        type="button"
                        variant="outline"
                      >
                        <BadgeCheckIcon />
                      </Button>
                    ) : null}

                    <Button
                      aria-label={selected.featured ? "取消精选" : "设为精选"}
                      className={cn(
                        toolbarButtonClass,
                        "size-8",
                        selected.featured && "text-amber-400 hover:text-amber-300",
                      )}
                      disabled={busy}
                      onClick={(event) => {
                        event.currentTarget.blur();
                        onToggleFeatured(selected.key);
                        focusViewer();
                      }}
                      size="icon-sm"
                      title={selected.featured ? "取消精选 (Enter)" : "精选 (Enter)"}
                      type="button"
                      variant="review-lightbox"
                    >
                      {selected.pendingAction === "featured" ? (
                        <Spinner className="animate-spin"  />
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
                      data-review-publication-toggle
                      disabled={busy || !canToggleVisibility}
                      onClick={(event) => {
                        event.currentTarget.blur();
                        onToggleVisibility(selected.key);
                        focusViewer();
                      }}
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
                      title={published ? "隐藏 (Space)" : hidden ? "显示 (Space)" : "等待上传完成"}
                      type="button"
                      variant="review-lightbox"
                    >
                      {selected.pendingAction === "state" ? (
                        <Spinner className="animate-spin"  />
                      ) : published ? (
                        <EyeIcon />
                      ) : hidden ? (
                        <EyeOffIcon />
                      ) : (
                        <Spinner className="opacity-60" />
                      )}
                    </Button>
                    <Button
                      aria-label={inspectorOpen ? "关闭照片属性" : "打开照片属性"}
                      className={cn(
                        toolbarButtonClass,
                        "size-8",
                        inspectorOpen && "border-white/25 bg-white/[0.14]",
                      )}
                      disabled={busy || editMode}
                      onClick={(event) => {
                        event.currentTarget.blur();
                        setInspectorOpen((current) => !current);
                      }}
                      size="icon-sm"
                      title={inspectorOpen ? "关闭照片属性" : "打开照片属性"}
                      type="button"
                      variant="review-lightbox"
                    >
                      {inspectorOpen ? <PanelRightCloseIcon /> : <PanelRightOpenIcon />}
                    </Button>
                    <Button
                      aria-label="删除"
                      className="size-8 rounded-lg border-red-400/20 bg-red-500/25 text-red-100 shadow-none backdrop-blur-md hover:border-red-400/35 hover:bg-red-500/40 hover:text-white disabled:border-white/5 disabled:bg-white/[0.03] disabled:text-white/35"
                      disabled={busy || !selected.canDelete}
                      onClick={(event) => {
                        event.currentTarget.blur();
                        onDelete(selected.key);
                        focusViewer();
                      }}
                      size="icon-sm"
                      title={
                        selected.canDelete ? "删除（键盘连续按两次 Delete）" : "仅管理员可删除"
                      }
                      type="button"
                      variant="outline"
                    >
                      {selected.pendingAction === "delete" ? (
                        <LoaderCircleIcon className="animate-spin"  />
                      ) : (
                        <Trash2Icon />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {!readOnly && inspectorOpen ? (
              <div className="h-full w-[clamp(17rem,32vw,24rem)] shrink-0 overflow-hidden bg-card text-card-foreground">
                {editMode ? (
                  <PhotoEditorPanel
                    docked
                    localPhotoId={selected.localPhotoId}
                    mediaId={selected.mediaId}
                    onApplied={onEditApplied}
                    onClose={() => {
                      setEditMode(false);
                      setEditPreview({ beforeUrl: null, afterUrl: null, loading: false });
                    }}
                    onPreviewChange={handleEditPreviewChange}
                  />
                ) : (
                  <ReviewInspector
                    busy={busy}
                    categories={categories}
                    docked
                    item={selected.inspector}
                    onCategoryChange={(categoryId) => onCategoryChange(selected.key, categoryId)}
                    onClose={() => setInspectorOpen(false)}
                    onDelete={() => {
                      onDelete(selected.key);
                      focusViewer();
                    }}
                    onOpenBib={() => setBibDialogOpen(true)}
                    onEdit={() => {
                      resetView();
                      setEditMode(true);
                      setEditPreview({ beforeUrl: null, afterUrl: null, loading: true });
                    }}
                    onStateAction={() => {
                      onToggleVisibility(selected.key);
                      focusViewer();
                    }}
                    onToggleFeatured={() => {
                      onToggleFeatured(selected.key);
                      focusViewer();
                    }}
                  />
                )}
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      {!readOnly ? (
        <BibReviewDialog
          localActions={localActions}
          mediaId={selected.mediaId}
          onChange={(state) => {
            if (selected.mediaId !== null) onBibStateChange(selected.mediaId, state);
          }}
          onError={onBibError}
          onOpenChange={setBibDialogOpen}
          open={bibDialogOpen && bibConfirmed}
          state={selected.bib}
        />
      ) : null}
    </>
  );
}
