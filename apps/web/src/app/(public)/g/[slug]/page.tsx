import type { PublicMediaView } from "@photostream/contracts";
import Link from "next/link";

import { LiveUpdates } from "@/components/gallery/live-updates";
import { PaginatedMediaGrid } from "@/components/gallery/paginated-media-grid";
import { UnlockAlbumForm } from "@/components/gallery/unlock-album-form";
import { PublicGalleryShell } from "@/components/shells/public-gallery-shell";
import { buttonVariants } from "@/components/ui/button";
import { serverApi } from "@/lib/api";
import { cn } from "@/lib/utils";

interface PublicAlbum {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly state: "live" | "ended" | "archived";
  readonly accessRequired: boolean;
  readonly categories: readonly { readonly id: string; readonly name: string }[];
}

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
  const album = await serverApi<PublicAlbum>(`/api/v1/public/albums/${slug}`);
  if (album.accessRequired) {
    return (
      <PublicGalleryShell
        albumTitle={album.title}
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
      status={album.state === "live" ? "直播中" : "已结束"}
    >
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
        <PaginatedMediaGrid
          {...(category === undefined ? {} : { categoryId: category.id })}
          initialPage={media}
          key={category?.id ?? "all"}
          slug={slug}
        />
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
