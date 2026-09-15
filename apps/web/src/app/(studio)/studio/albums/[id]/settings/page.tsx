import type { AlbumSummaryView, AlbumView } from "@photostream/contracts";
import type { DataSaverSettingView } from "@photostream/contracts/bandwidth";

import { AlbumContextNav } from "@/components/albums/album-context-nav";
import { AlbumSettings } from "@/components/albums/album-settings";
import { AlbumWorkspaceHeader } from "@/components/albums/album-workspace-header";
import { serverApi } from "@/lib/api";
import { requireInternalSession } from "@/lib/server-auth";

interface CategoryDetails {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
}

export default async function AlbumSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireInternalSession(["admin"]);
  const { id } = await params;
  const [album, categories, dataSaver, summaries] = await Promise.all([
    serverApi<AlbumView>(`/api/v1/albums/${id}`),
    serverApi<CategoryDetails[]>(`/api/v1/albums/${id}/categories`),
    serverApi<DataSaverSettingView>(`/api/v1/albums/${id}/data-saver`),
    serverApi<AlbumSummaryView[]>("/api/v1/albums"),
  ]);
  const summary = summaries.find((item) => item.id === id);

  return (
    <section aria-labelledby="settings-heading" className="flex flex-col gap-4">
      <AlbumWorkspaceHeader
        albumId={id}
        headingId="settings-heading"
        metrics={
          summary === undefined
            ? undefined
            : [
                { label: "张照片", value: summary.mediaCount },
                { label: "待审核", value: summary.pendingReviewCount },
                { label: "处理异常", value: summary.incompleteCount },
              ]
        }
        section="设置"
        state={album.state}
        title={album.title}
      />
      <AlbumContextNav
        albumId={id}
        counts={{
          pendingReview: summary?.pendingReviewCount,
          uploadIssues: summary?.incompleteCount,
        }}
        current="settings"
        role={session.user.role}
      />
      <AlbumSettings categories={categories} dataSaver={dataSaver} initialAlbum={album} />
    </section>
  );
}
