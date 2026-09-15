import type {
  AlbumSummaryView,
  AlbumUploaderView,
  AlbumView,
  BibConfigView,
  InternalMediaList,
} from "@photostream/contracts";

import { AlbumContextNav } from "@/components/albums/album-context-nav";
import { AlbumWorkspaceHeader } from "@/components/albums/album-workspace-header";
import { ReviewWorkspace } from "@/components/review/review-workspace";
import { serverApi } from "@/lib/api";
import { requireInternalSession } from "@/lib/server-auth";

interface CategoryDetails {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
}

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireInternalSession(["admin", "reviewer"]);
  const { id } = await params;
  const [album, media, categories, uploaders, bibConfig, summaries] = await Promise.all([
    serverApi<AlbumView>(`/api/v1/albums/${id}`),
    serverApi<InternalMediaList>(`/api/v1/albums/${id}/media?limit=60`),
    serverApi<CategoryDetails[]>(`/api/v1/albums/${id}/categories`),
    serverApi<AlbumUploaderView[]>(`/api/v1/albums/${id}/uploaders`),
    serverApi<BibConfigView>(`/api/v1/albums/${id}/bib-config`),
    serverApi<AlbumSummaryView[]>("/api/v1/albums"),
  ]);
  const summary = summaries.find((item) => item.id === id);

  return (
    <section aria-labelledby="review-title" className="flex flex-col gap-4">
      <AlbumWorkspaceHeader
        albumId={id}
        headingId="review-title"
        metrics={
          summary === undefined
            ? undefined
            : [
                { label: "张照片", value: summary.mediaCount },
                { label: "待审核", value: summary.pendingReviewCount },
                { label: "处理异常", value: summary.incompleteCount },
              ]
        }
        section="审核"
        state={album.state}
        title={album.title}
      />
      <AlbumContextNav
        albumId={id}
        counts={{
          pendingReview: summary?.pendingReviewCount,
          uploadIssues: summary?.incompleteCount,
        }}
        current="review"
        role={session.user.role}
      />
      <ReviewWorkspace
        albumId={id}
        albumTitle={album.title}
        bibConfig={bibConfig}
        categories={categories.filter((category) => category.enabled)}
        initialPage={media}
        userRole={session.user.role}
        uploaders={uploaders}
      />
    </section>
  );
}
