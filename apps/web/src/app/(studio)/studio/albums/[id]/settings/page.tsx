import type { AlbumView, BibConfigView, FaceConfigView } from "@photostream/contracts";

import { AlbumContextNav } from "@/components/albums/album-context-nav";
import { AlbumSettings } from "@/components/albums/album-settings";
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
      <div className="flex min-w-0 items-baseline gap-2">
        <h2 className="shrink-0 text-xl font-semibold tracking-tight" id="settings-heading">
          设置
        </h2>
        <span className="truncate text-sm text-muted-foreground">{album.title}</span>
      </div>
      <AlbumContextNav albumId={id} current="settings" role={session.user.role} />
      <AlbumSettings bibConfig={bibConfig} faceConfig={faceConfig} initialAlbum={album} />
    </section>
  );
}
