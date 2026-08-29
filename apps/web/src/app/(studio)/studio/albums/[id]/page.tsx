import type { AlbumView, InternalMediaList } from "@photostream/contracts";
import Link from "next/link";

import { AlbumActions } from "@/components/albums/album-actions";
import { AlbumContextNav } from "@/components/albums/album-context-nav";
import { CategoryForm } from "@/components/albums/category-form";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { serverApi } from "@/lib/api";
import { requireInternalSession } from "@/lib/server-auth";

interface CategoryView {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
}

const stateLabels: Record<AlbumView["state"], string> = {
  draft: "草稿",
  live: "直播中",
  ended: "已结束",
  archived: "已归档",
};

export default async function AlbumOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireInternalSession(["admin", "reviewer"]);
  const { id } = await params;
  const [album, categories, media] = await Promise.all([
    serverApi<AlbumView>(`/api/v1/albums/${id}`),
    serverApi<CategoryView[]>(`/api/v1/albums/${id}/categories`),
    serverApi<InternalMediaList>(`/api/v1/albums/${id}/media?limit=12`),
  ]);
  return (
    <section aria-labelledby="album-heading" className="flex flex-col gap-4">
      <AlbumContextNav albumId={id} current="overview" role={session.user.role} />
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
          <Badge>{stateLabels[album.state]}</Badge>
          {session.user.role === "admin" ? <AlbumActions album={album} /> : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>媒体概览</CardTitle>
          <CardDescription>显示最近 12 项；审核页提供筛选、批量和删除任务。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {media.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">尚无媒体</p>
          ) : (
            media.items.map((item) => (
              <div className="rounded-lg border p-3 text-sm" key={item.id}>
                <p className="font-medium">照片 {item.id.slice(-8)}</p>
                <p className="text-muted-foreground">
                  {item.ingestStatus} · {item.publicationStatus}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
      <div className="flex flex-wrap gap-2">
        {session.user.role === "admin" ? (
          <Link className={buttonVariants()} href={`/studio/albums/${id}/upload`}>
            进入上传
          </Link>
        ) : null}
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
          {session.user.role === "admin" ? <CategoryForm albumId={album.id} /> : null}
        </CardContent>
      </Card>
    </section>
  );
}
