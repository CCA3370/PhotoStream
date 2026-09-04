import type { PublicAlbumView, PublicMediaView } from "@photostream/contracts";
import { ScanFaceIcon } from "lucide-react";
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
        className="sticky top-0 z-20 -mx-4 mb-6 flex gap-2 overflow-x-auto border-y bg-background/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
      >
        <Link
          className={cn(
            buttonVariants({ variant: category === undefined ? "default" : "outline", size: "sm" }),
            "shrink-0 rounded-full px-4",
          )}
          href={`/g/${slug}`}
        >
          全部照片
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

      <section aria-labelledby="gallery-heading" className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-primary">照片流</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight" id="gallery-heading">
              {category?.name ?? "全部照片"}
            </h2>
          </div>
          <p className="text-sm text-muted-foreground">按发布时间由新到旧持续更新</p>
        </div>

        {album.faceSearchAvailable && album.faceSearchNoticeVersion !== null ? (
          <div className="flex flex-col gap-4 rounded-2xl border bg-[linear-gradient(135deg,color-mix(in_oklab,var(--primary)_7%,var(--card)),var(--card))] p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <ScanFaceIcon aria-hidden="true" className="size-5" />
              </div>
              <div>
                <p className="font-medium">用人像快速找照片</p>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                  上传参考照后查找可能包含同一人物的候选照片。最近发布的照片可能仍在建立索引，结果不用于身份核验。
                </p>
              </div>
            </div>
            <div className="shrink-0">
              <FaceSearchLauncher
                complaintContact={album.complaintContact}
                noticeVersion={album.faceSearchNoticeVersion}
                privacyNotice={album.privacyNotice}
                slug={slug}
              />
            </div>
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
