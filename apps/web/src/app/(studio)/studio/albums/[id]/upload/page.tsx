import type { AlbumView, BibConfigView } from "@photostream/contracts";

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
  const [album, categories, bibConfig] = await Promise.all([
    serverApi<AlbumView>(`/api/v1/albums/${id}`),
    serverApi<CategoryDetails[]>(`/api/v1/albums/${id}/categories`),
    serverApi<BibConfigView>(`/api/v1/albums/${id}/bib-config`),
  ]);

  return (
    <section aria-labelledby="upload-title" className="flex flex-col gap-4">
      <AlbumWorkspaceHeader
        albumId={id}
        headingId="upload-title"
        section="上传"
        state={album.state}
        title={album.title}
      />
      <AlbumContextNav albumId={id} current="upload" role={session.user.role} />
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
