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
import { userFacingErrorMessage } from "@/lib/user-facing-error";

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

interface LoadedFilter {
  readonly categoryId?: string;
  readonly filterKey: string;
  readonly label: string;
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
  initialFeaturedOnly = false,
  initialFilterKey,
  initialPage,
  initialSelectedId,
  initialVisibilityNow,
  numberLengths,
  searchAvailable,
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
  initialFeaturedOnly?: boolean;
  initialFilterKey: string;
  initialPage: MediaPage;
  initialSelectedId?: string;
  initialVisibilityNow: number;
  numberLengths: readonly number[];
  searchAvailable: boolean;
  slug: string;
}>) {
  const initialCategory = categories.find((category) => category.id === initialFilterKey);
  const initialLoadedFilter: LoadedFilter = {
    ...(initialCategory === undefined ? {} : { categoryId: initialCategory.id }),
    filterKey: initialCategory?.id ?? "all",
    label: initialCategory?.name ?? "全部",
  };
  const [state, setState] = useState<BrowserState>(() => ({
    ...(initialLoadedFilter.categoryId === undefined
      ? {}
      : { categoryId: initialLoadedFilter.categoryId }),
    featuredOnly: initialFeaturedOnly,
    filterKey: initialLoadedFilter.filterKey,
    label: initialLoadedFilter.label,
    page: initialPage,
    revision: 0,
    visibilityNow: initialVisibilityNow,
  }));
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const selectedFilterKeyRef = useRef(initialLoadedFilter.filterKey);
  const loadedFilterRef = useRef<LoadedFilter>(initialLoadedFilter);
  const pageSize = dataSaverEnabled ? 30 : 60;
  const sectionTitle = state.featuredOnly
    ? state.filterKey === "all"
      ? "精选照片"
      : `${state.label}精选`
    : `${state.label}照片`;

  const selectFilter = useCallback(
    async (selection: GalleryFilterSelection): Promise<void> => {
      if (selection.key === selectedFilterKeyRef.current) return;

      requestRef.current?.abort();
      requestRef.current = null;
      selectedFilterKeyRef.current = selection.key;
      setError(null);

      setState((current) => ({
        ...current,
        filterKey: selection.key,
        label: selection.label,
      }));

      const loadedFilter = loadedFilterRef.current;
      if (selection.key === loadedFilter.filterKey) return;

      const controller = new AbortController();
      requestRef.current = controller;

      try {
        const query = new URLSearchParams({ limit: String(pageSize) });
        if (selection.categoryId !== undefined) query.set("categoryId", selection.categoryId);
        const page = await clientGet<MediaPage>(
          `/api/v1/public/albums/${slug}/media?${query.toString()}`,
          controller.signal,
        );
        if (controller.signal.aborted || requestRef.current !== controller) return;

        const nextLoadedFilter: LoadedFilter = {
          ...(selection.categoryId === undefined ? {} : { categoryId: selection.categoryId }),
          filterKey: selection.key,
          label: selection.label,
        };
        loadedFilterRef.current = nextLoadedFilter;

        const visibilityNow = Date.now();
        setState((current) => {
          if (selectedFilterKeyRef.current !== selection.key) return current;
          return {
            ...(selection.categoryId === undefined ? {} : { categoryId: selection.categoryId }),
            featuredOnly: current.featuredOnly,
            filterKey: selection.key,
            label: selection.label,
            page,
            revision: current.revision + 1,
            visibilityNow,
          };
        });
      } catch (caught) {
        if (controller.signal.aborted || requestRef.current !== controller) return;

        const fallback = loadedFilterRef.current;
        selectedFilterKeyRef.current = fallback.filterKey;
        setState((current) => ({
          ...(fallback.categoryId === undefined ? {} : { categoryId: fallback.categoryId }),
          featuredOnly: current.featuredOnly,
          filterKey: fallback.filterKey,
          label: fallback.label,
          page: current.page,
          revision: current.revision,
          visibilityNow: current.visibilityNow,
        }));
        setError(userFacingErrorMessage(caught, "切换照片筛选失败，请稍后重试。"));
      } finally {
        if (requestRef.current === controller) requestRef.current = null;
      }
    },
    [pageSize, slug],
  );

  const setFeaturedOnly = useCallback((featuredOnly: boolean) => {
    setState((current) => {
      if (current.featuredOnly === featuredOnly) return current;
      return {
        ...current,
        featuredOnly,
        visibilityNow: Date.now(),
      };
    });
  }, []);

  const grid = (
    <PaginatedMediaGrid
      {...(state.categoryId === undefined ? {} : { categoryId: state.categoryId })}
      dataSaverEnabled={dataSaverEnabled}
      featuredOnly={state.featuredOnly}
      initialFeaturedIds={initialFeaturedIds}
      initialPage={state.page}
      {...(state.revision === 0 && initialSelectedId !== undefined ? { initialSelectedId } : {})}
      initialVisibilityNow={state.visibilityNow}
      key={`${state.categoryId ?? "all"}:${state.revision}`}
      slug={slug}
    />
  );

  const content = searchAvailable ? (
    <BibSearchPanel
      attributeFilterEnabled={attributeFilterEnabled}
      attributeOptions={attributeOptions}
      attributePairs={attributePairs}
      bibSearchEnabled={bibSearchEnabled}
      {...(faceSearch === undefined ? {} : { faceSearch })}
      numberLengths={numberLengths}
      slug={slug}
    >
      {grid}
    </BibSearchPanel>
  ) : (
    grid
  );

  return (
    <div>
      <GalleryFilterNav
        categories={categories}
        featuredOnly={state.featuredOnly}
        onFeaturedChange={setFeaturedOnly}
        onSelect={(selection) => void selectFilter(selection)}
        selectedKey={state.filterKey}
      />

      <section aria-label={sectionTitle} className="flex flex-col gap-2.5 sm:gap-3">
        {content}
      </section>

      <ErrorDialog message={error} onClose={() => setError(null)} title="无法切换照片筛选" />
    </div>
  );
}
