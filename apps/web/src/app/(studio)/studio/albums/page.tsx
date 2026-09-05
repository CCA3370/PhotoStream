import type { AlbumSummaryView } from "@photostream/contracts";

import { AlbumManagementList } from "@/components/albums/album-management-list";
import { CreateAlbumForm } from "@/components/albums/create-album-form";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { serverApi } from "@/lib/api";
import { requireInternalSession } from "@/lib/server-auth";

export default async function AlbumsPage() {
  const [session, albums] = await Promise.all([
    requireInternalSession(),
    serverApi<AlbumSummaryView[]>("/api/v1/albums"),
  ]);

  return (
    <section aria-labelledby="albums-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight" id="albums-heading">
            活动管理
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">共 {albums.length} 个活动</p>
        </div>
        {session.user.role === "admin" ? <CreateAlbumForm /> : null}
      </div>

      {albums.length === 0 ? (
        <Empty className="min-h-56 rounded-lg border border-dashed bg-card/60">
          <EmptyHeader>
            <EmptyTitle>暂无活动</EmptyTitle>
            <EmptyDescription>创建活动后即可开始上传、审核和直播。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <AlbumManagementList albums={albums} role={session.user.role} />
      )}
    </section>
  );
}
