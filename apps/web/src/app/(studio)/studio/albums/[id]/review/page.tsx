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
    <section className="flex flex-col gap-4" aria-labelledby="review-title">
      <AlbumContextNav albumId={id} current="review" role={session.user.role} />
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold" id="review-title">
          照片审核
        </h2>
        <p className="text-muted-foreground">
          预览 480/960 校验完成后才能发布；原图可以继续后台上传。
        </p>
      </div>
      <ReviewWorkspace
        albumId={id}
        albumTitle={album.title}
        categories={categories.filter((category) => category.enabled)}
        initialPage={media}
        userRole={session.user.role}
        uploaders={uploaders}
      />
    </section>
  );
}
