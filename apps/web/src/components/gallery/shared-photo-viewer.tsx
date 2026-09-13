"use client";

import type { PublicMediaView } from "@photostream/contracts";
import { DownloadIcon, XIcon } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CachedPhotoImage } from "@/components/gallery/cached-photo-image";
import { DownloadButton, type WeChatDownloadSource } from "@/components/gallery/download-button";
import { ImageDownloadProgress } from "@/components/gallery/image-download-progress";
import { fittedImageWidth } from "@/components/gallery/photo-lightbox-media";
import { PhotoLikeButton, type PhotoLikeState } from "@/components/gallery/photo-like-button";
import { PhotoShareButton } from "@/components/gallery/photo-share-button";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { usePhotoLightboxGestures } from "@/hooks/use-photo-lightbox-gestures";
import { clientGet } from "@/lib/client-api";
import { fetchImageWithProgress } from "@/lib/image-download-progress";
import { cn } from "@/lib/utils";

const toolbarButtonClass =
  "h-11 rounded-xl border-white/10 bg-white/[0.07] px-2.5 text-xs text-white shadow-none backdrop-blur-md transition-[transform,background-color,border-color] duration-150 hover:border-white/20 hover:bg-white/[0.13] hover:text-white active:scale-[0.97] sm:px-3 sm:text-sm motion-reduce:transform-none motion-reduce:transition-none";

function bestPreview(media: PublicMediaView) {
  return (
    media.variants.find((candidate) => candidate.kind === "photo_1920") ??
    media.variants.find((candidate) => candidate.kind === "photo_960") ??
    media.variants.find((candidate) => candidate.kind === "photo_480") ??
    null
  );
}

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

export function SharedPhotoViewer({
  media,
  shareId,
  slug,
}: Readonly<{
  media: PublicMediaView;
  shareId: string;
  slug: string;
}>) {
  const preview = useMemo(() => bestPreview(media), [media]);
  const [likeState, setLikeState] = useState<PhotoLikeState | null>(null);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [wechatDownload, setWeChatDownload] = useState<{
    kind: "preview" | "original";
    progress: number;
  } | null>(null);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [preparedImage, setPreparedImage] = useState<{
    kind: "preview" | "original";
    url: string;
  } | null>(null);
  const ignoreNavigation = useCallback(() => undefined, []);
  const {
    changeZoom,
    dragging,
    finishPointer,
    onPointerDown,
    onPointerMove,
    onWheel,
    pan,
    resetView,
    setStageElement,
    zoom,
  } = usePhotoLightboxGestures({
    canNavigate: false,
    cancelTargetRequest: ignoreNavigation,
    commitOffset: ignoreNavigation,
    requestTarget: ignoreNavigation,
    selected: media,
  });

  useEffect(() => {
    let disposed = false;
    void clientGet<PhotoLikeState>(
      `/api/v1/public/albums/${encodeURIComponent(slug)}/shared/${encodeURIComponent(media.id)}/like?share=${encodeURIComponent(shareId)}`,
    )
      .then((state) => {
        if (!disposed) setLikeState(state);
      })
      .catch(() => {
        if (!disposed) setLikeState({ mediaId: media.id, count: 0, likedByViewer: false });
      });
    return () => {
      disposed = true;
    };
  }, [media.id, shareId, slug]);

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
    async (kind: "preview" | "original", url: string) => {
      const saveableUrl = new URL(url, window.location.href);
      if (saveableUrl.protocol !== "http:" && saveableUrl.protocol !== "https:") {
        throw new Error("当前图片地址无法由微信保存，请重新下载后重试。");
      }
      const resolvedUrl = saveableUrl.toString();
      await decodeImageUrl(resolvedUrl);
      setPreparedImage({ kind, url: resolvedUrl });
      resetView();
      showSaveHint(kind);
    },
    [resetView, showSaveHint],
  );

  const preparePreviewForWeChat = useCallback(
    async (source: WeChatDownloadSource) => {
      if (preparedImage?.kind === "preview") {
        showSaveHint("preview");
        return;
      }
      if (preparedImage === null && preview?.kind === "photo_1920" && previewLoaded) {
        await replacePreparedImage("preview", preview.url);
        return;
      }
      setWeChatDownload({ kind: "preview", progress: 0 });
      try {
        await fetchImageWithProgress({
          url: source.url,
          expectedBytes: source.bytes,
          onProgress: (progress) =>
            setWeChatDownload((current) =>
              current?.kind === "preview" ? { ...current, progress } : current,
            ),
        });
        await replacePreparedImage("preview", source.url);
      } finally {
        setWeChatDownload((current) => (current?.kind === "preview" ? null : current));
      }
    },
    [preparedImage, preview?.kind, preview?.url, previewLoaded, replacePreparedImage, showSaveHint],
  );

  const prepareOriginalForWeChat = useCallback(
    async (source: WeChatDownloadSource) => {
      if (preparedImage?.kind === "original") {
        showSaveHint("original");
        return;
      }
      setWeChatDownload({ kind: "original", progress: 0 });
      try {
        await fetchImageWithProgress({
          url: source.url,
          expectedBytes: source.bytes,
          onProgress: (progress) =>
            setWeChatDownload((current) =>
              current?.kind === "original" ? { ...current, progress } : current,
            ),
        });
        await replacePreparedImage("original", source.url);
      } finally {
        setWeChatDownload((current) => (current?.kind === "original" ? null : current));
      }
    },
    [preparedImage?.kind, replacePreparedImage, showSaveHint],
  );

  if (preview === null) return null;

  const canDownloadPreview = media.downloads.preview;
  const canDownloadOriginal = media.downloads.original && media.downloads.originalBytes !== null;
  const canDownload = canDownloadPreview || canDownloadOriginal;
  const imageTransform = `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`;

  return (
    <div className="dark public-theme fixed inset-0 z-50 h-dvh w-screen overflow-hidden bg-black text-white">
      {wechatDownload === null ? null : (
        <ImageDownloadProgress kind={wechatDownload.kind} progress={wechatDownload.progress} />
      )}
      <div
        aria-label="照片画布"
        className={cn(
          "absolute inset-0 touch-none select-none bg-black",
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
        <div
          className="absolute inset-0 origin-center will-change-transform"
          style={{ transform: imageTransform }}
        >
          <div
            className="absolute top-1/2 left-1/2 origin-center -translate-x-1/2 -translate-y-1/2"
            style={{
              aspectRatio: `${media.width} / ${media.height}`,
              width: fittedImageWidth(media),
            }}
          >
            {preparedImage === null ? (
              <CachedPhotoImage
                alt="活动照片"
                bytes={preview.bytes}
                className="object-contain"
                draggable={false}
                kind={
                  preview.kind === "photo_1920"
                    ? "photo_1920"
                    : preview.kind === "photo_960"
                      ? "photo_960"
                      : "photo_480"
                }
                mediaId={media.id}
                onLoad={() => setPreviewLoaded(true)}
                priority
                refreshUrl={async () =>
                  (
                    await clientGet<{ url: string }>(
                      `/api/v1/public/albums/${encodeURIComponent(slug)}/shared/${encodeURIComponent(media.id)}/variants/${preview.kind}?share=${encodeURIComponent(shareId)}`,
                    )
                  ).url
                }
                scope={slug}
                sizes="100vw"
                sourceUrl={preview.url}
              />
            ) : (
              <Image
                alt={preparedImage.kind === "original" ? "活动照片原图" : "活动照片"}
                className="object-contain"
                draggable={false}
                fill
                priority
                sizes="100vw"
                src={preparedImage.url}
                unoptimized
              />
            )}
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-2.5 pt-20 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4 sm:pt-24">
        <div className="pointer-events-auto mx-auto flex w-full max-w-5xl items-end justify-between gap-3">
          <div className="hidden shrink-0 text-[11px] text-white/55 sm:block">
            {media.width} × {media.height} · {Math.round(zoom * 100)}%
            {preparedImage?.kind === "original" ? " · 原图" : null}
          </div>

          <div className="ml-auto grid w-full min-w-0 items-center overflow-hidden rounded-2xl border border-white/10 bg-black/30 p-1.5 shadow-xl shadow-black/20 backdrop-blur-xl sm:w-auto sm:max-w-full">
            <div
              aria-hidden={downloadMenuOpen}
              inert={downloadMenuOpen}
              className={cn(
                "col-start-1 row-start-1 flex w-full items-center gap-1.5 transition-[opacity,transform] ease-out sm:w-auto",
                downloadMenuOpen
                  ? "pointer-events-none -translate-x-1 opacity-0 duration-100"
                  : "translate-x-0 opacity-100 duration-150 delay-[70ms]",
              )}
            >
              <PhotoLikeButton
                className="shrink-0 px-2.5"
                mediaId={media.id}
                mode="toolbar"
                onChange={setLikeState}
                shareId={shareId}
                slug={slug}
                state={likeState}
              />

              <PhotoShareButton
                className={cn(toolbarButtonClass, "min-w-0 flex-1 sm:flex-none")}
                mediaId={media.id}
                shareId={shareId}
                slug={slug}
              />

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

            {canDownload ? (
              <div
                aria-hidden={!downloadMenuOpen}
                inert={!downloadMenuOpen}
                className={cn(
                  "col-start-1 row-start-1 flex w-full items-center justify-self-end transition-[opacity,transform] ease-out sm:w-auto",
                  downloadMenuOpen
                    ? "translate-x-0 opacity-100 duration-180 delay-[70ms]"
                    : "pointer-events-none translate-x-1 opacity-0 duration-100",
                )}
              >
                <div className="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.75rem] items-center gap-1.5 sm:flex sm:w-auto">
                  {canDownloadPreview ? (
                    <DownloadButton
                      bytes={preview.bytes}
                      className={cn(
                        toolbarButtonClass,
                        "w-full min-w-0 px-2 text-[11px] sm:w-auto sm:px-2.5 sm:text-xs",
                      )}
                      kind="preview"
                      label="普通图"
                      mediaId={media.id}
                      onSuccess={() => setDownloadMenuOpen(false)}
                      onWeChatSave={preparePreviewForWeChat}
                      shareId={shareId}
                      showBytes={false}
                      showIcon={false}
                      slug={slug}
                    />
                  ) : null}
                  {canDownloadOriginal && media.downloads.originalBytes !== null ? (
                    <DownloadButton
                      bytes={media.downloads.originalBytes}
                      className={cn(
                        toolbarButtonClass,
                        "w-full min-w-0 px-2 text-[11px] sm:w-auto sm:px-2.5 sm:text-xs",
                      )}
                      kind="original"
                      label="原图"
                      mediaId={media.id}
                      onSuccess={() => setDownloadMenuOpen(false)}
                      onWeChatSave={prepareOriginalForWeChat}
                      shareId={shareId}
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
  );
}
