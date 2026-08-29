"use client";

import type { PublicMediaView } from "@photostream/contracts";
import { useEffect, useRef, useState } from "react";

import { MediaGrid } from "@/components/gallery/media-grid";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { clientGet } from "@/lib/client-api";

interface MediaPage {
  readonly items: readonly PublicMediaView[];
  readonly nextCursor: string | null;
  readonly eventCursor: number;
}

export function PaginatedMediaGrid({
  categoryId,
  initialPage,
  slug,
}: Readonly<{
  categoryId?: string;
  initialPage: MediaPage;
  slug: string;
}>) {
  const [items, setItems] = useState<readonly PublicMediaView[]>(initialPage.items);
  const [cursor, setCursor] = useState(initialPage.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadMoreRef = useRef<HTMLButtonElement>(null);
  const requestInFlight = useRef(false);

  useEffect(() => {
    setItems((current) => {
      const byId = new Map(current.map((item) => [item.id, item]));
      for (const item of initialPage.items) byId.set(item.id, item);
      return [...byId.values()].sort((left, right) => right.publishSequence - left.publishSequence);
    });
  }, [initialPage.items]);

  useEffect(() => {
    const remove = (event: Event) => {
      const detail = (event as CustomEvent<{ readonly mediaId?: string }>).detail;
      if (typeof detail?.mediaId !== "string") return;
      setItems((current) => current.filter((item) => item.id !== detail.mediaId));
    };
    window.addEventListener("photostream:media-removed", remove);
    return () => window.removeEventListener("photostream:media-removed", remove);
  }, []);

  async function loadMore(): Promise<void> {
    if (cursor === null || requestInFlight.current) return;
    requestInFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ cursor, limit: "60" });
      if (categoryId !== undefined) query.set("categoryId", categoryId);
      const page = await clientGet<MediaPage>(
        `/api/v1/public/albums/${slug}/media?${query.toString()}`,
      );
      setItems((current) => {
        const byId = new Map(current.map((item) => [item.id, item]));
        for (const item of page.items) byId.set(item.id, item);
        return [...byId.values()].sort(
          (left, right) => right.publishSequence - left.publishSequence,
        );
      });
      setCursor(page.nextCursor);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "加载更多影像失败");
    } finally {
      requestInFlight.current = false;
      setLoading(false);
    }
  }

  useEffect(() => {
    const button = loadMoreRef.current;
    if (button === null || cursor === null || error !== null) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(button);
    return () => observer.disconnect();
  });

  return (
    <div className="flex flex-col gap-5">
      <MediaGrid items={items} slug={slug} />
      {error === null ? null : (
        <Alert variant="destructive">
          <AlertTitle>无法继续加载</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {cursor === null ? null : (
        <Button
          className="self-center"
          disabled={loading}
          onClick={() => void loadMore()}
          ref={loadMoreRef}
          type="button"
          variant="outline"
        >
          {loading ? "正在加载…" : "加载更多影像"}
        </Button>
      )}
    </div>
  );
}
