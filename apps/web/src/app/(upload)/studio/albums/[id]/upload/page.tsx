import type { BibConfigView } from "@photostream/contracts";

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
  const [album, categories, bibConfig] = await Promise.all([
    serverApi<AlbumDetails>(`/api/v1/albums/${id}`),
    serverApi<CategoryDetails[]>(`/api/v1/albums/${id}/categories`),
    serverApi<BibConfigView>(`/api/v1/albums/${id}/bib-config`),
  ]);
  return (
    <UploadQueue
      albumId={album.id}
      albumTitle={album.title}
      bibConfig={bibConfig}
      categories={categories.filter((category) => category.enabled)}
      role={session.user.role}
    />
  );
}
