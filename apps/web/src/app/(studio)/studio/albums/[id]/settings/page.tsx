import type { AlbumStatistics, AlbumView, BibConfigView } from "@photostream/contracts";

import { AlbumContextNav } from "@/components/albums/album-context-nav";
import { AlbumSettings } from "@/components/albums/album-settings";
import { serverApi } from "@/lib/api";
import { requireInternalSession } from "@/lib/server-auth";

export default async function AlbumSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireInternalSession(["admin"]);
  const { id } = await params;
  const [album, statistics, bibConfig] = await Promise.all([
    serverApi<AlbumView>(`/api/v1/albums/${id}`),
    serverApi<AlbumStatistics>(`/api/v1/albums/${id}/statistics`),
    serverApi<BibConfigView>(`/api/v1/albums/${id}/bib-config`),
  ]);
  return (
    <section aria-labelledby="settings-heading" className="flex flex-col gap-4">
      <AlbumContextNav albumId={id} current="settings" role={session.user.role} />
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold" id="settings-heading">
          设置与统计
        </h2>
        <p className="text-muted-foreground">高风险更改会明确说明影响并由 API 重新校验权限。</p>
      </div>
      <AlbumSettings bibConfig={bibConfig} initialAlbum={album} statistics={statistics} />
    </section>
  );
}
