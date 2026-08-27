import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

export default async function AlbumOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <section aria-labelledby="album-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold" id="album-heading">
          示例相册
        </h2>
        <p className="text-sm text-muted-foreground">默认口令、先审核、三类下载关闭。</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link className={buttonVariants()} href={`/studio/albums/${id}/upload`}>
          进入上传
        </Link>
        <Link
          className={buttonVariants({ variant: "outline" })}
          href={`/studio/albums/${id}/review`}
        >
          进入审核
        </Link>
      </div>
    </section>
  );
}
