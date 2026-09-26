"use client";

import type { PublicAlbumView } from "@photostream/contracts";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { clientGet } from "@/lib/client-api";

const preStartPollMs = 30_000;
const duePollMs = 5_000;
const transitionFallbackMs = 2_000;

export function ScheduledAlbumAutoRefresh({
  scheduledStartAt,
  slug,
}: Readonly<{ scheduledStartAt: string | null; slug: string }>) {
  const router = useRouter();

  useEffect(() => {
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let transitionTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    let checking = false;
    let navigating = false;
    let currentScheduledStartAt = scheduledStartAt;

    const clearPollTimer = () => {
      if (pollTimer === null) return;
      clearTimeout(pollTimer);
      pollTimer = null;
    };

    const schedule = () => {
      if (cancelled || navigating) return;
      clearPollTimer();

      const remaining =
        currentScheduledStartAt === null
          ? null
          : new Date(currentScheduledStartAt).getTime() - Date.now();
      const delay =
        remaining === null
          ? preStartPollMs
          : remaining <= 0
            ? duePollMs
            : Math.min(preStartPollMs, remaining + 250);

      pollTimer = setTimeout(() => {
        void check();
      }, delay);
    };

    const enterAlbum = () => {
      if (cancelled || navigating) return;
      navigating = true;

      // Prefer a seamless Server Component refresh. If the client-side
      // transition is ever stuck, fall back to a full reload automatically
      // so the viewer never has to refresh the page manually.
      router.refresh();
      transitionTimer = setTimeout(() => {
        if (!cancelled) window.location.reload();
      }, transitionFallbackMs);
    };

    async function check() {
      if (cancelled || checking || navigating) return;
      checking = true;
      clearPollTimer();

      try {
        const album = await clientGet<Pick<PublicAlbumView, "state" | "scheduledStartAt">>(
          `/api/v1/public/albums/${encodeURIComponent(slug)}`,
        );
        if (cancelled) return;

        if (album.state !== "draft") {
          enterAlbum();
          return;
        }

        currentScheduledStartAt = album.scheduledStartAt;
      } catch {
        // Keep the pre-start screen stable during transient network failures.
        // The next poll (or returning to the tab) will retry automatically.
      } finally {
        checking = false;
        if (!cancelled && !navigating) schedule();
      }
    }

    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    const checkWhenFocused = () => {
      void check();
    };

    schedule();
    document.addEventListener("visibilitychange", checkWhenVisible);
    window.addEventListener("focus", checkWhenFocused);

    return () => {
      cancelled = true;
      clearPollTimer();
      if (transitionTimer !== null) clearTimeout(transitionTimer);
      document.removeEventListener("visibilitychange", checkWhenVisible);
      window.removeEventListener("focus", checkWhenFocused);
    };
  }, [router, scheduledStartAt, slug]);

  return null;
}
