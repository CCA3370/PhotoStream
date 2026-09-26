import type { FaceIndexState, PublicAlbumView, PublicMediaView } from "@photostream/contracts";
import type { DataSaverSettingView } from "@photostream/contracts/bandwidth";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AlbumOpenTracker } from "@/components/gallery/album-open-tracker";
import { GalleryBrowser } from "@/components/gallery/gallery-browser";
import { LiveUpdates } from "@/components/gallery/live-updates";
import { ScheduledAlbumAutoRefresh } from "@/components/gallery/scheduled-album-auto-refresh";
import { UnlockAlbumForm } from "@/components/gallery/unlock-album-form";
import { ViewerHelpFeedback } from "@/components/gallery/viewer-help-feedback";
import { ViewerOnboarding } from "@/components/gallery/viewer-onboarding";
import { ViewerServiceNotice } from "@/components/gallery/viewer-service-notice";
import { PublicGalleryShell } from "@/components/shells/public-gallery-shell";
import { ApiRequestError, serverApi } from "@/lib/api";
import { orderFeaturedMedia } from "@/lib/featured-order";

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

async function publicAlbumApi<T>(path: string): Promise<T> {
  try {
    return await serverApi<T>(path);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    throw error;
  }
}

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

  const album = await publicAlbumApi<PublicAlbumView>(`/api/v1/public/albums/${slug}`);

  if (album.state === "draft") {
    const scheduledStartText =
      album.scheduledStartAt === null
        ? "开始时间待定"
        : new Intl.DateTimeFormat("zh-CN", {
            dateStyle: "long",
            timeStyle: "short",
            timeZone: "Asia/Shanghai",
          }).format(new Date(album.scheduledStartAt));
    return (
      <PublicGalleryShell albumDescription={album.description} albumTitle={album.title}>
        <ScheduledAlbumAutoRefresh scheduledStartAt={album.scheduledStartAt} slug={slug} />
        <div className="mx-auto flex min-h-[55dvh] max-w-xl items-center justify-center py-8 sm:py-14">
          <div className="w-full rounded-2xl border bg-card px-5 py-7 text-center shadow-sm sm:px-8 sm:py-10">
            <p className="text-xs font-medium text-muted-foreground">活动状态</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">{album.title}</h2>
            <p className="mt-3 text-sm font-medium">未开始</p>
            <div className="mx-auto mt-5 max-w-sm rounded-xl bg-muted/45 px-4 py-3">
              <p className="text-xs text-muted-foreground">开始时间（北京时间）</p>
              <p className="mt-1 text-base font-semibold tabular-nums">{scheduledStartText}</p>
            </div>
            <p className="mt-4 text-xs leading-5 text-muted-foreground">
              活动开始后，此页面会自动更新并显示直播照片。
            </p>
          </div>
        </div>
      </PublicGalleryShell>
    );
  }

  if (album.accessRequired) {
    return (
      <PublicGalleryShell albumDescription={album.description} albumTitle={album.title}>
        <div className="mx-auto max-w-sm py-4 sm:py-7">
          <UnlockAlbumForm slug={slug} />
        </div>
      </PublicGalleryShell>
    );
  }

  const dataSaver = await publicAlbumApi<DataSaverSettingView>(
    `/api/v1/public/albums/${encodeURIComponent(slug)}/data-saver`,
  );
  const initialMediaPageSize = dataSaver.enabled
    ? dataSaverInitialMediaPageSize
    : standardInitialMediaPageSize;
  const category = album.categories.find((candidate) => candidate.id === requestedCategory);
  const mediaPath = new URLSearchParams({ limit: String(initialMediaPageSize) });
  if (category !== undefined) mediaPath.set("categoryId", category.id);
  const [media, featured, faceState] = await Promise.all([
    publicAlbumApi<MediaList>(`/api/v1/public/albums/${slug}/media?${mediaPath.toString()}`),
    publicAlbumApi<FeaturedList>(`/api/v1/public/albums/${slug}/featured`),
    publicAlbumApi<FaceState>(`/api/v1/public/albums/${slug}/face-state`),
  ]);

  const featuredIdSet = new Set(featured.mediaIds);
  const prefetchedItems = [...media.items];
  let nextCursor = media.nextCursor;
  let eventCursor = media.eventCursor;

  if (!dataSaver.enabled && category === undefined) {
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
      const lookahead = await publicAlbumApi<MediaList>(
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
  initialItems = [...orderFeaturedMedia(initialItems, featuredIdSet)];

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
  const selectedFilterKey = category?.id ?? "all";

  return (
    <PublicGalleryShell
      albumDescription={album.description}
      albumTitle={album.title}
      searchAvailable={searchAvailable}
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
        searchAvailable={searchAvailable}
      />
      <ViewerHelpFeedback slug={slug} />

      <GalleryBrowser
        attributeFilterEnabled={album.bibAttributeFilterEnabled}
        attributeOptions={album.bibAttributeOptions}
        attributePairs={album.bibAttributePairs}
        bibSearchEnabled={album.bibSearchEnabled}
        categories={album.categories}
        dataSaverEnabled={dataSaver.enabled}
        {...(faceSearch === undefined ? {} : { faceSearch })}
        initialFeaturedIds={featured.mediaIds}
        initialFeaturedOnly={featuredOnly}
        initialFilterKey={selectedFilterKey}
        initialPage={initialPage}
        {...(initialSelectedId === undefined ? {} : { initialSelectedId })}
        initialVisibilityNow={initialVisibilityNow}
        numberLengths={album.bibNumberLengths}
        searchAvailable={searchAvailable}
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
