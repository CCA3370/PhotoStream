import type { AlbumView, InternalMediaList } from "@photostream/contracts";
import { ExternalLinkIcon } from "lucide-react";
import Link from "next/link";

import { AlbumActions } from "@/components/albums/album-actions";
import { AlbumContextNav } from "@/components/albums/album-context-nav";
import { CategoryForm } from "@/components/albums/category-form";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

function stateVariant(state: AlbumView["state"]): "default" | "outline" | "secondary" {
  if (state === "live") return "default";
  if (state === "archived") return "outline";
  return "secondary";
}

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
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="truncate text-xl font-semibold tracking-tight" id="album-heading">
              {album.title}
            </h2>
            <Badge variant={stateVariant(album.state)}>{stateLabels[album.state]}</Badge>
          </div>
          {album.description.length === 0 ? null : (
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{album.description}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            className={buttonVariants({ size: "sm", variant: "ghost" })}
            href={`/g/${album.slug}`}
          >
            <ExternalLinkIcon data-icon="inline-start" />
            观众页
          </Link>
          {session.user.role === "admin" ? <AlbumActions album={album} /> : null}
        </div>
      </div>

      <AlbumContextNav albumId={id} current="overview" role={session.user.role} />

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.7fr)]">
        <Card className="overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between gap-3 border-b py-3.5">
            <CardTitle>最近媒体</CardTitle>
            <Link
              className={buttonVariants({ size: "sm", variant: "ghost" })}
              href={`/studio/albums/${id}/review`}
            >
              查看全部
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {media.items.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">尚无媒体</p>
            ) : (
              <div className="divide-y">
                {media.items.map((item) => (
                  <div
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                    key={item.id}
                  >
                    <p className="text-sm font-medium">照片 {item.id.slice(-8)}</p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>处理：{item.ingestStatus}</span>
                      <span aria-hidden="true">·</span>
                      <span>发布：{item.publicationStatus}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-3">
          <Card className="overflow-hidden">
            <CardHeader className="border-b py-3.5">
              <CardTitle>活动配置</CardTitle>
            </CardHeader>
            <CardContent className="divide-y p-0 text-sm">
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-muted-foreground">访问</span>
                <span className="font-medium">
                  {album.access === "password" ? "口令访问" : "公开访问"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-muted-foreground">发布</span>
                <span className="font-medium">
                  {album.publishMode === "review" ? "审核后发布" : "自动发布"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-muted-foreground">状态</span>
                <span className="font-medium">{stateLabels[album.state]}</span>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader className="border-b py-3.5">
              <CardTitle>分类</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 p-4">
              <div className="flex flex-wrap gap-1.5">
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
        </div>
      </div>
    </section>
  );
}
