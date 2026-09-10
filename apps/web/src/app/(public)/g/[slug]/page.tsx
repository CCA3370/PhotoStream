import type { FaceIndexState, PublicAlbumView, PublicMediaView } from "@photostream/contracts";

import { AlbumOpenTracker } from "@/components/gallery/album-open-tracker";
import { BibSearchPanel } from "@/components/gallery/bib-search-panel";
import { FaceSearchPromo } from "@/components/gallery/face-search-promo";
import { GalleryFilterNav } from "@/components/gallery/gallery-filter-nav";
import { LiveUpdates } from "@/components/gallery/live-updates";
import { PaginatedMediaGrid } from "@/components/gallery/paginated-media-grid";
import { UnlockAlbumForm } from "@/components/gallery/unlock-album-form";
import { ViewerServiceNotice } from "@/components/gallery/viewer-service-notice";
import { PublicGalleryShell } from "@/components/shells/public-gallery-shell";
import { serverApi } from "@/lib/api";

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

export default async function GalleryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ category?: string; featured?: string }>;
}) {
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
        <div className="mx-auto max-w-md py-6 sm:py-10">
          <UnlockAlbumForm slug={slug} />
        </div>
      </PublicGalleryShell>
    );
  }

  const category = featuredOnly
    ? undefined
    : album.categories.find((candidate) => candidate.id === requestedCategory);
  const mediaPath = new URLSearchParams({ limit: "30" });
  if (category !== undefined) mediaPath.set("categoryId", category.id);
  const [media, featured, faceState] = await Promise.all([
    serverApi<MediaList>(`/api/v1/public/albums/${slug}/media?${mediaPath.toString()}`),
    serverApi<FeaturedList>(`/api/v1/public/albums/${slug}/featured`),
    serverApi<FaceState>(`/api/v1/public/albums/${slug}/face-state`),
  ]);
  const faceSearch = faceState.enabled
    ? {
        noticeVersion: faceState.noticeVersion,
        privacyNotice: album.privacyNotice,
      }
    : undefined;
  const searchAvailable = album.bibSearchEnabled || faceSearch !== undefined;
  const sectionTitle = featuredOnly ? "精选照片" : (category?.name ?? "全部照片");
  const selectedFilterKey = featuredOnly ? "featured" : (category?.id ?? "all");

  return (
    <PublicGalleryShell
      albumDescription={album.description}
      albumTitle={album.title}
      status={album.state === "live" ? "直播中" : "已结束"}
    >
      <AlbumOpenTracker slug={slug} />
      <ViewerServiceNotice />

      <GalleryFilterNav categories={album.categories} selectedKey={selectedFilterKey} slug={slug} />

      <section aria-label={sectionTitle} className="flex flex-col gap-2.5 sm:gap-3">
        {searchAvailable && !featuredOnly ? (
          <>
            {faceSearch === undefined ? null : <FaceSearchPromo />}
            <BibSearchPanel
              attributeFilterEnabled={album.bibAttributeFilterEnabled}
              attributeOptions={album.bibAttributeOptions}
              attributePairs={album.bibAttributePairs}
              bibSearchEnabled={album.bibSearchEnabled}
              numberLengths={album.bibNumberLengths}
              {...(category === undefined ? {} : { categoryId: category.id })}
              {...(faceSearch === undefined ? {} : { faceSearch })}
              slug={slug}
            >
              <PaginatedMediaGrid
                {...(category === undefined ? {} : { categoryId: category.id })}
                initialFeaturedIds={featured.mediaIds}
                initialPage={media}
                key={category?.id ?? "all"}
                slug={slug}
              />
            </BibSearchPanel>
          </>
        ) : (
          <>
            <div className="px-0.5 text-sm font-medium text-foreground/85">{sectionTitle}</div>
            <PaginatedMediaGrid
              {...(category === undefined ? {} : { categoryId: category.id })}
              featuredOnly={featuredOnly}
              initialFeaturedIds={featured.mediaIds}
              initialPage={media}
              key={featuredOnly ? "featured" : (category?.id ?? "all")}
              slug={slug}
            />
          </>
        )}
      </section>
      {album.state === "live" ? (
        <LiveUpdates
          initialEventId={media.eventCursor}
          knownMediaIds={media.items.map((item) => item.id)}
          slug={slug}
        />
      ) : null}
    </PublicGalleryShell>
  );
}
