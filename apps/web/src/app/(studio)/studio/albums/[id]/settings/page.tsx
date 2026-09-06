import type { AlbumView, BibConfigView, FaceConfigView } from "@photostream/contracts";

import { AlbumContextNav } from "@/components/albums/album-context-nav";
import { AlbumSettings } from "@/components/albums/album-settings";
import { AlbumWorkspaceHeader } from "@/components/albums/album-workspace-header";
import { serverApi } from "@/lib/api";
import { requireInternalSession } from "@/lib/server-auth";

export default async function AlbumSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireInternalSession(["admin"]);
  const { id } = await params;
  const [album, bibConfig, faceConfig] = await Promise.all([
    serverApi<AlbumView>(`/api/v1/albums/${id}`),
    serverApi<BibConfigView>(`/api/v1/albums/${id}/bib-config`),
    serverApi<FaceConfigView>(`/api/v1/albums/${id}/face-config`),
  ]);

  return (
    <section aria-labelledby="settings-heading" className="flex flex-col gap-4">
      <AlbumWorkspaceHeader headingId="settings-heading" section="活动设置" title={album.title} />
      <AlbumContextNav albumId={id} current="settings" role={session.user.role} />
      <AlbumSettings bibConfig={bibConfig} faceConfig={faceConfig} initialAlbum={album} />
    </section>
  );
}
