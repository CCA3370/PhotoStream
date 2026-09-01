import type { PublicAlbumView, PublicMediaView } from "@photostream/contracts";
import Link from "next/link";

import { AlbumOpenTracker } from "@/components/gallery/album-open-tracker";
import { BibSearchPanel } from "@/components/gallery/bib-search-panel";
import { FaceSearchLauncher } from "@/components/gallery/face-search-launcher";
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
        albumTitle={album.title}
        complaintContact={album.complaintContact}
        privacyNotice={album.privacyNotice}
        status={album.state === "live" ? "直播中" : "已结束"}
      >
        <UnlockAlbumForm slug={slug} />
      </PublicGalleryShell>
    );
  }

  const category = album.categories.find((candidate) => candidate.id === requestedCategory);
  const mediaPath = new URLSearchParams({ limit: "30" });
  if (category !== undefined) mediaPath.set("categoryId", category.id);
  const media = await serverApi<MediaList>(
    `/api/v1/public/albums/${slug}/media?${mediaPath.toString()}`,
  );
  return (
    <PublicGalleryShell
      albumTitle={album.title}
      complaintContact={album.complaintContact}
      privacyNotice={album.privacyNotice}
      status={album.state === "live" ? "直播中" : "已结束"}
    >
      <AlbumOpenTracker slug={slug} />
      <nav
        aria-label="相册分类"
        className="sticky top-0 flex gap-2 overflow-x-auto border-b bg-background py-3"
      >
        <Link
          className={cn(
            buttonVariants({ variant: category === undefined ? "default" : "ghost" }),
            "min-h-11",
          )}
          href={`/g/${slug}`}
        >
          全部
        </Link>
        {album.categories.map((category) => (
          <Link
            className={cn(
              buttonVariants({
                variant: requestedCategory === category.id ? "default" : "ghost",
              }),
              "min-h-11",
            )}
            href={`/g/${slug}?category=${category.id}`}
            key={category.id}
          >
            {category.name}
          </Link>
        ))}
      </nav>
      <section aria-labelledby="gallery-heading" className="flex flex-col gap-4 py-4">
        <h2 className="sr-only" id="gallery-heading">
          活动影像
        </h2>
        {album.faceSearchAvailable && album.faceSearchNoticeVersion !== null ? (
          <div className="flex flex-col items-start gap-1 rounded-xl border bg-card p-4">
            <FaceSearchLauncher
              complaintContact={album.complaintContact}
              noticeVersion={album.faceSearchNoticeVersion}
              privacyNotice={album.privacyNotice}
              slug={slug}
            />
            <p className="text-sm text-muted-foreground">
              最近发布的照片可能仍在建立找图索引；候选结果不用于身份核验。
            </p>
          </div>
        ) : null}
        {album.bibSearchEnabled ? (
          <BibSearchPanel
            attributeFilterEnabled={album.bibAttributeFilterEnabled}
            attributeOptions={album.bibAttributeOptions}
            attributePairs={album.bibAttributePairs}
            numberLengths={album.bibNumberLengths}
            {...(category === undefined ? {} : { categoryId: category.id })}
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
