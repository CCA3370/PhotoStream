import type { AlbumUploaderView, BibConfigView, InternalMediaList } from "@photostream/contracts";

import { AlbumContextNav } from "@/components/albums/album-context-nav";
import { AlbumWorkspaceHeader } from "@/components/albums/album-workspace-header";
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
  const [album, media, categories, uploaders, bibConfig] = await Promise.all([
    serverApi<AlbumDetails>(`/api/v1/albums/${id}`),
    serverApi<InternalMediaList>(`/api/v1/albums/${id}/media?limit=60`),
    serverApi<CategoryDetails[]>(`/api/v1/albums/${id}/categories`),
    serverApi<AlbumUploaderView[]>(`/api/v1/albums/${id}/uploaders`),
    serverApi<BibConfigView>(`/api/v1/albums/${id}/bib-config`),
  ]);

  return (
    <section aria-labelledby="review-title" className="flex flex-col gap-4">
      <AlbumWorkspaceHeader headingId="review-title" section="审核工作区" title={album.title} />
      <AlbumContextNav albumId={id} current="review" role={session.user.role} />
      <ReviewWorkspace
        albumId={id}
        bibConfig={bibConfig}
        categories={categories.filter((category) => category.enabled)}
        initialPage={media}
        userRole={session.user.role}
        uploaders={uploaders}
      />
    </section>
  );
}
