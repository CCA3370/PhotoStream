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
      className={cn("size-4 transition-colors", liked && "fill-rose-500 text-rose-500")}
    />
  );

  if (mode === "thumbnail") {
    return (
      <>
        <Button
          aria-label={liked ? "取消点赞" : "点赞"}
          aria-pressed={liked}
          className={cn(
            "h-8 gap-1.5 rounded-full border-white/20 bg-black/45 px-2.5 text-white shadow-sm backdrop-blur-md hover:bg-black/60 hover:text-white active:not-aria-[haspopup]:translate-y-0",
            className,
          )}
          disabled={pending || state === null}
          onClick={() => void toggle()}
          type="button"
          variant="outline"
        >
          {heart}
          <span className="min-w-3 text-xs font-medium tabular-nums">
            {state === null ? "…" : state.count}
          </span>
        </Button>
        <ErrorDialog message={error} onClose={() => setError(null)} title="点赞失败" />
      </>
    );
  }

  return (
    <>
      <div className={cn("flex items-center gap-1.5", className)}>
        <Button
          aria-label={liked ? "取消点赞" : "点赞"}
          aria-pressed={liked}
          className="size-8 shrink-0 border-white/15 bg-black/35 text-white backdrop-blur-md hover:bg-white/15 hover:text-white active:not-aria-[haspopup]:translate-y-0"
          disabled={pending || state === null}
          onClick={() => void toggle()}
          size="icon-sm"
          title={liked ? "取消点赞" : "点赞"}
          type="button"
          variant="outline"
        >
          {heart}
        </Button>
        <span className="min-w-4 text-center text-xs font-medium tabular-nums text-white/80">
          {state === null ? "…" : state.count}
        </span>
      </div>
      <ErrorDialog message={error} onClose={() => setError(null)} title="点赞失败" />
    </>
  );
}
