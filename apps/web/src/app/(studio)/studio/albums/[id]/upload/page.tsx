import { AlbumContextNav } from "@/components/albums/album-context-nav";
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
      <div className="min-w-0">
        <h2 className="text-xl font-semibold tracking-tight" id="upload-title">
          上传
        </h2>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{album.title}</p>
      </div>
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
