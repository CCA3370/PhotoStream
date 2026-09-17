"use client";

import type { InternalMediaList } from "@photostream/contracts";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";

import { clientGet } from "@/lib/client-api";
import { reviewSyncRevision } from "@/lib/review-sync";

const pollIntervalMs = 4_000;

export function ReviewRemoteSync({
  albumId,
  initialRevision,
}: Readonly<{
  albumId: string;
  initialRevision: string;
}>) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const revisionRef = useRef(initialRevision);
  const pollingRef = useRef(false);

  useEffect(() => {
    revisionRef.current = initialRevision;
  }, [initialRevision]);

  useEffect(() => {
    let disposed = false;

    const poll = async (): Promise<void> => {
      if (disposed || pollingRef.current || document.visibilityState !== "visible") return;
      pollingRef.current = true;
      try {
        const [media, featured] = await Promise.all([
          clientGet<InternalMediaList>(
            `/api/v1/albums/${encodeURIComponent(albumId)}/media?limit=60`,
          ),
          clientGet<{ readonly mediaIds: readonly string[] }>(
            `/api/v1/albums/${encodeURIComponent(albumId)}/featured`,
          ),
        ]);
        if (disposed) return;
        const nextRevision = reviewSyncRevision(media, featured.mediaIds);
        if (nextRevision === revisionRef.current) return;
        revisionRef.current = nextRevision;
        startTransition(() => router.refresh());
      } catch {
        // The normal page-level error handling remains authoritative. A later poll retries.
      } finally {
        pollingRef.current = false;
      }
    };

    const interval = window.setInterval(() => void poll(), pollIntervalMs);
    const recover = () => void poll();
    const visibilityChanged = () => {
      if (document.visibilityState === "visible") void poll();
    };

    window.addEventListener("focus", recover);
    window.addEventListener("online", recover);
    window.addEventListener("pageshow", recover);
    document.addEventListener("visibilitychange", visibilityChanged);
    void poll();

    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", recover);
      window.removeEventListener("online", recover);
      window.removeEventListener("pageshow", recover);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [albumId, router]);

  return null;
}
