import type { FaceIndexState, PublicAlbumView, PublicMediaView } from "@photostream/contracts";
import type { DataSaverSettingView } from "@photostream/contracts/bandwidth";
import type { Metadata } from "next";

import { AlbumOpenTracker } from "@/components/gallery/album-open-tracker";
import { GalleryBrowser } from "@/components/gallery/gallery-browser";
import { LiveUpdates } from "@/components/gallery/live-updates";
import { UnlockAlbumForm } from "@/components/gallery/unlock-album-form";
import { ViewerOnboarding } from "@/components/gallery/viewer-onboarding";
import { ViewerServiceNotice } from "@/components/gallery/viewer-service-notice";
import { PublicGalleryShell } from "@/components/shells/public-gallery-shell";
import { serverApi } from "@/lib/api";
import { orderFeaturedMedia } from "@/lib/featured-order";

import styles from "./gallery-toolbar.module.css";

interface MediaList {
  readonly items: readonly PublicMediaView[];
  readonly nextCursor: string | null;
  readonly eventCursor: number;
}

interface FeaturedList {
  readonly mediaIds: readonly string[];
}

interface FaceState {
  readonly enabled: boolean;
  readonly noticeVersion: string;
  readonly indexState: FaceIndexState;
}

interface GalleryPageSearchParams {
  readonly category?: string;
  readonly featured?: string;
  readonly photo?: string;
}

interface GalleryPageProps {
  readonly params: Promise<{ slug: string }>;
  readonly searchParams: Promise<GalleryPageSearchParams>;
}

const standardInitialMediaPageSize = 60;
const dataSaverInitialMediaPageSize = 30;
const initialFeaturedTarget = 8;
const initialPrefetchPageLimit = 3;

export async function generateMetadata({ params }: GalleryPageProps): Promise<Metadata> {
  const { slug } = await params;

  try {
    const album = await serverApi<PublicAlbumView>(
      `/api/v1/public/albums/${encodeURIComponent(slug)}`,
    );
    const description = album.description?.trim() || `查看「${album.title}」活动影像直播`;
    return {
      title: { absolute: `${album.title}｜影像直播` },
      description,
      openGraph: {
        title: `${album.title}｜影像直播`,
        description,
        type: "website",
      },
    };
  } catch {
    return {};
  }
}

export default async function GalleryPage({ params, searchParams }: GalleryPageProps) {
  const { slug } = await params;
  const query = await searchParams;
  const requestedCategory = query.category;
  const featuredOnly = query.featured === "1";

  const album = await serverApi<PublicAlbumView>(`/api/v1/public/albums/${slug}`);

  if (album.accessRequired) {
    return (
      <PublicGalleryShell
        albumDescription={album.description}
        albumTitle={album.title}
        status={album.state === "live" ? "直播中" : "已结束"}
      >
        <div className="mx-auto max-w-sm py-4 sm:py-7">
          <UnlockAlbumForm slug={slug} />
        </div>
      </PublicGalleryShell>
    );
  }

  const dataSaver = await serverApi<DataSaverSettingView>(
    `/api/v1/public/albums/${encodeURIComponent(slug)}/data-saver`,
  );
  const initialMediaPageSize = dataSaver.enabled
    ? dataSaverInitialMediaPageSize
    : standardInitialMediaPageSize;
  const category = featuredOnly
    ? undefined
    : album.categories.find((candidate) => candidate.id === requestedCategory);
  const mediaPath = new URLSearchParams({ limit: String(initialMediaPageSize) });
  if (category !== undefined) mediaPath.set("categoryId", category.id);
  const [media, featured, faceState] = await Promise.all([
    serverApi<MediaList>(`/api/v1/public/albums/${slug}/media?${mediaPath.toString()}`),
    serverApi<FeaturedList>(`/api/v1/public/albums/${slug}/featured`),
    serverApi<FaceState>(`/api/v1/public/albums/${slug}/face-state`),
  ]);

  const featuredIdSet = new Set(featured.mediaIds);
  const prefetchedItems = [...media.items];
  let nextCursor = media.nextCursor;
  let eventCursor = media.eventCursor;

  if (!dataSaver.enabled && !featuredOnly && category === undefined) {
    let fetchedPages = 1;
    let featuredCount = prefetchedItems.filter((item) => featuredIdSet.has(item.id)).length;
    while (
      nextCursor !== null &&
      fetchedPages < initialPrefetchPageLimit &&
      featuredCount < initialFeaturedTarget
    ) {
      const lookaheadPath = new URLSearchParams({
        cursor: nextCursor,
        limit: String(initialMediaPageSize),
      });
      const lookahead = await serverApi<MediaList>(
        `/api/v1/public/albums/${slug}/media?${lookaheadPath.toString()}`,
      );
      prefetchedItems.push(...lookahead.items);
      nextCursor = lookahead.nextCursor;
      eventCursor = Math.max(eventCursor, lookahead.eventCursor);
      fetchedPages += 1;
      featuredCount = prefetchedItems.filter((item) => featuredIdSet.has(item.id)).length;
    }
  }

  let initialItems = prefetchedItems;
  if (query.photo !== undefined && !initialItems.some((item) => item.id === query.photo)) {
    try {
      const linked = await serverApi<PublicMediaView>(
        `/api/v1/public/albums/${encodeURIComponent(slug)}/media/${encodeURIComponent(query.photo)}`,
      );
      initialItems = [...initialItems, linked];
    } catch {
      // Ignore stale or invalid deep links and keep the album usable.
    }
  }
  if (!featuredOnly) initialItems = [...orderFeaturedMedia(initialItems, featuredIdSet)];

  const initialPage: MediaList = {
    ...media,
    items: initialItems,
    nextCursor,
    eventCursor,
  };
  const initialVisibilityNow = Date.now();
  const initialSelectedId =
    query.photo !== undefined && initialItems.some((item) => item.id === query.photo)
      ? query.photo
      : undefined;

  const faceSearch = faceState.enabled
    ? {
        noticeVersion: faceState.noticeVersion,
        privacyNotice: album.privacyNotice,
      }
    : undefined;
  const searchAvailable = album.bibSearchEnabled || faceSearch !== undefined;
  const inlineSearch = searchAvailable && !featuredOnly;
  const selectedFilterKey = featuredOnly ? "featured" : (category?.id ?? "all");

  return (
    <PublicGalleryShell
      albumDescription={album.description}
      albumTitle={album.title}
      reserveSearchAction={searchAvailable}
      status={album.state === "live" ? "直播中" : "已结束"}
    >
      <div data-photostream-data-saver={dataSaver.enabled ? "true" : "false"} hidden />
      <AlbumOpenTracker slug={slug} />
      <ViewerServiceNotice />
      <ViewerOnboarding
        attributeFilterEnabled={album.bibAttributeFilterEnabled}
        bibSearchEnabled={album.bibSearchEnabled}
        faceSearchEnabled={faceSearch !== undefined}
        hasPhotos={initialItems.length > 0}
        live={album.state === "live"}
        searchAvailable={inlineSearch}
      />

      <GalleryBrowser
        attributeFilterEnabled={album.bibAttributeFilterEnabled}
        attributeOptions={album.bibAttributeOptions}
        attributePairs={album.bibAttributePairs}
        bibSearchEnabled={album.bibSearchEnabled}
        categories={album.categories}
        dataSaverEnabled={dataSaver.enabled}
        {...(faceSearch === undefined ? {} : { faceSearch })}
        initialFeaturedIds={featured.mediaIds}
        initialFilterKey={selectedFilterKey}
        initialPage={initialPage}
        {...(initialSelectedId === undefined ? {} : { initialSelectedId })}
        initialVisibilityNow={initialVisibilityNow}
        numberLengths={album.bibNumberLengths}
        searchAvailable={searchAvailable}
        {...(styles.searchToolbar === undefined
          ? {}
          : { searchToolbarClassName: styles.searchToolbar })}
        slug={slug}
      />

      {album.state === "live" ? (
        <LiveUpdates
          initialEventId={initialPage.eventCursor}
          knownMediaIds={initialItems.map((item) => item.id)}
          slug={slug}
        />
      ) : null}
    </PublicGalleryShell>
  );
}
