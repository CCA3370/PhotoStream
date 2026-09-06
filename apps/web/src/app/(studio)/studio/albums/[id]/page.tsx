import type { AlbumView } from "@photostream/contracts";
import { ExternalLinkIcon, SettingsIcon } from "lucide-react";
import Link from "next/link";

import { AlbumActions } from "@/components/albums/album-actions";
import { AlbumContextNav } from "@/components/albums/album-context-nav";
import { AlbumWorkspaceHeader } from "@/components/albums/album-workspace-header";
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
  const [album, categories] = await Promise.all([
    serverApi<AlbumView>(`/api/v1/albums/${id}`),
    serverApi<CategoryView[]>(`/api/v1/albums/${id}/categories`),
  ]);

  return (
    <section aria-labelledby="album-heading" className="flex flex-col gap-4">
      <AlbumWorkspaceHeader
        actions={
          <>
            <Link
              className={buttonVariants({ size: "sm", variant: "ghost" })}
              href={`/g/${album.slug}`}
            >
              <ExternalLinkIcon data-icon="inline-start" />
              观众页
            </Link>
            {session.user.role === "admin" ? <AlbumActions album={album} /> : null}
          </>
        }
        description={album.description}
        headingId="album-heading"
        section="活动概览"
        title={album.title}
      />

      <AlbumContextNav albumId={id} current="overview" role={session.user.role} />

      <div className="grid gap-3 xl:grid-cols-2">
        <Card className="overflow-hidden shadow-none">
          <CardHeader className="flex flex-row items-center justify-between gap-3 border-b py-3.5">
            <CardTitle>活动配置</CardTitle>
            {session.user.role === "admin" ? (
              <Link
                className={buttonVariants({ size: "sm", variant: "ghost" })}
                href={`/studio/albums/${id}/settings`}
              >
                <SettingsIcon data-icon="inline-start" />
                设置
              </Link>
            ) : null}
          </CardHeader>
          <CardContent className="grid gap-px bg-border p-0 sm:grid-cols-3">
            <div className="bg-card px-4 py-3">
              <p className="text-xs text-muted-foreground">状态</p>
              <Badge className="mt-1.5" variant={stateVariant(album.state)}>
                {stateLabels[album.state]}
              </Badge>
            </div>
            <div className="bg-card px-4 py-3">
              <p className="text-xs text-muted-foreground">访问</p>
              <p className="mt-1.5 text-sm font-medium">
                {album.access === "password" ? "口令访问" : "公开访问"}
              </p>
            </div>
            <div className="bg-card px-4 py-3">
              <p className="text-xs text-muted-foreground">发布</p>
              <p className="mt-1.5 text-sm font-medium">
                {album.publishMode === "review" ? "审核后发布" : "自动发布"}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden shadow-none">
          <CardHeader className="flex flex-row items-center justify-between gap-3 border-b py-3.5">
            <CardTitle>分类</CardTitle>
            <span className="text-xs tabular-nums text-muted-foreground">
              {categories.length} 个
            </span>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 p-4">
            <div className="flex min-h-7 flex-wrap items-center gap-1.5">
              {categories.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无分类</p>
              ) : (
                categories.map((category) => (
                  <Badge key={category.id} variant={category.enabled ? "secondary" : "outline"}>
                    {category.name}
                    {category.enabled ? null : " · 已停用"}
                  </Badge>
                ))
              )}
            </div>
            {session.user.role === "admin" ? <CategoryForm albumId={album.id} /> : null}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
