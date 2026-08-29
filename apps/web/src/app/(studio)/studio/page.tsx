import type { AlbumSummaryView } from "@photostream/contracts";
import Link from "next/link";

import { CreateAlbumForm } from "@/components/albums/create-album-form";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { serverApi } from "@/lib/api";
import { requireInternalSession } from "@/lib/server-auth";

const stateLabels: Record<AlbumSummaryView["state"], string> = {
  draft: "草稿",
  live: "直播中",
  ended: "已结束",
  archived: "已归档",
};

export default async function StudioPage() {
  const [session, albums] = await Promise.all([
    requireInternalSession(),
    serverApi<AlbumSummaryView[]>("/api/v1/albums"),
  ]);
  return (
    <section aria-labelledby="activity-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold" id="activity-heading">
            活动总览
          </h2>
          <p className="text-sm text-muted-foreground">创建相册、开始直播并进入照片上传闭环。</p>
        </div>
        {session.user.role === "admin" ? <CreateAlbumForm /> : null}
      </div>
      {albums.length === 0 ? (
        <Empty className="min-h-64 border">
          <EmptyHeader>
            <EmptyTitle>暂无活动</EmptyTitle>
            <EmptyDescription>创建第一个口令相册，随后开始直播并上传照片。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {albums.map((album) => (
            <Card key={album.id}>
              <CardHeader>
                <CardTitle>{album.title}</CardTitle>
                <CardDescription>{album.description || "暂无活动说明"}</CardDescription>
                <CardAction>
                  <Badge variant={album.state === "live" ? "default" : "secondary"}>
                    {stateLabels[album.state]}
                  </Badge>
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-1 text-sm text-muted-foreground">
                <p>{album.access === "password" ? "口令访问" : "公开链接"}</p>
                <p>{album.publishMode === "review" ? "先审核后发布" : "预览就绪后自动发布"}</p>
                <p>
                  媒体 {album.mediaCount} · 待审核 {album.pendingReviewCount} · 不完整{" "}
                  {album.incompleteCount}
                </p>
              </CardContent>
              <CardFooter>
                <Link
                  className={buttonVariants({ variant: "outline" })}
                  href={
                    session.user.role === "uploader"
                      ? `/studio/albums/${album.id}/upload`
                      : `/studio/albums/${album.id}`
                  }
                >
                  {session.user.role === "uploader" ? "进入上传" : "管理相册"}
                </Link>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
