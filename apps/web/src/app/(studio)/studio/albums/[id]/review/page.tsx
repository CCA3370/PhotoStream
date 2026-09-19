import type {
  AlbumSummaryView,
  AlbumUploaderView,
  AlbumView,
  BibConfigView,
  InternalMediaList,
} from "@photostream/contracts";

import { AlbumContextNav } from "@/components/albums/album-context-nav";
import { AlbumWorkspaceHeader } from "@/components/albums/album-workspace-header";
import { ReviewRemoteSync } from "@/components/review/review-remote-sync";
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
  const [album, media, categories, uploaders, bibConfig, summaries, reviewRevision, reviewQueue] =
    await Promise.all([
      serverApi<AlbumView>(`/api/v1/albums/${id}`),
      serverApi<InternalMediaList>(`/api/v1/albums/${id}/media?limit=60`),
      serverApi<CategoryDetails[]>(`/api/v1/albums/${id}/categories`),
      serverApi<AlbumUploaderView[]>(`/api/v1/albums/${id}/uploaders`),
      serverApi<BibConfigView>(`/api/v1/albums/${id}/bib-config`),
      serverApi<AlbumSummaryView[]>("/api/v1/albums"),
      serverApi<{ readonly revision: string }>(`/api/v1/albums/${id}/review-revision`),
      serverApi<{ readonly total: number }>(
        `/api/v1/albums/${id}/media-selection?publicationStatus=hidden&ingestStatus=ready&limit=1`,
      ),
    ]);
  const summary = summaries.find((item) => item.id === id);
  const syncRevision = reviewRevision.revision;

  return (
    <section aria-labelledby="review-title" className="flex flex-col gap-4">
      <ReviewRemoteSync albumId={id} initialRevision={syncRevision} />
      <AlbumWorkspaceHeader
        albumId={id}
        headingId="review-title"
        metrics={
          summary === undefined
            ? undefined
            : [
                { label: "张照片", value: summary.mediaCount },
                { label: "待审核", value: reviewQueue.total },
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
          pendingReview: reviewQueue.total,
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
