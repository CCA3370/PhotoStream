"use client";

import type { PublicMediaView } from "@photostream/contracts";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  LoaderCircleIcon,
  Maximize2Icon,
  Minimize2Icon,
  XIcon,
} from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { CachedPhotoImage } from "@/components/gallery/cached-photo-image";
import { DownloadButton, type WeChatDownloadSource } from "@/components/gallery/download-button";
import { ImageDownloadProgress } from "@/components/gallery/image-download-progress";
import {
  fittedImageWidth,
  LightboxNeighborSlide,
  lightboxSlideScale,
  lightboxVariant,
  selectDisplayVariant,
} from "@/components/gallery/photo-lightbox-media";
import { PhotoLikeButton, type PhotoLikeState } from "@/components/gallery/photo-like-button";
import { PhotoReportButton } from "@/components/gallery/photo-report-button";
import { PhotoShareButton } from "@/components/gallery/photo-share-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { usePhotoLightboxGestures } from "@/hooks/use-photo-lightbox-gestures";
import { useWeChatBrowser } from "@/hooks/use-wechat-browser";
import { clientGet } from "@/lib/client-api";
import {
  isWarmDerivedImageDecoded,
  loadDerivedImage,
  readCachedDerivedImage,
} from "@/lib/derived-image-cache";
import { fetchImageWithProgress } from "@/lib/image-download-progress";
import { convertImageToJpeg } from "@/lib/image-jpeg";
import { readCachedOriginalImage, writeCachedOriginalImage } from "@/lib/original-image-cache";
import { cn } from "@/lib/utils";

const toolbarButtonClass =
  "h-11 rounded-xl border-white/10 bg-white/[0.07] px-3 text-white shadow-none backdrop-blur-md transition-[transform,background-color,border-color] duration-150 hover:border-white/20 hover:bg-white/[0.13] hover:text-white active:not-aria-[haspopup]:translate-y-0 active:scale-[0.97] sm:h-9 motion-reduce:transform-none motion-reduce:transition-none";

async function decodeImageUrl(url: string): Promise<void> {
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

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("图片转换失败，请重试。"));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("图片转换失败，请重试。"));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(blob);
  });
}

export function PhotoLightbox({
  items,
  likeStates,
  selectedId,
  shareId,
  slug,
  onClose,
  onLikeChange,
  onSelect,
}: Readonly<{
  items: readonly PublicMediaView[];
  likeStates: ReadonlyMap<string, PhotoLikeState>;
  selectedId: string | null;
  shareId?: string;
  slug?: string;
  onClose: () => void;
  onLikeChange: (state: PhotoLikeState) => void;
  onSelect: (mediaId: string) => void;
}>) {
  const weChat = useWeChatBrowser();
  const selectedIndex =
    selectedId === null ? -1 : items.findIndex((item) => item.id === selectedId);
  const selected = selectedIndex < 0 ? null : (items[selectedIndex] ?? null);
  const previous =
    selectedIndex < 0 || items.length < 2
      ? null
      : (items[(selectedIndex - 1 + items.length) % items.length] ?? null);
  const next =
    selectedIndex < 0 || items.length < 2
      ? null
      : (items[(selectedIndex + 1) % items.length] ?? null);
  const preview1920 = selected === null ? null : lightboxVariant(selected, "photo_1920");
  const canNavigate = items.length > 1 && selectedIndex >= 0 && shareId === undefined;
  const viewerRef = useRef<HTMLDivElement>(null);
  const targetRequestRef = useRef<{
    readonly direction: -1 | 1;
    readonly controller: AbortController;
  } | null>(null);
  const controlsEntranceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewerOpenRef = useRef(false);
  const preparedRequestRef = useRef(0);
  const [loadedDerivedIdentity, setLoadedDerivedIdentity] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenSupported, setFullscreenSupported] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(false);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [wechatDownload, setWeChatDownload] = useState<{
    kind: "preview" | "original";
    progress: number;
  } | null>(null);
  const [preparedImage, setPreparedImage] = useState<{
    mediaId: string;
    kind: "preview" | "original";
    url: string;
  } | null>(null);
  const activePreparedImage = preparedImage?.mediaId === selectedId ? preparedImage : null;

  const commitOffset = useCallback(
    (offset: -1 | 1) => {
      if (items.length < 2 || selectedIndex < 0 || shareId !== undefined) return;
      const index = (selectedIndex + offset + items.length) % items.length;
      const item = items[index];
      if (item !== undefined) onSelect(item.id);
    },
    [items, onSelect, selectedIndex, shareId],
  );

  const cancelTargetRequest = useCallback(() => {
    const current = targetRequestRef.current;
    if (current === null) return;
    targetRequestRef.current = null;
    current.controller.abort();
  }, []);

  const requestTarget = useCallback(
    (offset: -1 | 1, viewportWidth: number, viewportHeight: number) => {
      if (shareId !== undefined) return;
      const active = targetRequestRef.current;
      if (active?.direction === offset && !active.controller.signal.aborted) return;
      if (active !== null) active.controller.abort();
      targetRequestRef.current = null;

      const item = offset === -1 ? previous : next;
      if (item === null) return;
      const source = selectDisplayVariant(item, viewportWidth, viewportHeight);
      if (source === null) return;
      const controller = new AbortController();
      targetRequestRef.current = { direction: offset, controller };
      void loadDerivedImage({
        scope: slug ?? "public-media",
        mediaId: item.id,
        kind: source.kind === "photo_1920" ? "photo_1920" : "photo_960",
        bytes: source.bytes,
        sourceUrl: source.url,
        signal: controller.signal,
        refreshUrl: async () =>
          (
            await clientGet<{ url: string }>(
              slug === undefined
                ? `/api/v1/media/${encodeURIComponent(item.id)}/variants/${source.kind}`
                : `/api/v1/public/albums/${encodeURIComponent(slug)}/media/${encodeURIComponent(item.id)}/variants/${source.kind}`,
              controller.signal,
            )
          ).url,
      })
        .catch(() => undefined)
        .finally(() => {
          if (targetRequestRef.current?.controller === controller) targetRequestRef.current = null;
        });
    },
    [next, previous, shareId, slug],
  );

  const {
    animateOffset,
    changeZoom,
    dragging,
    finishPointer,
    onPointerDown,
    onPointerMove,
    onWheel,
    pan,
    resetInteraction,
    resetView,
    setStageElement,
    stageHeight,
    stageWidth,
    swipeOffset,
    swipeSettling,
    zoom,
  } = usePhotoLightboxGestures({
    canNavigate,
    cancelTargetRequest,
    commitOffset,
    requestTarget,
    selected,
  });

  const large = selected === null ? null : selectDisplayVariant(selected, stageWidth, stageHeight);
  const largeIdentity =
    selected === null || large === null
      ? null
      : `${selected.id}\u0000${large.kind}\u0000${large.bytes}`;
  const loaded = largeIdentity !== null && loadedDerivedIdentity === largeIdentity;

  useLayoutEffect(() => {
    if (selected === null || large === null || largeIdentity === null) {
      setLoadedDerivedIdentity(null);
      return;
    }
    setLoadedDerivedIdentity(
      isWarmDerivedImageDecoded({
        scope: slug ?? "public-media",
        mediaId: selected.id,
        kind: large.kind === "photo_1920" ? "photo_1920" : "photo_960",
        bytes: large.bytes,
      })
        ? largeIdentity
        : null,
    );
  }, [large, largeIdentity, selected, slug]);

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

  const toggleFullscreen = useCallback(async () => {
    const viewer = viewerRef.current;
    if (!document.fullscreenEnabled || viewer === null) return;
    if (document.fullscreenElement === null) await viewer.requestFullscreen();
    else await document.exitFullscreen();
  }, []);

  useEffect(() => {
    if (selectedId === null) {
      cancelTargetRequest();
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
  }, [cancelTargetRequest, clearControlsHideTimer, selectedId]);

  useEffect(() => {
    preparedRequestRef.current += 1;
    setDownloadMenuOpen(false);
    setWeChatDownload(null);
    setPreparedImage(null);
    if (selectedId !== null) resetInteraction();
  }, [resetInteraction, selectedId]);

  useEffect(
    () => () => {
      cancelTargetRequest();
      if (controlsEntranceTimerRef.current !== null) clearTimeout(controlsEntranceTimerRef.current);
      clearControlsHideTimer();
      preparedRequestRef.current += 1;
    },
    [cancelTargetRequest, clearControlsHideTimer],
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
    if (selected === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      revealControls();
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.matches("input, textarea, select") || target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "ArrowLeft" && canNavigate) {
        event.preventDefault();
        animateOffset(-1);
      } else if (event.key === "ArrowRight" && canNavigate) {
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
    canNavigate,
    changeZoom,
    fullscreenSupported,
    resetView,
    revealControls,
    selected,
    toggleFullscreen,
    zoom,
  ]);

  const showSaveHint = useCallback((kind: "preview" | "original") => {
    setDownloadMenuOpen(false);
    toast.add({
      title:
        kind === "original"
          ? "原图已加载完成，请长按图片并选择“保存到手机”"
          : "普通图已加载完成，请长按图片并选择“保存到手机”",
      type: "success",
      timeout: 5_000,
    });
  }, []);

  const replacePreparedImage = useCallback(
    async (kind: "preview" | "original", blob: Blob) => {
      if (selected === null) return;
      const mediaId = selected.id;
      const requestId = preparedRequestRef.current + 1;
      preparedRequestRef.current = requestId;
      const dataUrl = await blobToDataUrl(blob);
      await decodeImageUrl(dataUrl);
      if (preparedRequestRef.current !== requestId || selectedId !== mediaId) return;
      setPreparedImage({ mediaId, kind, url: dataUrl });
      resetView();
      showSaveHint(kind);
    },
    [resetView, selected, selectedId, showSaveHint],
  );

  const preparePreviewForWeChat = useCallback(
    async (source: WeChatDownloadSource) => {
      if (selected === null || slug === undefined) return;
      if (activePreparedImage?.kind === "preview") {
        showSaveHint("preview");
        return;
      }
      setWeChatDownload({ kind: "preview", progress: 0 });
      try {
        let blob = await readCachedDerivedImage({
          scope: slug,
          mediaId: selected.id,
          kind: "photo_1920",
          bytes: source.bytes,
        });
        if (blob === null) {
          blob = await fetchImageWithProgress({
            url: source.url,
            expectedBytes: source.bytes,
            onProgress: (progress) =>
              setWeChatDownload((current) =>
                current?.kind === "preview" ? { ...current, progress } : current,
              ),
          });
        } else {
          setWeChatDownload((current) =>
            current?.kind === "preview" ? { ...current, progress: 1 } : current,
          );
        }
        let preparedBlob = blob;
        try {
          preparedBlob = await convertImageToJpeg(blob);
        } catch {
          // Some WeChat/WebView builds cannot encode JPEG. Keep the already-fetched source
          // so long-press saving still works without another network request or an error.
        }
        await replacePreparedImage("preview", preparedBlob);
      } finally {
        setWeChatDownload((current) => (current?.kind === "preview" ? null : current));
      }
    },
    [activePreparedImage, replacePreparedImage, selected, showSaveHint, slug],
  );

  const prepareOriginalForWeChat = useCallback(
    async (source: WeChatDownloadSource) => {
      if (selected === null || slug === undefined) return;
      if (activePreparedImage?.kind === "original") {
        showSaveHint("original");
        return;
      }
      setWeChatDownload({ kind: "original", progress: 0 });
      try {
        let blob = await readCachedOriginalImage(slug, selected.id, source.bytes);
        if (blob === null) {
          blob = await fetchImageWithProgress({
            url: source.url,
            expectedBytes: source.bytes,
            onProgress: (progress) =>
              setWeChatDownload((current) =>
                current?.kind === "original" ? { ...current, progress } : current,
              ),
          });
          await writeCachedOriginalImage(slug, selected.id, source.bytes, blob);
        } else {
          setWeChatDownload((current) =>
            current?.kind === "original" ? { ...current, progress: 1 } : current,
          );
        }
        await replacePreparedImage("original", blob);
      } finally {
        setWeChatDownload((current) => (current?.kind === "original" ? null : current));
      }
    },
    [activePreparedImage, replacePreparedImage, selected, showSaveHint, slug],
  );

  if (selected === null || large === null) return null;

  const canDownloadPreview =
    shareId === undefined &&
    slug !== undefined &&
    selected.downloads.preview &&
    preview1920 !== null;
  const canDownloadOriginal =
    shareId === undefined &&
    slug !== undefined &&
    selected.downloads.original &&
    selected.downloads.originalBytes !== null;
  const canDownload = canDownloadPreview || canDownloadOriginal;
  const selectedLikeState = likeStates.get(selected.id) ?? null;
  const imageTransform = `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`;
  const previousOffset = -stageWidth + swipeOffset;
  const currentOffset = swipeOffset;
  const nextOffset = stageWidth + swipeOffset;
  const previousScale = lightboxSlideScale(-1, swipeOffset, stageWidth);
  const currentScale = lightboxSlideScale(0, swipeOffset, stageWidth);
  const nextScale = lightboxSlideScale(1, swipeOffset, stageWidth);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="dark public-theme inset-0 top-0 left-0 h-dvh w-screen max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none bg-black p-0 text-white ring-0 duration-200 data-open:zoom-in-100 data-closed:zoom-out-100 data-closed:duration-150 sm:max-w-none motion-reduce:duration-0"
        padding="none"
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
          {wechatDownload === null ? null : (
            <ImageDownloadProgress kind={wechatDownload.kind} progress={wechatDownload.progress} />
          )}
          <div
            aria-label="照片画布"
            data-viewer-onboarding-target="lightbox-canvas"
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
            ref={setStageElement}
            role="application"
          >
            {!loaded && activePreparedImage === null ? (
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

            <LightboxNeighborSlide
              media={stageWidth > 0 ? previous : null}
              offset={previousOffset}
              scale={previousScale}
              settling={swipeSettling}
              slug={slug}
              viewportHeight={stageHeight}
              viewportWidth={stageWidth}
            />

            <div
              className={cn(
                "absolute inset-0 will-change-transform",
                swipeSettling &&
                  "transition-transform duration-180 ease-out motion-reduce:transition-none",
              )}
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
                  {activePreparedImage === null && shareId === undefined ? (
                    <LightboxNeighborSlide
                      media={selected}
                      offset={0}
                      scale={1}
                      settling={false}
                      slug={slug}
                      viewportHeight={stageHeight}
                      viewportWidth={stageWidth}
                    />
                  ) : null}
                  {activePreparedImage === null ? (
                    <CachedPhotoImage
                      alt="活动照片"
                      bytes={large.bytes}
                      cacheOnly={stageWidth <= 0 || stageHeight <= 0}
                      className={cn(
                        "object-contain transition-[opacity,filter] duration-160 ease-out motion-reduce:transition-none",
                        loaded ? "opacity-100 blur-0" : "opacity-0 blur-[1px]",
                      )}
                      draggable={false}
                      kind={large.kind === "photo_1920" ? "photo_1920" : "photo_960"}
                      mediaId={selected.id}
                      onLoad={() => {
                        if (largeIdentity !== null) setLoadedDerivedIdentity(largeIdentity);
                      }}
                      priority
                      {...(shareId === undefined || slug === undefined
                        ? {}
                        : {
                            refreshUrl: async () =>
                              (
                                await clientGet<{ url: string }>(
                                  `/api/v1/public/albums/${encodeURIComponent(slug)}/shared/${encodeURIComponent(selected.id)}/variants/${large.kind}?share=${encodeURIComponent(shareId)}`,
                                )
                              ).url,
                          })}
                      scope={slug ?? "public-media"}
                      sizes="100vw"
                      sourceUrl={large.url}
                    />
                  ) : (
                    <Image
                      alt={activePreparedImage.kind === "original" ? "活动照片原图" : "活动照片"}
                      className="object-contain"
                      draggable={false}
                      fill
                      key={activePreparedImage.url}
                      priority
                      sizes="100vw"
                      src={activePreparedImage.url}
                      unoptimized
                    />
                  )}
                </div>
              </div>
            </div>

            <LightboxNeighborSlide
              media={stageWidth > 0 ? next : null}
              offset={nextOffset}
              scale={nextScale}
              settling={swipeSettling}
              slug={slug}
              viewportHeight={stageHeight}
              viewportWidth={stageWidth}
            />
          </div>

          <div
            aria-hidden={!controlsVisible}
            className={cn(
              "pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between bg-gradient-to-b from-black/65 via-black/15 to-transparent px-2.5 pt-[max(0.65rem,env(safe-area-inset-top))] pb-14 transition-[opacity,transform] duration-200 ease-out sm:p-4 sm:pb-16 motion-reduce:transition-none",
              controlsVisible
                ? "translate-y-0 opacity-100"
                : "pointer-events-none -translate-y-2 opacity-0",
            )}
            data-lightbox-controls
            inert={!controlsVisible}
          >
            <div className="pointer-events-auto">
              {slug !== undefined && shareId === undefined ? (
                <PhotoReportButton
                  className="h-11 rounded-full border-white/10 bg-black/30 px-3 text-white backdrop-blur-md transition-[transform,background-color] duration-150 hover:bg-white/15 hover:text-white active:scale-[0.96] sm:h-10 motion-reduce:transform-none motion-reduce:transition-none"
                  mediaId={selected.id}
                  slug={slug}
                />
              ) : null}
            </div>
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
                data-viewer-onboarding-target="lightbox-navigation"
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
            data-viewer-onboarding-target="lightbox-toolbar"
            inert={!controlsVisible}
          >
            <div className="pointer-events-auto mx-auto flex w-full max-w-5xl items-end justify-between gap-3">
              <div className="hidden shrink-0 text-[11px] text-white/55 sm:block">
                {selected.width} × {selected.height} · {Math.round(zoom * 100)}%
                {activePreparedImage?.kind === "original" ? " · 原图" : null}
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
                    {slug === undefined || shareId !== undefined ? null : (
                      <PhotoLikeButton
                        className="shrink-0"
                        mediaId={selected.id}
                        mode="toolbar"
                        onChange={onLikeChange}
                        slug={slug}
                        state={selectedLikeState}
                      />
                    )}

                    {slug === undefined ? null : (
                      <PhotoShareButton
                        className={cn(toolbarButtonClass, "min-w-0 flex-1 sm:flex-none")}
                        mediaId={selected.id}
                        {...(shareId === undefined ? {} : { shareId })}
                        slug={slug}
                      />
                    )}

                    {canDownload ? (
                      <Button
                        className={cn(toolbarButtonClass, "min-w-0 flex-1 sm:flex-none")}
                        data-viewer-onboarding-action="download"
                        onClick={() => setDownloadMenuOpen(true)}
                        type="button"
                        variant="outline"
                      >
                        <DownloadIcon data-icon="inline-start" />
                        {weChat ? "保存至相册" : "下载"}
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
                          onSuccess={() => setDownloadMenuOpen(false)}
                          onWeChatSave={preparePreviewForWeChat}
                          showBytes={false}
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
                          onSuccess={() => setDownloadMenuOpen(false)}
                          onWeChatSave={prepareOriginalForWeChat}
                          showBytes={false}
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
