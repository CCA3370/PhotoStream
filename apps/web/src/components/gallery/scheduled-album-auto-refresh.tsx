"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const preStartRefreshMs = 30_000;
const dueRefreshMs = 5_000;

export function ScheduledAlbumAutoRefresh({
  scheduledStartAt,
}: Readonly<{ scheduledStartAt: string | null }>) {
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const schedule = () => {
      if (cancelled) return;
      const remaining =
        scheduledStartAt === null
          ? null
          : new Date(scheduledStartAt).getTime() - Date.now();
      const delay =
        remaining === null
          ? preStartRefreshMs
          : remaining <= 0
            ? dueRefreshMs
            : Math.min(preStartRefreshMs, remaining + 250);

      timer = setTimeout(() => {
        if (cancelled) return;
        router.refresh();
        schedule();
      }, delay);
    };

    schedule();
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [router, scheduledStartAt]);

  return null;
}
