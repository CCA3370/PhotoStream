"use client";

import { HeartIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { publicMutation } from "@/lib/client-api";
import { cn } from "@/lib/utils";

export interface PhotoLikeState {
  readonly mediaId: string;
  readonly count: number;
  readonly likedByViewer: boolean;
}

interface CountMotion {
  readonly from: number;
  readonly to: number;
  readonly direction: 1 | -1;
  readonly settled: boolean;
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
  const [heartFeedback, setHeartFeedback] = useState<"like" | "unlike" | null>(null);
  const [countMotion, setCountMotion] = useState<CountMotion | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countFrameRef = useRef<number | null>(null);
  const liked = state?.likedByViewer ?? false;

  useEffect(
    () => () => {
      if (feedbackTimerRef.current !== null) clearTimeout(feedbackTimerRef.current);
      if (countFrameRef.current !== null) cancelAnimationFrame(countFrameRef.current);
    },
    [],
  );

  function playFeedback(nextLiked: boolean, from: number, to: number): void {
    if (feedbackTimerRef.current !== null) clearTimeout(feedbackTimerRef.current);
    if (countFrameRef.current !== null) cancelAnimationFrame(countFrameRef.current);
    setHeartFeedback(nextLiked ? "like" : "unlike");

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setCountMotion(null);
    } else {
      setCountMotion({ from, to, direction: nextLiked ? 1 : -1, settled: false });
      countFrameRef.current = requestAnimationFrame(() => {
        countFrameRef.current = requestAnimationFrame(() => {
          setCountMotion((current) => (current === null ? null : { ...current, settled: true }));
          countFrameRef.current = null;
        });
      });
    }

    feedbackTimerRef.current = setTimeout(() => {
      setHeartFeedback(null);
      setCountMotion(null);
      feedbackTimerRef.current = null;
    }, 220);
  }

  async function toggle(): Promise<void> {
    if (pending || state === null) return;
    const previous = state;
    const nextLiked = !previous.likedByViewer;
    const nextCount = Math.max(0, previous.count + (nextLiked ? 1 : -1));
    playFeedback(nextLiked, previous.count, nextCount);
    onChange({
      mediaId,
      count: nextCount,
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
    <span
      aria-hidden="true"
      className={cn(
        "grid place-items-center transition-transform duration-150 ease-out motion-reduce:transform-none motion-reduce:transition-none",
        heartFeedback === "like" && "scale-[1.24]",
        heartFeedback === "unlike" && "scale-90",
      )}
    >
      <HeartIcon
        className={cn(
          mode === "thumbnail" ? "size-3.5" : "size-4 lg:size-[18px]",
          "transition-[color,fill] duration-150 motion-reduce:transition-none",
          liked && "fill-rose-500 text-rose-500",
        )}
      />
    </span>
  );

  return (
    <>
      <Button
        aria-label={liked ? "取消点赞" : "点赞"}
        aria-pressed={liked}
        className={cn(
          mode === "thumbnail"
            ? "relative top-0.5 h-7 touch-manipulation gap-1 rounded-full border-0 bg-transparent px-1.5 text-white shadow-none drop-shadow-sm hover:bg-transparent hover:text-white"
            : "h-11 touch-manipulation gap-1.5 rounded-xl border-white/10 bg-white/[0.07] px-3 text-white shadow-none backdrop-blur-md hover:border-white/20 hover:bg-white/[0.13] hover:text-white lg:h-12 lg:gap-2 lg:px-4 lg:text-sm",
          "active:not-aria-[haspopup]:translate-y-0 active:scale-[0.97] transition-[transform,background-color,border-color] duration-150 motion-reduce:transform-none motion-reduce:transition-none",
          className,
        )}
        disabled={pending || state === null}
        onClick={() => void toggle()}
        title={liked ? "取消点赞" : "点赞"}
        type="button"
        variant="outline"
      >
        {heart}
        <span
          className={cn(
            "relative inline-grid min-w-2 place-items-center overflow-hidden font-semibold leading-none tracking-tight tabular-nums",
            mode === "thumbnail" ? "h-3 text-[10px]" : "h-4 text-xs lg:h-5 lg:text-sm",
          )}
        >
          {countMotion === null ? (
            state === null ? (
              "…"
            ) : (
              state.count
            )
          ) : (
            <>
              <span
                aria-hidden="true"
                className="col-start-1 row-start-1 flex h-full items-center justify-center leading-none transition-[transform,opacity] duration-180 ease-out motion-reduce:transition-none"
                style={{
                  opacity: countMotion.settled ? 0 : 1,
                  transform: countMotion.settled
                    ? `translateY(${countMotion.direction > 0 ? -110 : 110}%)`
                    : "translateY(0)",
                }}
              >
                {countMotion.from}
              </span>
              <span
                className="col-start-1 row-start-1 flex h-full items-center justify-center leading-none transition-[transform,opacity] duration-180 ease-out motion-reduce:transition-none"
                style={{
                  opacity: countMotion.settled ? 1 : 0,
                  transform: countMotion.settled
                    ? "translateY(0)"
                    : `translateY(${countMotion.direction > 0 ? 110 : -110}%)`,
                }}
              >
                {countMotion.to}
              </span>
            </>
          )}
        </span>
      </Button>
      <ErrorDialog message={error} onClose={() => setError(null)} title="点赞失败" />
    </>
  );
}
