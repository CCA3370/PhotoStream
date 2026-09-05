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
        <div className="mx-auto max-w-xl py-8 md:py-14">
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
  const media = await serverApi<MediaList>(
    `/api/v1/public/albums/${slug}/media?${mediaPath.toString()}`,
  );
  const faceSearch =
    album.faceSearchAvailable && album.faceSearchNoticeVersion !== null
      ? {
          complaintContact: album.complaintContact,
          noticeVersion: album.faceSearchNoticeVersion,
          privacyNotice: album.privacyNotice,
          slug,
        }
      : null;
  const searchAvailable = album.bibSearchEnabled || faceSearch !== null;
  const sectionTitle = featuredOnly ? "精选照片" : category?.name ?? "全部照片";

  return (
    <PublicGalleryShell
      albumDescription={album.description}
      albumTitle={album.title}
      status={album.state === "live" ? "直播中" : "已结束"}
    >
      <AlbumOpenTracker slug={slug} />

      <nav
        aria-label="相册筛选"
        className="sticky top-2 z-20 mb-5 flex gap-1.5 overflow-x-auto rounded-2xl border bg-background/90 p-1.5 shadow-sm backdrop-blur-xl"
      >
        <Link
          aria-current={!featuredOnly && category === undefined ? "page" : undefined}
          className={cn(
            buttonVariants({
              variant: !featuredOnly && category === undefined ? "default" : "ghost",
              size: "sm",
            }),
            "h-8 shrink-0 rounded-xl px-3.5",
          )}
          href={`/g/${slug}`}
        >
          全部
        </Link>
        <Link
          aria-current={featuredOnly ? "page" : undefined}
          className={cn(
            buttonVariants({ variant: featuredOnly ? "default" : "ghost", size: "sm" }),
            "h-8 shrink-0 rounded-xl px-3.5",
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
                "h-8 shrink-0 rounded-xl px-3.5",
              )}
              href={`/g/${slug}?category=${albumCategory.id}`}
              key={albumCategory.id}
            >
              {albumCategory.name}
            </Link>
          );
        })}
      </nav>

      <section aria-label={sectionTitle} className="flex flex-col gap-5">
        <h2 className="truncate text-lg font-semibold tracking-tight sm:text-xl">{sectionTitle}</h2>

        {searchAvailable && !featuredOnly ? (
          <BibSearchPanel
            attributeFilterEnabled={album.bibAttributeFilterEnabled}
            attributeOptions={album.bibAttributeOptions}
            attributePairs={album.bibAttributePairs}
            bibSearchEnabled={album.bibSearchEnabled}
            numberLengths={album.bibNumberLengths}
            {...(category === undefined ? {} : { categoryId: category.id })}
            {...(faceSearch === null ? {} : { faceSearch })}
            slug={slug}
          >
            <PaginatedMediaGrid
              {...(category === undefined ? {} : { categoryId: category.id })}
              initialPage={media}
              key={category?.id ?? "all"}
              slug={slug}
            />
          </BibSearchPanel>
        ) : (
          <PaginatedMediaGrid
            {...(category === undefined ? {} : { categoryId: category.id })}
            featuredOnly={featuredOnly}
            initialPage={media}
            key={featuredOnly ? "featured" : category?.id ?? "all"}
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
