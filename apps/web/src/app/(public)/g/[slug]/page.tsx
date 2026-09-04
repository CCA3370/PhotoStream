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
  searchParams: Promise<{ category?: string }>;
}) {
  const { slug } = await params;
  const requestedCategory = (await searchParams).category;
  const album = await serverApi<PublicAlbumView>(`/api/v1/public/albums/${slug}`);
  if (album.accessRequired) {
    return (
      <PublicGalleryShell
        albumDescription={album.description}
        albumTitle={album.title}
        complaintContact={album.complaintContact}
        privacyNotice={album.privacyNotice}
        status={album.state === "live" ? "直播中" : "已结束"}
      >
        <div className="mx-auto max-w-xl py-8 md:py-14">
          <UnlockAlbumForm slug={slug} />
        </div>
      </PublicGalleryShell>
    );
  }

  const category = album.categories.find((candidate) => candidate.id === requestedCategory);
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

  return (
    <PublicGalleryShell
      albumDescription={album.description}
      albumTitle={album.title}
      complaintContact={album.complaintContact}
      privacyNotice={album.privacyNotice}
      status={album.state === "live" ? "直播中" : "已结束"}
    >
      <AlbumOpenTracker slug={slug} />
      <nav
        aria-label="相册分类"
        className="sticky top-0 z-20 -mx-4 mb-4 flex gap-2 overflow-x-auto border-y bg-background/95 px-4 py-2.5 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
      >
        <Link
          className={cn(
            buttonVariants({ variant: category === undefined ? "default" : "outline", size: "sm" }),
            "shrink-0 rounded-full px-4",
          )}
          href={`/g/${slug}`}
        >
          全部
        </Link>
        {album.categories.map((category) => (
          <Link
            className={cn(
              buttonVariants({
                variant: requestedCategory === category.id ? "default" : "outline",
                size: "sm",
              }),
              "shrink-0 rounded-full px-4",
            )}
            href={`/g/${slug}?category=${category.id}`}
            key={category.id}
          >
            {category.name}
          </Link>
        ))}
      </nav>

      <section aria-label={category?.name ?? "全部照片"} className="flex flex-col gap-4">
        {searchAvailable ? (
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
            initialPage={media}
            key={category?.id ?? "all"}
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
