import type {
  AlbumStatistics,
  AlbumView,
  BibConfigView,
  FaceConfigView,
} from "@photostream/contracts";

import { AlbumContextNav } from "@/components/albums/album-context-nav";
import { AlbumSettings } from "@/components/albums/album-settings";
import { serverApi } from "@/lib/api";
import { requireInternalSession } from "@/lib/server-auth";

export default async function AlbumSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireInternalSession(["admin"]);
  const { id } = await params;
  const [album, statistics, bibConfig, faceConfig] = await Promise.all([
    serverApi<AlbumView>(`/api/v1/albums/${id}`),
    serverApi<AlbumStatistics>(`/api/v1/albums/${id}/statistics`),
    serverApi<BibConfigView>(`/api/v1/albums/${id}/bib-config`),
    serverApi<FaceConfigView>(`/api/v1/albums/${id}/face-config`),
  ]);

  return (
    <section aria-labelledby="settings-heading" className="flex flex-col gap-4">
      <div className="min-w-0">
        <h2 className="text-xl font-semibold tracking-tight" id="settings-heading">
          设置
        </h2>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{album.title}</p>
      </div>
      <AlbumContextNav albumId={id} current="settings" role={session.user.role} />
      <AlbumSettings
        bibConfig={bibConfig}
        faceConfig={faceConfig}
        initialAlbum={album}
        statistics={statistics}
      />
    </section>
  );
}
