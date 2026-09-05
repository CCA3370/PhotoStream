import type { AlbumUploaderView, InternalMediaList } from "@photostream/contracts";

import { AlbumContextNav } from "@/components/albums/album-context-nav";
import { ReviewWorkspace } from "@/components/review/review-workspace";
import { serverApi } from "@/lib/api";
import { requireInternalSession } from "@/lib/server-auth";

interface AlbumDetails {
  readonly title: string;
}

interface CategoryDetails {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
}

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireInternalSession(["admin", "reviewer"]);
  const { id } = await params;
  const [album, media, categories, uploaders] = await Promise.all([
    serverApi<AlbumDetails>(`/api/v1/albums/${id}`),
    serverApi<InternalMediaList>(`/api/v1/albums/${id}/media?limit=60`),
    serverApi<CategoryDetails[]>(`/api/v1/albums/${id}/categories`),
    serverApi<AlbumUploaderView[]>(`/api/v1/albums/${id}/uploaders`),
  ]);

  return (
    <section aria-labelledby="review-title" className="flex flex-col gap-4">
      <div className="min-w-0">
        <h2 className="text-xl font-semibold tracking-tight" id="review-title">
          审核
        </h2>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{album.title}</p>
      </div>
      <AlbumContextNav albumId={id} current="review" role={session.user.role} />
      <ReviewWorkspace
        albumId={id}
        categories={categories.filter((category) => category.enabled)}
        initialPage={media}
        userRole={session.user.role}
        uploaders={uploaders}
      />
    </section>
  );
}
