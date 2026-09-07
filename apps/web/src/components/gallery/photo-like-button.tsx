"use client";

import { HeartIcon } from "lucide-react";
import { useState } from "react";

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
  const liked = state?.likedByViewer ?? false;

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

  return (
    <>
      <Button
        aria-label={liked ? "取消点赞" : "点赞"}
        aria-pressed={liked}
        className={cn(
          mode === "thumbnail"
            ? "relative top-0.5 h-6 gap-0.5 border-0 bg-transparent px-0.5 text-white shadow-none drop-shadow-sm hover:bg-transparent hover:text-white hover:opacity-90"
            : "h-9 gap-1.5 rounded-xl border-white/10 bg-white/[0.07] px-3 text-white shadow-none backdrop-blur-md hover:border-white/20 hover:bg-white/[0.13] hover:text-white",
          "active:not-aria-[haspopup]:translate-y-0",
          className,
        )}
        disabled={pending || state === null}
        onClick={() => void toggle()}
        title={liked ? "取消点赞" : "点赞"}
        type="button"
        variant={mode === "thumbnail" ? "ghost" : "outline"}
      >
        {heart}
        <span
          className={cn(
            "min-w-2 font-semibold tracking-tight tabular-nums",
            mode === "thumbnail" ? "text-[10px] leading-none" : "text-xs",
          )}
        >
          {state === null ? "…" : state.count}
        </span>
      </Button>
      <ErrorDialog message={error} onClose={() => setError(null)} title="点赞失败" />
    </>
  );
}
