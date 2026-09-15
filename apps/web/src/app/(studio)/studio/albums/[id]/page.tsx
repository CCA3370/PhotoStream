import type {
  AlbumStatistics,
  AlbumSummaryView,
  AlbumView,
  InternalMediaList,
  InternalMediaView,
} from "@photostream/contracts";
import type { DataSaverSettingView } from "@photostream/contracts/bandwidth";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  DownloadIcon,
  ExternalLinkIcon,
  EyeIcon,
  ImageIcon,
  SettingsIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";

import { AlbumActions } from "@/components/albums/album-actions";
import { AlbumContextNav } from "@/components/albums/album-context-nav";
import { AlbumWorkspaceHeader } from "@/components/albums/album-workspace-header";
import { InternalCachedImage } from "@/components/media/internal-cached-image";
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

const publicationLabels: Record<InternalMediaView["publicationStatus"], string> = {
  draft: "待发布",
  pending_review: "待审核",
  published: "已发布",
  hidden: "已隐藏",
  deleted: "已删除",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function recentPreview(media: InternalMediaView) {
  return (
    media.variants.find((variant) => variant.kind === "photo_480") ??
    media.variants.find((variant) => variant.kind === "photo_960") ??
    null
  );
}

export default async function AlbumOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireInternalSession(["admin", "reviewer"]);
  const { id } = await params;
  const [album, categories, summaries, statistics, recentMedia, dataSaver] = await Promise.all([
    serverApi<AlbumView>(`/api/v1/albums/${id}`),
    serverApi<CategoryView[]>(`/api/v1/albums/${id}/categories`),
    serverApi<AlbumSummaryView[]>("/api/v1/albums"),
    serverApi<AlbumStatistics>(`/api/v1/albums/${id}/statistics`),
    serverApi<InternalMediaList>(`/api/v1/albums/${id}/media?limit=8`),
    serverApi<DataSaverSettingView>(`/api/v1/albums/${id}/data-saver`),
  ]);
  const summary = summaries.find((item) => item.id === id);
  const pendingReview = summary?.pendingReviewCount ?? 0;
  const incomplete = summary?.incompleteCount ?? 0;
  const hasAttention = pendingReview > 0 || incomplete > 0;

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
        albumId={id}
        description={album.description}
        headingId="album-heading"
        metrics={
          summary === undefined
            ? undefined
            : [
                { label: "张照片", value: summary.mediaCount },
                { label: "待审核", value: pendingReview },
                { label: "处理异常", value: incomplete },
              ]
        }
        section="概览"
        state={album.state}
        title={album.title}
      />

      <AlbumContextNav
        albumId={id}
        counts={{ pendingReview, uploadIssues: incomplete }}
        current="overview"
        role={session.user.role}
      />

      <div className="grid gap-3 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="shadow-none">
          <CardHeader className="border-b py-3.5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>当前待处理</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  优先展示会阻塞发布或影响现场工作的事项。
                </p>
              </div>
              <Badge variant={hasAttention ? "secondary" : "outline"}>
                {hasAttention ? "需要处理" : "状态正常"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 p-4 sm:grid-cols-2">
            <Link
              className="group rounded-lg border p-4 transition-colors hover:bg-muted/30"
              href={`/studio/albums/${id}/review`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">待审核照片</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{pendingReview}</p>
                </div>
                <ArrowRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {pendingReview > 0 ? "进入审核工作区处理待发布照片" : "当前没有待审核照片"}
              </p>
            </Link>
            <Link
              className="group rounded-lg border p-4 transition-colors hover:bg-muted/30"
              href={`/studio/albums/${id}/upload`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">处理异常</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{incomplete}</p>
                </div>
                {incomplete > 0 ? (
                  <AlertTriangleIcon className="size-4 text-destructive" />
                ) : (
                  <ArrowRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {incomplete > 0 ? "检查未完成或失败的媒体处理任务" : "当前没有处理异常"}
              </p>
            </Link>
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader className="border-b py-3.5">
            <CardTitle>观众活动</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-px bg-border p-0">
            {[
              { label: "打开次数", value: statistics.opens, icon: EyeIcon },
              { label: "独立访客", value: statistics.uniqueVisitors, icon: UsersIcon },
              { label: "下载次数", value: statistics.downloads, icon: DownloadIcon },
              { label: "访问会话", value: statistics.sessions, icon: ImageIcon },
            ].map((metric) => {
              const Icon = metric.icon;
              return (
                <div className="bg-card p-4" key={metric.label}>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Icon className="size-3.5" />
                    {metric.label}
                  </div>
                  <p className="mt-2 text-xl font-semibold tabular-nums">{metric.value}</p>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.35fr_0.65fr]">
        <Card className="shadow-none">
          <CardHeader className="flex flex-row items-center justify-between gap-3 border-b py-3.5">
            <div>
              <CardTitle>最近照片</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">最近进入系统的 8 张照片</p>
            </div>
            <Link
              className={buttonVariants({ size: "sm", variant: "ghost" })}
              href={`/studio/albums/${id}/review`}
            >
              查看审核
              <ArrowRightIcon data-icon="inline-end" />
            </Link>
          </CardHeader>
          <CardContent className="p-4">
            {recentMedia.items.length === 0 ? (
              <div className="flex min-h-32 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                还没有照片
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {recentMedia.items.map((media) => {
                  const preview = recentPreview(media);
                  return (
                    <Link
                      className="group overflow-hidden rounded-lg border bg-card"
                      href={`/studio/albums/${id}/review`}
                      key={media.id}
                    >
                      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
                        {preview === null ? null : (
                          <InternalCachedImage
                            alt="最近上传照片"
                            className="object-cover transition-transform group-hover:scale-[1.02]"
                            fill
                            mediaId={media.id}
                            sizes="240px"
                            src={preview.url}
                            unoptimized
                            variantKind={preview.kind}
                          />
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2 p-2">
                        <span className="truncate text-xs text-muted-foreground">
                          {publicationLabels[media.publicationStatus]}
                        </span>
                        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                          {formatBytes(media.totalBytes)}
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader className="flex flex-row items-center justify-between gap-3 border-b py-3.5">
            <CardTitle>运行配置</CardTitle>
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
          <CardContent className="divide-y p-0 text-sm">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="text-muted-foreground">访问方式</span>
              <span className="font-medium">
                {album.access === "password" ? "口令访问" : "公开访问"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="text-muted-foreground">发布方式</span>
              <span className="font-medium">
                {album.publishMode === "review" ? "审核后发布" : "自动发布"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="text-muted-foreground">省流模式</span>
              <Badge variant={dataSaver.enabled ? "default" : "outline"}>
                {dataSaver.enabled ? "已开启" : "未开启"}
              </Badge>
            </div>
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="text-muted-foreground">分类</span>
              <span className="font-medium tabular-nums">
                {categories.filter((category) => category.enabled).length} / {categories.length}{" "}
                启用
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="text-muted-foreground">逻辑存储量</span>
              <span className="font-medium tabular-nums">
                {formatBytes(statistics.logicalBytes)}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
