import type {
  AlbumSummaryView,
  AlbumUploaderView,
  AlbumView,
  BibConfigView,
  InternalMediaList,
  ReviewCollaborationView,
} from "@photostream/contracts";

import { ReviewAlbumHeader } from "@/components/review/review-album-header";
import { ReviewRemoteSync } from "@/components/review/review-remote-sync";
import { ReviewWorkspace } from "@/components/review/review-workspace";
import { serverApi } from "@/lib/api";
import { requireInternalSession } from "@/lib/server-auth";

interface CategoryDetails {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly shortcut: string | null;
}

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireInternalSession(["admin", "operator", "reviewer"]);
  const { id } = await params;
  const [
    album,
    media,
    categories,
    uploaders,
    bibConfig,
    summaries,
    reviewRevision,
    reviewCollaboration,
  ] = await Promise.all([
    serverApi<AlbumView>(`/api/v1/albums/${id}`),
    serverApi<InternalMediaList>(`/api/v1/albums/${id}/media?limit=60`),
    serverApi<CategoryDetails[]>(`/api/v1/albums/${id}/categories`),
    serverApi<AlbumUploaderView[]>(`/api/v1/albums/${id}/uploaders`),
    serverApi<BibConfigView>(`/api/v1/albums/${id}/bib-config`),
    serverApi<AlbumSummaryView[]>("/api/v1/albums"),
    serverApi<{ readonly revision: string }>(`/api/v1/albums/${id}/review-revision`),
    serverApi<ReviewCollaborationView>(`/api/v1/albums/${id}/review-collaboration`),
  ]);
  const summary = summaries.find((item) => item.id === id);
  const syncRevision = reviewRevision.revision;

  return (
    <section aria-labelledby="review-title" className="flex flex-col gap-4">
      <ReviewRemoteSync albumId={id} initialRevision={syncRevision} />
      <ReviewAlbumHeader
        album={album}
        initialSummary={
          summary === undefined
            ? undefined
            : {
                mediaCount: summary.mediaCount,
                pendingReviewCount: summary.pendingReviewCount,
                incompleteCount: summary.incompleteCount,
              }
        }
        role={session.user.role}
      />
      <ReviewWorkspace
        albumId={id}
        albumTitle={album.title}
        bibConfig={bibConfig}
        categories={categories.filter((category) => category.enabled)}
        initialPage={media}
        initialReviewCollaboration={reviewCollaboration}
        userRole={session.user.role}
        uploaders={uploaders}
      />
    </section>
  );
}
