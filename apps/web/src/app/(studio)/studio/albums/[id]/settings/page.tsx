import type { AlbumView, BibConfigView, FaceConfigView } from "@photostream/contracts";
import type { DataSaverSettingView } from "@photostream/contracts/bandwidth";

import { AlbumContextNav } from "@/components/albums/album-context-nav";
import { AlbumDataSaverSetting } from "@/components/albums/album-data-saver-setting";
import { AlbumSettings } from "@/components/albums/album-settings";
import { AlbumWorkspaceHeader } from "@/components/albums/album-workspace-header";
import { serverApi } from "@/lib/api";
import { requireInternalSession } from "@/lib/server-auth";

export default async function AlbumSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireInternalSession(["admin"]);
  const { id } = await params;
  const [album, bibConfig, faceConfig, dataSaver] = await Promise.all([
    serverApi<AlbumView>(`/api/v1/albums/${id}`),
    serverApi<BibConfigView>(`/api/v1/albums/${id}/bib-config`),
    serverApi<FaceConfigView>(`/api/v1/albums/${id}/face-config`),
    serverApi<DataSaverSettingView>(`/api/v1/albums/${id}/data-saver`),
  ]);

  return (
    <section aria-labelledby="settings-heading" className="flex flex-col gap-4">
      <AlbumWorkspaceHeader headingId="settings-heading" section="活动设置" title={album.title} />
      <AlbumContextNav albumId={id} current="settings" role={session.user.role} />
      <AlbumDataSaverSetting albumId={id} initialSetting={dataSaver} />
      <AlbumSettings bibConfig={bibConfig} faceConfig={faceConfig} initialAlbum={album} />
    </section>
  );
}
