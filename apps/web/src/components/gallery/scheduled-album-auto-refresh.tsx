"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function ScheduledAlbumAutoRefresh({
  scheduledStartAt,
}: Readonly<{ scheduledStartAt: string | null }>) {
  const router = useRouter();

  useEffect(() => {
    if (scheduledStartAt === null) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const schedule = () => {
      if (cancelled) return;
      const remaining = new Date(scheduledStartAt).getTime() - Date.now();
      if (remaining <= 0) {
        router.refresh();
        timer = setTimeout(schedule, 5_000);
        return;
      }
      timer = setTimeout(schedule, Math.min(remaining + 250, 60_000));
    };

    schedule();
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [router, scheduledStartAt]);

  return null;
}
