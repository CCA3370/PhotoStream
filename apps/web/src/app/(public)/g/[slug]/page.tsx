import type { PublicAlbumView, PublicMediaView } from "@photostream/contracts";
import Link from "next/link";

import { AlbumOpenTracker } from "@/components/gallery/album-open-tracker";
import { BibSearchPanel } from "@/components/gallery/bib-search-panel";
import { LiveUpdates } from "@/components/gallery/live-updates";
import { PaginatedMediaGrid } from "@/components/gallery/paginated-media-grid";
import { UnlockAlbumForm } from "@/components/gallery/unlock-album-form";
import { PublicGalleryShell } from "@/components/shells/public-gallery-shell";
import { buttonVariants } from "@/components/ui/button";
import { serverApi } from "@/lib/api";
import { cn } from "@/lib/utils";

interface MediaList {
  readonly items: readonly PublicMediaView[];
  readonly nextCursor: string | null;
  readonly eventCursor: number;
}

interface FeaturedList {
  readonly mediaIds: readonly string[];
}

interface FaceAvailability {
  readonly available: boolean;
  readonly noticeVersion: string;
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
  const [media, featured, faceAvailability] = await Promise.all([
    serverApi<MediaList>(`/api/v1/public/albums/${slug}/media?${mediaPath.toString()}`),
    serverApi<FeaturedList>(`/api/v1/public/albums/${slug}/featured`),
    serverApi<FaceAvailability>(`/api/v1/public/albums/${slug}/face-availability`),
  ]);
  const faceSearch = faceAvailability.available
    ? {
        noticeVersion: faceAvailability.noticeVersion,
        privacyNotice: album.privacyNotice,
      }
    : undefined;
  const searchAvailable = album.bibSearchEnabled || faceSearch !== undefined;
  const sectionTitle = featuredOnly ? "精选照片" : (category?.name ?? "全部照片");

  return (
    <PublicGalleryShell
      albumDescription={album.description}
      albumTitle={album.title}
      status={album.state === "live" ? "直播中" : "已结束"}
    >
      <AlbumOpenTracker slug={slug} />

      <nav
        aria-label="相册筛选"
        className="sticky top-1.5 z-20 mb-3 flex gap-1 overflow-x-auto rounded-xl border bg-background/92 p-1 shadow-sm supports-backdrop-filter:backdrop-blur-xl sm:mb-4"
      >
        <Link
          aria-current={!featuredOnly && category === undefined ? "page" : undefined}
          className={cn(
            buttonVariants({
              variant: !featuredOnly && category === undefined ? "default" : "ghost",
              size: "sm",
            }),
            "h-8 shrink-0 rounded-lg px-3",
          )}
          href={`/g/${slug}`}
        >
          全部
        </Link>
        <Link
          aria-current={featuredOnly ? "page" : undefined}
          className={cn(
            buttonVariants({ variant: featuredOnly ? "default" : "ghost", size: "sm" }),
            "h-8 shrink-0 rounded-lg px-3",
          )}
          href={`/g/${slug}?featured=1`}
        >
          精选
        </Link>
        {album.categories.map((albumCategory) => {
          const selected = !featuredOnly && requestedCategory === albumCategory.id;
          return (
            <Link
              aria-current={selected ? "page" : undefined}
              className={cn(
                buttonVariants({ variant: selected ? "default" : "ghost", size: "sm" }),
                "h-8 shrink-0 rounded-lg px-3",
              )}
              href={`/g/${slug}?category=${albumCategory.id}`}
              key={albumCategory.id}
            >
              {albumCategory.name}
            </Link>
          );
        })}
      </nav>

      <section aria-label={sectionTitle} className="flex flex-col gap-3 sm:gap-4">
        <h2 className="truncate px-0.5 text-base font-semibold tracking-tight sm:text-lg">
          {sectionTitle}
        </h2>

        {searchAvailable && !featuredOnly ? (
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
        ) : (
          <PaginatedMediaGrid
            {...(category === undefined ? {} : { categoryId: category.id })}
            featuredOnly={featuredOnly}
            initialFeaturedIds={featured.mediaIds}
            initialPage={media}
            key={featuredOnly ? "featured" : (category?.id ?? "all")}
            slug={slug}
          />
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
