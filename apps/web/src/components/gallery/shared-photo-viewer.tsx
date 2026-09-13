"use client";

import type { PublicMediaView } from "@photostream/contracts";
import { ImageIcon, LoaderCircleIcon } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";

import { CachedPhotoImage } from "@/components/gallery/cached-photo-image";
import { DownloadButton } from "@/components/gallery/download-button";
import { PhotoLikeButton, type PhotoLikeState } from "@/components/gallery/photo-like-button";
import { PhotoShareButton } from "@/components/gallery/photo-share-button";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { clientGet, publicMutation } from "@/lib/client-api";
import { loadOriginalImage } from "@/lib/original-image-cache";
import { cn } from "@/lib/utils";

interface SignedOriginal {
  readonly url: string;
  readonly filename: string;
  readonly bytes: number;
  readonly expiresAt: string;
}

const toolbarButtonClass =
  "h-11 rounded-xl border-white/10 bg-white/[0.07] px-3 text-white shadow-none backdrop-blur-md transition-[transform,background-color,border-color] duration-150 hover:border-white/20 hover:bg-white/[0.13] hover:text-white active:scale-[0.97] motion-reduce:transform-none motion-reduce:transition-none";

function bestPreview(media: PublicMediaView) {
  return (
    media.variants.find((candidate) => candidate.kind === "photo_1920") ??
    media.variants.find((candidate) => candidate.kind === "photo_960") ??
    media.variants.find((candidate) => candidate.kind === "photo_480") ??
    null
  );
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
  const [originalPending, setOriginalPending] = useState(false);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const originalObjectUrlRef = useRef<string | null>(null);

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

  useEffect(
    () => () => {
      if (originalObjectUrlRef.current !== null) URL.revokeObjectURL(originalObjectUrlRef.current);
    },
    [],
  );

  async function loadOriginal(): Promise<void> {
    if (
      originalPending ||
      originalUrl !== null ||
      !media.downloads.original ||
      media.downloads.originalBytes === null
    ) {
      return;
    }
    setOriginalPending(true);
    try {
      const signed = await publicMutation<SignedOriginal>(
        `/api/v1/public/albums/${encodeURIComponent(slug)}/shared/${encodeURIComponent(media.id)}/original/view?share=${encodeURIComponent(shareId)}`,
      );
      const blob = await loadOriginalImage({
        slug,
        mediaId: media.id,
        expectedBytes: signed.bytes,
        sourceUrl: signed.url,
      });
      const objectUrl = URL.createObjectURL(blob);
      if (originalObjectUrlRef.current !== null) URL.revokeObjectURL(originalObjectUrlRef.current);
      originalObjectUrlRef.current = objectUrl;
      setOriginalUrl(objectUrl);
    } catch (caught) {
      toast.add({
        title: "原图加载失败",
        description: caught instanceof Error ? caught.message : "暂时无法加载原图，请稍后重试。",
        type: "error",
        timeout: 4_000,
      });
    } finally {
      setOriginalPending(false);
    }
  }

  if (preview === null) return null;

  return (
    <div className="dark public-theme fixed inset-0 z-50 overflow-hidden bg-black text-white">
      <div className="absolute inset-0 grid place-items-center bg-black">
        <div
          className="relative h-full w-full"
          style={{ aspectRatio: `${media.width} / ${media.height}` }}
        >
          {originalUrl === null ? (
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
              alt="活动照片原图"
              className="object-contain"
              draggable={false}
              fill
              priority
              sizes="100vw"
              src={originalUrl}
              unoptimized
            />
          )}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-2.5 pt-20 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4 sm:pt-24">
        <div className="pointer-events-auto mx-auto flex w-full max-w-5xl flex-col items-stretch gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="hidden shrink-0 text-[11px] text-white/55 sm:block">
            {media.width} × {media.height}
            {originalUrl === null ? null : " · 原图"}
          </div>

          <div className="ml-auto grid w-full grid-cols-2 gap-1.5 rounded-2xl border border-white/10 bg-black/30 p-1.5 shadow-xl shadow-black/20 backdrop-blur-xl sm:flex sm:w-auto sm:max-w-full">
            <PhotoLikeButton
              className="min-w-0"
              mediaId={media.id}
              mode="toolbar"
              onChange={setLikeState}
              shareId={shareId}
              slug={slug}
              state={likeState}
            />

            <PhotoShareButton
              className={cn(toolbarButtonClass, "min-w-0")}
              mediaId={media.id}
              shareId={shareId}
              slug={slug}
            />

            {media.downloads.original && media.downloads.originalBytes !== null ? (
              <Button
                className={cn(toolbarButtonClass, "min-w-0")}
                disabled={originalPending || originalUrl !== null}
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
                  {originalPending ? "加载中…" : originalUrl === null ? "查看原图" : "已加载原图"}
                </span>
              </Button>
            ) : null}

            {media.downloads.original && media.downloads.originalBytes !== null ? (
              <DownloadButton
                bytes={media.downloads.originalBytes}
                className={cn(toolbarButtonClass, "min-w-0")}
                kind="original"
                label="下载原图"
                mediaId={media.id}
                shareId={shareId}
                showBytes={false}
                slug={slug}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
