import type { AlbumView } from "@photostream/contracts";
import Link from "next/link";

import { AlbumActions } from "@/components/albums/album-actions";
import { CategoryForm } from "@/components/albums/category-form";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { serverApi } from "@/lib/api";

interface CategoryView {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
}

export default async function AlbumOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [album, categories] = await Promise.all([
    serverApi<AlbumView>(`/api/v1/albums/${id}`),
    serverApi<CategoryView[]>(`/api/v1/albums/${id}/categories`),
  ]);
  return (
    <section aria-labelledby="album-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold" id="album-heading">
          {album.title}
        </h2>
        <p className="text-sm text-muted-foreground">
          {album.description || "默认口令、三类下载关闭。"}
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>活动状态</CardTitle>
          <CardDescription>草稿相册对观众不可见；开始直播后才能创建上传任务。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Badge>{album.state === "live" ? "直播中" : "草稿"}</Badge>
          <AlbumActions album={album} />
        </CardContent>
      </Card>
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
        <Link className={buttonVariants({ variant: "ghost" })} href={`/g/${album.slug}`}>
          打开观众页
        </Link>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>一级分类</CardTitle>
          <CardDescription>“全部”由系统提供；这里只维护可选的一级分类。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {categories.length === 0 ? (
              <p className="text-sm text-muted-foreground">尚未创建分类</p>
            ) : (
              categories.map((category) => (
                <Badge key={category.id} variant={category.enabled ? "secondary" : "outline"}>
                  {category.name}
                </Badge>
              ))
            )}
          </div>
          <CategoryForm albumId={album.id} />
        </CardContent>
      </Card>
    </section>
  );
}
