"use client";

import { HeartIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { publicMutation } from "@/lib/client-api";
import { cn } from "@/lib/utils";

export interface PhotoLikeState {
  readonly mediaId: string;
  readonly count: number;
  readonly likedByViewer: boolean;
}

export function PhotoLikeButton({
  className,
  mediaId,
  mode,
  onChange,
  slug,
  state,
}: Readonly<{
  className?: string;
  mediaId: string;
  mode: "thumbnail" | "toolbar";
  onChange: (state: PhotoLikeState) => void;
  slug: string;
  state: PhotoLikeState | null;
}>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const liked = state?.likedByViewer ?? false;

  useEffect(() => {
    if (mode !== "toolbar") return;
    const updatePortalTarget = () => {
      const fullscreenElement = document.fullscreenElement;
      setPortalTarget(fullscreenElement instanceof HTMLElement ? fullscreenElement : document.body);
    };
    updatePortalTarget();
    document.addEventListener("fullscreenchange", updatePortalTarget);
    return () => document.removeEventListener("fullscreenchange", updatePortalTarget);
  }, [mode]);

  async function toggle(): Promise<void> {
    if (pending || state === null) return;
    const previous = state;
    const nextLiked = !previous.likedByViewer;
    onChange({
      mediaId,
      count: Math.max(0, previous.count + (nextLiked ? 1 : -1)),
      likedByViewer: nextLiked,
    });
    setPending(true);
    setError(null);
    try {
      const result = await publicMutation<PhotoLikeState>(
        `/api/v1/public/albums/${slug}/media/${mediaId}/like`,
        nextLiked ? {} : { method: "DELETE" },
      );
      onChange(result);
    } catch (caught) {
      onChange(previous);
      setError(caught instanceof Error ? caught.message : "点赞操作失败，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  const heart = (
    <HeartIcon
      aria-hidden="true"
      className={cn(
        mode === "thumbnail" ? "size-3.5" : "size-4",
        "transition-[color,fill] duration-150",
        liked && "fill-rose-500 text-rose-500",
      )}
    />
  );

  if (mode === "thumbnail") {
    return (
      <>
        <Button
          aria-label={liked ? "取消点赞" : "点赞"}
          aria-pressed={liked}
          className={cn(
            "relative top-0.5 h-6 gap-0.5 border-0 bg-transparent px-0.5 text-white shadow-none drop-shadow-sm transition-opacity hover:bg-transparent hover:text-white hover:opacity-90 active:not-aria-[haspopup]:translate-y-0",
            className,
          )}
          disabled={pending || state === null}
          onClick={() => void toggle()}
          type="button"
          variant="ghost"
        >
          {heart}
          <span className="min-w-2 text-[10px] leading-none font-semibold tracking-tight tabular-nums">
            {state === null ? "…" : state.count}
          </span>
        </Button>
        <ErrorDialog message={error} onClose={() => setError(null)} title="点赞失败" />
      </>
    );
  }

  if (portalTarget === null) return null;

  return createPortal(
    <>
      <Button
        aria-label={liked ? "取消点赞" : "点赞"}
        aria-pressed={liked}
        className={cn(
          "fixed right-3 bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+4rem)] z-[70] h-9 gap-1.5 rounded-full border-white/10 bg-black/30 px-3 text-white shadow-lg shadow-black/20 backdrop-blur-xl transition-[background-color,border-color,opacity] hover:border-white/20 hover:bg-white/[0.12] hover:text-white active:not-aria-[haspopup]:translate-y-0 sm:right-4 sm:bottom-16",
          className,
        )}
        disabled={pending || state === null}
        onClick={() => void toggle()}
        title={liked ? "取消点赞" : "点赞"}
        type="button"
        variant="outline"
      >
        {heart}
        <span className="min-w-3 text-[11px] font-medium tracking-tight tabular-nums text-white/90">
          {state === null ? "…" : state.count}
        </span>
      </Button>
      <ErrorDialog message={error} onClose={() => setError(null)} title="点赞失败" />
    </>,
    portalTarget,
  );
}
