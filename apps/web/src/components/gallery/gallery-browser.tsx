"use client";

import type { PublicMediaView } from "@photostream/contracts";
import { useCallback, useRef, useState } from "react";

import { BibSearchPanel } from "@/components/gallery/bib-search-panel";
import {
  GalleryFilterNav,
  type GalleryFilterSelection,
} from "@/components/gallery/gallery-filter-nav";
import { PaginatedMediaGrid } from "@/components/gallery/paginated-media-grid";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { clientGet } from "@/lib/client-api";
import { cn } from "@/lib/utils";

interface MediaPage {
  readonly items: readonly PublicMediaView[];
  readonly nextCursor: string | null;
  readonly eventCursor: number;
}

interface GalleryCategory {
  readonly id: string;
  readonly name: string;
}

interface AttributeOption {
  readonly id: string;
  readonly dimension: "grade" | "class";
  readonly displayName: string;
  readonly sortOrder: number;
}

interface AttributePair {
  readonly gradeOptionId: string;
  readonly classOptionId: string | null;
}

interface FaceSearchOptions {
  readonly noticeVersion: string;
  readonly privacyNotice: string;
}

interface BrowserState {
  readonly categoryId?: string;
  readonly featuredOnly: boolean;
  readonly filterKey: string;
  readonly label: string;
  readonly page: MediaPage;
  readonly revision: number;
  readonly visibilityNow: number;
}

export function GalleryBrowser({
  attributeFilterEnabled,
  attributeOptions,
  attributePairs,
  bibSearchEnabled,
  categories,
  dataSaverEnabled,
  faceSearch,
  initialFeaturedIds,
  initialFilterKey,
  initialPage,
  initialSelectedId,
  initialVisibilityNow,
  numberLengths,
  searchAvailable,
  searchToolbarClassName,
  slug,
}: Readonly<{
  attributeFilterEnabled: boolean;
  attributeOptions: readonly AttributeOption[];
  attributePairs: readonly AttributePair[];
  bibSearchEnabled: boolean;
  categories: readonly GalleryCategory[];
  dataSaverEnabled: boolean;
  faceSearch?: FaceSearchOptions;
  initialFeaturedIds: readonly string[];
  initialFilterKey: string;
  initialPage: MediaPage;
  initialSelectedId?: string;
  initialVisibilityNow: number;
  numberLengths: readonly number[];
  searchAvailable: boolean;
  searchToolbarClassName?: string;
  slug: string;
}>) {
  const initialCategory = categories.find((category) => category.id === initialFilterKey);
  const [state, setState] = useState<BrowserState>(() => ({
    ...(initialCategory === undefined ? {} : { categoryId: initialCategory.id }),
    featuredOnly: initialFilterKey === "featured",
    filterKey: initialFilterKey,
    label:
      initialFilterKey === "featured"
        ? "精选"
        : initialCategory === undefined
          ? "全部"
          : initialCategory.name,
    page: initialPage,
    revision: 0,
    visibilityNow: initialVisibilityNow,
  }));
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const pageSize = dataSaverEnabled ? 30 : 60;
  const inlineSearch = searchAvailable && !state.featuredOnly;
  const sectionTitle = state.featuredOnly ? "精选照片" : `${state.label}照片`;

  const selectFilter = useCallback(
    async (selection: GalleryFilterSelection): Promise<void> => {
      if (selection.key === state.filterKey || pendingKey !== null) return;

      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      setPendingKey(selection.key);
      setError(null);

      try {
        const query = new URLSearchParams({ limit: String(pageSize) });
        if (selection.categoryId !== undefined) query.set("categoryId", selection.categoryId);
        const page = await clientGet<MediaPage>(
          `/api/v1/public/albums/${encodeURIComponent(slug)}/media?${query.toString()}`,
          controller.signal,
        );
        if (controller.signal.aborted) return;

        const visibilityNow = Date.now();
        setState((current) => ({
          ...(selection.categoryId === undefined ? {} : { categoryId: selection.categoryId }),
          featuredOnly: selection.featuredOnly,
          filterKey: selection.key,
          label: selection.label,
          page,
          revision: current.revision + 1,
          visibilityNow,
        }));
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : "切换照片筛选失败");
      } finally {
        if (requestRef.current === controller) requestRef.current = null;
        if (!controller.signal.aborted) setPendingKey(null);
      }
    },
    [pageSize, pendingKey, slug, state.filterKey],
  );

  const grid = (
    <PaginatedMediaGrid
      {...(state.categoryId === undefined ? {} : { categoryId: state.categoryId })}
      dataSaverEnabled={dataSaverEnabled}
      featuredOnly={state.featuredOnly}
      initialFeaturedIds={initialFeaturedIds}
      initialPage={state.page}
      {...(state.revision === 0 && initialSelectedId !== undefined ? { initialSelectedId } : {})}
      initialVisibilityNow={state.visibilityNow}
      key={`${state.filterKey}:${state.revision}`}
      slug={slug}
    />
  );

  return (
    <div className={cn(inlineSearch && searchToolbarClassName)}>
      <GalleryFilterNav
        categories={categories}
        onSelect={(selection) => void selectFilter(selection)}
        pendingKey={pendingKey}
        reserveSearchSpace={inlineSearch}
        selectedKey={state.filterKey}
      />

      <section aria-label={sectionTitle} className="flex flex-col gap-2.5 sm:gap-3">
        {inlineSearch ? (
          <BibSearchPanel
            attributeFilterEnabled={attributeFilterEnabled}
            attributeOptions={attributeOptions}
            attributePairs={attributePairs}
            bibSearchEnabled={bibSearchEnabled}
            {...(state.categoryId === undefined ? {} : { categoryId: state.categoryId })}
            {...(faceSearch === undefined ? {} : { faceSearch })}
            key={`search:${state.filterKey}:${state.revision}`}
            numberLengths={numberLengths}
            slug={slug}
          >
            {grid}
          </BibSearchPanel>
        ) : (
          <>
            <div className="px-0.5 text-sm font-medium text-foreground/85">{sectionTitle}</div>
            {grid}
          </>
        )}
      </section>

      <ErrorDialog message={error} onClose={() => setError(null)} title="无法切换照片筛选" />
    </div>
  );
}
