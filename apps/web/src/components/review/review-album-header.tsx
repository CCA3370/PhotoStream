"use client";

import type { AlbumSummaryView, AlbumView, UserRole } from "@photostream/contracts";
import { useEffect, useState } from "react";

import { AlbumContextNav } from "@/components/albums/album-context-nav";
import { AlbumWorkspaceHeader } from "@/components/albums/album-workspace-header";
import { REVIEW_REMOTE_CHANGED_EVENT } from "@/components/review/review-remote-sync";
import { clientGet } from "@/lib/client-api";

export function ReviewAlbumHeader({
  album,
  initialSummary,
  role,
}: Readonly<{
  album: AlbumView;
  initialSummary:
    | Pick<AlbumSummaryView, "mediaCount" | "pendingReviewCount" | "incompleteCount">
    | undefined;
  role: UserRole;
}>) {
  const [pendingCount, setPendingCount] = useState(initialSummary?.pendingReviewCount ?? 0);

  useEffect(() => {
    setPendingCount(initialSummary?.pendingReviewCount ?? 0);
    let disposed = false;
    let refreshing = false;
    let pending = false;
    let request: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (disposed || refreshing || timer !== null) return;
      timer = setTimeout(() => void refresh(), 150);
    };
    const refresh = async () => {
      timer = null;
      refreshing = true;
      pending = false;
      const nextRequest = new AbortController();
      request = nextRequest;
      try {
        const result = await clientGet<{ readonly total: number }>(
          `/api/v1/albums/${album.id}/media-selection?reviewStatus=pending&limit=1`,
          nextRequest.signal,
        );
        if (!disposed) setPendingCount(result.total);
      } catch {
        // Keep the last confirmed count; the next revision retries the read.
      } finally {
        refreshing = false;
        if (pending) schedule();
      }
    };
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ readonly albumId?: string }>).detail;
      if (detail?.albumId !== album.id) return;
      pending = true;
      schedule();
    };
    window.addEventListener(REVIEW_REMOTE_CHANGED_EVENT, changed);
    void refresh();
    return () => {
      disposed = true;
      request?.abort();
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener(REVIEW_REMOTE_CHANGED_EVENT, changed);
    };
  }, [album.id, initialSummary?.pendingReviewCount]);

  return (
    <>
      <AlbumWorkspaceHeader
        albumId={album.id}
        headingId="review-title"
        metrics={[
          ...(initialSummary === undefined
            ? []
            : [{ label: "张照片", value: initialSummary.mediaCount }]),
          { label: "待审核", value: pendingCount },
          ...(initialSummary === undefined
            ? []
            : [{ label: "处理异常", value: initialSummary.incompleteCount }]),
        ]}
        section="审核"
        state={album.state}
        title={album.title}
      />
      <AlbumContextNav
        albumId={album.id}
        counts={{ pendingReview: pendingCount, uploadIssues: initialSummary?.incompleteCount }}
        current="review"
        role={role}
      />
    </>
  );
}
