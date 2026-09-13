"use client";

import type { DownloadKind } from "@photostream/contracts";
import { DownloadIcon, LoaderCircleIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { toast } from "@/components/ui/toast";
import { publicMutation } from "@/lib/client-api";
import { loadDerivedImage } from "@/lib/derived-image-cache";
import { loadOriginalImage } from "@/lib/original-image-cache";

export interface WeChatDownloadSource {
  readonly url: string;
  readonly filename: string;
  readonly bytes: number;
  readonly expiresAt: string;
}

type SignedDownload = WeChatDownloadSource;
type WeChatPreparingState = {
  readonly kind: DownloadKind;
  readonly bytes: number;
  readonly phase: "loading" | "large" | "slow";
};

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function downloadErrorMessage(caught: unknown): string {
  if (caught instanceof TypeError) {
    return "无法连接图片下载服务，请稍后重试。";
  }
  return caught instanceof Error ? caught.message : "下载失败，请稍后重试。";
}

function jpegFilename(filename: string): string {
  const base = filename.replace(/\.[^./\\]+$/u, "").trim();
  return `${base || "photo"}.jpg`;
}

function isWeChatBrowser(): boolean {
  return typeof navigator !== "undefined" && /MicroMessenger/i.test(navigator.userAgent);
}

function findActiveLightboxImage(): HTMLImageElement | null {
  const transitionHost = document.querySelector<HTMLElement>("[data-lightbox-transition-image]");
  if (transitionHost !== null) {
    const images = transitionHost.querySelectorAll<HTMLImageElement>("img");
    const candidate = images.item(images.length - 1);
    if (candidate !== null) return candidate;
  }

  const canvas = document.querySelector<HTMLElement>('[aria-label="照片画布"]');
  if (canvas === null) return null;
  const images = canvas.querySelectorAll<HTMLImageElement>("img");
  return images.item(images.length - 1);
}

function weChatReadyMessage(kind: DownloadKind): string {
  return kind === "original"
    ? "原图已准备好，请长按图片并选择“保存到手机”"
    : "普通图已准备好，请长按图片并选择“保存到手机”";
}

async function convertImageToJpeg(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { alpha: false });
    if (context === null) throw new Error("当前浏览器无法转换 JPG 图片");

    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (jpeg) => {
          if (jpeg === null) {
            reject(new Error("JPG 图片转换失败"));
            return;
          }
          resolve(jpeg);
        },
        "image/jpeg",
        0.92,
      );
    });
  } finally {
    bitmap.close();
  }
}

function triggerDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

export function DownloadButton({
  bytes,
  className,
  kind,
  label,
  mediaId,
  onSuccess,
  onWeChatSave,
  shareId,
  showBytes = true,
  showIcon = true,
  slug,
}: Readonly<{
  bytes: number;
  className?: string;
  kind: DownloadKind;
  label: string;
  mediaId: string;
  onSuccess?: () => void;
  onWeChatSave?: (source: WeChatDownloadSource) => Promise<void> | void;
  shareId?: string;
  showBytes?: boolean;
  showIcon?: boolean;
  slug: string;
}>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [weChat, setWeChat] = useState(false);
  const [weChatPreparing, setWeChatPreparing] = useState<WeChatPreparingState | null>(null);
  const prepareGenerationRef = useRef(0);

  useEffect(() => {
    setWeChat(isWeChatBrowser());
  }, []);

  useEffect(
    () => () => {
      prepareGenerationRef.current += 1;
    },
    [],
  );

  async function prepareForWeChat(source: SignedDownload): Promise<void> {
    const image = findActiveLightboxImage();
    if (image === null) throw new Error("未找到当前图片，请关闭大图后重新打开再试。");

    const resolvedUrl = new URL(source.url, window.location.href);
    if (resolvedUrl.protocol !== "https:" && resolvedUrl.protocol !== "http:") {
      throw new Error("当前图片地址无法用于微信保存，请重新选择后重试。");
    }

    const generation = prepareGenerationRef.current + 1;
    prepareGenerationRef.current = generation;
    const previousSrc = image.currentSrc || image.src;
    const previousSrcset = image.getAttribute("srcset");
    const previousSizes = image.getAttribute("sizes");
    setWeChatPreparing({ kind, bytes: source.bytes, phase: "loading" });

    const largeTimer = window.setTimeout(() => {
      if (prepareGenerationRef.current === generation) {
        setWeChatPreparing({ kind, bytes: source.bytes, phase: "large" });
      }
    }, 3_000);
    const slowTimer = window.setTimeout(() => {
      if (prepareGenerationRef.current === generation) {
        setWeChatPreparing({ kind, bytes: source.bytes, phase: "slow" });
      }
    }, 10_000);

    try {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          image.removeEventListener("load", onLoad);
          image.removeEventListener("error", onError);
        };
        const onLoad = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new Error("图片加载失败，请检查网络后重试。"));
        };

        image.addEventListener("load", onLoad, { once: true });
        image.addEventListener("error", onError, { once: true });
        image.removeAttribute("srcset");
        image.removeAttribute("sizes");
        image.src = resolvedUrl.toString();
      });

      if (prepareGenerationRef.current !== generation) return;
      toast.add({
        title: weChatReadyMessage(kind),
        type: "success",
        timeout: 6_000,
      });
    } catch (caught) {
      if (prepareGenerationRef.current === generation && previousSrc.length > 0) {
        if (previousSrcset === null) image.removeAttribute("srcset");
        else image.setAttribute("srcset", previousSrcset);
        if (previousSizes === null) image.removeAttribute("sizes");
        else image.setAttribute("sizes", previousSizes);
        image.src = previousSrc;
      }
      throw caught;
    } finally {
      window.clearTimeout(largeTimer);
      window.clearTimeout(slowTimer);
      if (prepareGenerationRef.current === generation) setWeChatPreparing(null);
    }
  }

  async function download(): Promise<void> {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const endpoint =
        shareId === undefined
          ? `/api/v1/public/albums/${encodeURIComponent(slug)}/downloads/${encodeURIComponent(mediaId)}/${kind}`
          : `/api/v1/public/albums/${encodeURIComponent(slug)}/shared/${encodeURIComponent(mediaId)}/downloads/${kind}?share=${encodeURIComponent(shareId)}`;
      const signed = await publicMutation<SignedDownload>(endpoint, {
        idempotencyKey: crypto.randomUUID(),
      });

      if (weChat && onWeChatSave !== undefined) {
        await prepareForWeChat(signed);
        onSuccess?.();
        return;
      }

      const sourceBlob =
        kind === "preview"
          ? await loadDerivedImage({
              scope: slug,
              mediaId,
              kind: "photo_1920",
              bytes: signed.bytes,
              sourceUrl: signed.url,
            })
          : await loadOriginalImage({
              slug,
              mediaId,
              expectedBytes: signed.bytes,
              sourceUrl: signed.url,
            });
      let downloadBlob = sourceBlob;
      let filename = signed.filename;
      let converted = false;

      if (kind === "preview") {
        try {
          downloadBlob = await convertImageToJpeg(sourceBlob);
          filename = jpegFilename(signed.filename);
          converted = true;
        } catch {
          // Keep the fetched source image downloadable if this browser cannot encode JPEG.
        }
      }

      triggerDownload(downloadBlob, filename);
      toast.add({
        title: "下载成功",
        description:
          kind === "preview" && !converted
            ? `${filename}（当前浏览器无法转换 JPG，已下载原格式）`
            : filename,
        type: "success",
        timeout: 3_000,
      });
      onSuccess?.();
    } catch (caught) {
      setError(downloadErrorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  const preparingLabel =
    weChatPreparing?.kind === "original" ? "原图" : weChatPreparing === null ? "" : "普通图";
  const preparingDescription =
    weChatPreparing?.phase === "slow"
      ? `网络较慢，正在继续加载${preparingLabel}`
      : weChatPreparing?.phase === "large"
        ? "图片较大，请稍候"
        : `正在准备${preparingLabel}…`;

  return (
    <>
      <Button
        className={className}
        disabled={pending}
        onClick={() => void download()}
        type="button"
        variant="outline"
      >
        {showIcon ? <DownloadIcon data-icon="inline-start" /> : null}
        {pending && weChatPreparing === null
          ? "正在准备…"
          : showBytes || weChat
            ? `${label}（${formatBytes(bytes)}）`
            : label}
      </Button>
      {weChatPreparing === null ? null : (
        <div className="pointer-events-none fixed inset-0 z-[100] grid place-items-center bg-black/20 px-6 backdrop-blur-[1px]">
          <div className="flex min-w-48 flex-col items-center gap-3 rounded-2xl border border-white/10 bg-black/75 px-5 py-4 text-center text-white shadow-2xl backdrop-blur-xl">
            <LoaderCircleIcon
              aria-hidden="true"
              className="size-8 animate-spin motion-reduce:animate-none"
            />
            <div>
              <div className="text-sm font-medium">{preparingDescription}</div>
              <div className="mt-1 text-xs text-white/60">{formatBytes(weChatPreparing.bytes)}</div>
            </div>
          </div>
        </div>
      )}
      <ErrorDialog message={error} onClose={() => setError(null)} title="下载失败" />
    </>
  );
}
