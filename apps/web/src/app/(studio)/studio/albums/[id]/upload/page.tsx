import type { AlbumSummaryView, AlbumView, BibConfigView } from "@photostream/contracts";

import { AlbumContextNav } from "@/components/albums/album-context-nav";
import { AlbumWorkspaceHeader } from "@/components/albums/album-workspace-header";
import { UploadQueue } from "@/components/uploads/upload-queue";
import { serverApi } from "@/lib/api";
import { requireInternalSession } from "@/lib/server-auth";

interface CategoryDetails {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
}

export default async function UploadPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireInternalSession(["admin", "uploader"]);
  const { id } = await params;
  const [album, categories, bibConfig, summaries] = await Promise.all([
    serverApi<AlbumView>(`/api/v1/albums/${id}`),
    serverApi<CategoryDetails[]>(`/api/v1/albums/${id}/categories`),
    serverApi<BibConfigView>(`/api/v1/albums/${id}/bib-config`),
    serverApi<AlbumSummaryView[]>("/api/v1/albums"),
  ]);
  const summary = summaries.find((item) => item.id === id);

  return (
    <section aria-labelledby="upload-title" className="flex flex-col gap-4">
      <AlbumWorkspaceHeader
        albumId={id}
        headingId="upload-title"
        metrics={
          summary === undefined
            ? undefined
            : [
                { label: "张照片", value: summary.mediaCount },
                { label: "待审核", value: summary.pendingReviewCount },
                { label: "处理异常", value: summary.incompleteCount },
              ]
        }
        section="上传"
        state={album.state}
        title={album.title}
      />
      <AlbumContextNav
        albumId={id}
        counts={{
          pendingReview: summary?.pendingReviewCount,
          uploadIssues: summary?.incompleteCount,
        }}
        current="upload"
        role={session.user.role}
      />
      <UploadQueue
        albumId={album.id}
        albumTitle={album.title}
        bibConfig={bibConfig}
        categories={categories.filter((category) => category.enabled)}
        role={session.user.role}
      />
    </section>
  );
}
