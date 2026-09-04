import type { AlbumSummaryView } from "@photostream/contracts";
import { ArrowRightIcon, ImageIcon, InboxIcon, RadioIcon } from "lucide-react";
import Link from "next/link";

import { CreateAlbumForm } from "@/components/albums/create-album-form";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { serverApi } from "@/lib/api";
import { requireInternalSession } from "@/lib/server-auth";
import { cn } from "@/lib/utils";

const stateLabels: Record<AlbumSummaryView["state"], string> = {
  draft: "草稿",
  live: "直播中",
  ended: "已结束",
  archived: "已归档",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

export default async function AlbumsPage() {
  const [session, albums] = await Promise.all([
    requireInternalSession(),
    serverApi<AlbumSummaryView[]>("/api/v1/albums"),
  ]);

  return (
    <section aria-labelledby="albums-heading" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm font-medium text-primary">内容管理</p>
          <h2 className="text-2xl font-semibold tracking-tight" id="albums-heading">
            活动与相册
          </h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            管理直播状态、上传、审核、下载权限和公开页面。
          </p>
        </div>
        {session.user.role === "admin" ? <CreateAlbumForm /> : null}
      </div>

      {albums.length === 0 ? (
        <Empty className="min-h-72 rounded-2xl border border-dashed bg-card/60">
          <EmptyHeader>
            <EmptyTitle>暂无活动</EmptyTitle>
            <EmptyDescription>创建第一个活动相册后，即可开始上传和直播。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {albums.map((album) => (
            <Card className="group overflow-hidden transition-shadow hover:shadow-md" key={album.id}>
              <CardHeader className="gap-3 border-b bg-muted/15">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <CardTitle className="truncate text-lg">{album.title}</CardTitle>
                    <CardDescription className="line-clamp-2 min-h-10">
                      {album.description || "暂无活动说明"}
                    </CardDescription>
                  </div>
                  <Badge variant={album.state === "live" ? "default" : "secondary"}>
                    {stateLabels[album.state]}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-5 p-5">
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-xl bg-muted/50 p-3">
                    <ImageIcon aria-hidden="true" className="mb-2 size-4 text-muted-foreground" />
                    <p className="text-lg font-semibold tabular-nums">{album.mediaCount}</p>
                    <p className="text-xs text-muted-foreground">照片</p>
                  </div>
                  <div className="rounded-xl bg-muted/50 p-3">
                    <InboxIcon aria-hidden="true" className="mb-2 size-4 text-muted-foreground" />
                    <p className="text-lg font-semibold tabular-nums">{album.pendingReviewCount}</p>
                    <p className="text-xs text-muted-foreground">待审核</p>
                  </div>
                  <div className="rounded-xl bg-muted/50 p-3">
                    <RadioIcon aria-hidden="true" className="mb-2 size-4 text-muted-foreground" />
                    <p className="truncate text-sm font-semibold">{formatBytes(album.logicalBytes)}</p>
                    <p className="text-xs text-muted-foreground">存储</p>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 text-xs text-muted-foreground">
                    <p>{album.access === "password" ? "口令访问" : "公开链接"}</p>
                    <p>{album.publishMode === "review" ? "审核后发布" : "处理完成自动发布"}</p>
                  </div>
                  <Link
                    className={cn(buttonVariants({ variant: "outline" }), "shrink-0 gap-2")}
                    href={
                      session.user.role === "uploader"
                        ? `/studio/albums/${album.id}/upload`
                        : `/studio/albums/${album.id}`
                    }
                  >
                    {session.user.role === "uploader" ? "进入上传" : "管理"}
                    <ArrowRightIcon aria-hidden="true" className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
