import { AlbumContextNav } from "@/components/albums/album-context-nav";
import { AlbumWorkspaceHeader } from "@/components/albums/album-workspace-header";
import { UploadQueue } from "@/components/uploads/upload-queue";
import { serverApi } from "@/lib/api";
import { requireInternalSession } from "@/lib/server-auth";

interface AlbumDetails {
  readonly id: string;
  readonly title: string;
}

interface CategoryDetails {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
}

export default async function UploadPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireInternalSession(["admin", "uploader"]);
  const { id } = await params;
  const [album, categories] = await Promise.all([
    serverApi<AlbumDetails>(`/api/v1/albums/${id}`),
    serverApi<CategoryDetails[]>(`/api/v1/albums/${id}/categories`),
  ]);

  return (
    <section aria-labelledby="upload-title" className="flex flex-col gap-4">
      <AlbumWorkspaceHeader headingId="upload-title" section="上传工作区" title={album.title} />
      <AlbumContextNav albumId={id} current="upload" role={session.user.role} />
      <UploadQueue
        albumId={album.id}
        albumTitle={album.title}
        categories={categories.filter((category) => category.enabled)}
        role={session.user.role}
      />
    </section>
  );
}
