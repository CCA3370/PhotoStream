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
  const liveCount = albums.filter((album) => album.state === "live").length;

  return (
    <section aria-label="活动管理" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {albums.length} 个活动{liveCount > 0 ? ` · ${liveCount} 个直播中` : ""}
        </p>
        {session.user.role === "admin" ? <CreateAlbumForm /> : null}
      </div>

      {albums.length === 0 ? (
        <Empty className="min-h-56 rounded-xl border border-dashed bg-card/60">
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
