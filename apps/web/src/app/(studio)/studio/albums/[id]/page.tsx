import type {
  AlbumStatistics,
  AlbumSummaryView,
  AlbumView,
  InternalMediaList,
  InternalMediaView,
  ReviewCollaborationView,
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
  draft: "已隐藏",
  pending_review: "已隐藏",
  published: "显示中",
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
  const session = await requireInternalSession(["admin", "operator", "reviewer"]);
  const { id } = await params;
  const [
    album,
    categories,
    summaries,
    statistics,
    recentMedia,
    dataSaver,
    reviewCollaboration,
  ] = await Promise.all([
    serverApi<AlbumView>(`/api/v1/albums/${id}`),
    serverApi<CategoryView[]>(`/api/v1/albums/${id}/categories`),
    serverApi<AlbumSummaryView[]>("/api/v1/albums"),
    serverApi<AlbumStatistics>(`/api/v1/albums/${id}/statistics`),
    serverApi<InternalMediaList>(`/api/v1/albums/${id}/media?limit=8`),
    serverApi<DataSaverSettingView>(`/api/v1/albums/${id}/data-saver`),
    serverApi<ReviewCollaborationView>(`/api/v1/albums/${id}/review-collaboration`),
  ]);
  const summary = summaries.find((item) => item.id === id);
  const incomplete = summary?.incompleteCount ?? 0;
  const pendingReview = summary?.pendingReviewCount ?? 0;
  const hasAttention = incomplete > 0 || pendingReview > 0;

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
                { label: "处理中", value: incomplete },
                { label: "逻辑存储", value: formatBytes(summary.logicalBytes) },
              ]
        }
        section="概览"
        state={album.state}
        title={album.title}
      />

      <AlbumContextNav
        albumId={id}
        counts={{ uploadIssues: incomplete }}
        current="overview"
        role={session.user.role}
      />

      <div className="grid gap-3 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="shadow-none">
          <CardHeader className="border-b py-3.5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>当前工作</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  上传完成的照片默认隐藏；在审核工作区选择需要向观众显示的照片。
                </p>
              </div>
              <Badge variant={hasAttention ? "secondary" : "outline"}>
                {hasAttention ? "有任务未完成" : "状态正常"}
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
                  <p className="text-sm font-medium">照片显示管理</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">
                    {summary?.mediaCount ?? 0}
                  </p>
                </div>
                <ArrowRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                查看全部照片，批量显示、隐藏或调整属性
              </p>
            </Link>
            <Link
              className="group rounded-lg border p-4 transition-colors hover:bg-muted/30"
              href={`/studio/albums/${id}/upload`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">上传处理中</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{incomplete}</p>
                </div>
                {incomplete > 0 ? (
                  <AlertTriangleIcon className="size-4 text-destructive" />
                ) : (
                  <ArrowRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {incomplete > 0 ? "检查未完成或失败的媒体处理任务" : "当前没有未完成的处理任务"}
              </p>
            </Link>
            <Link
              className="group rounded-lg border p-4 transition-colors hover:bg-muted/30"
              href={`/studio/albums/${id}/review`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">待审核</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{pendingReview}</p>
                </div>
                {pendingReview > 0 ? (
                  <AlertTriangleIcon className="size-4 text-amber-600" />
                ) : (
                  <ArrowRightIcon className="size-4 text-muted-foreground" />
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {pendingReview > 0 ? "仍有照片等待审核或决定是否显示" : "当前没有待审核照片"}
              </p>
            </Link>
            {reviewCollaboration.enabled && reviewCollaboration.participants.length > 0 ? (
              <div className="rounded-lg border p-4 sm:col-span-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">多人审核剩余工作量</p>
                    <p className="mt-1 text-xs text-muted-foreground">按当前分工实时统计未审核照片</p>
                  </div>
                  <Badge variant="outline">{reviewCollaboration.participants.length} 人协作</Badge>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {reviewCollaboration.participants.map((participant) => (
                    <div
                      className="flex items-center justify-between gap-3 rounded-md bg-muted/35 px-3 py-2 text-sm"
                      key={participant.id}
                    >
                      <span className="truncate">{participant.displayName}</span>
                      <span className="shrink-0 font-medium tabular-nums">
                        剩余 {participant.remainingCount} 张
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
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
              查看照片
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
              <span className="text-muted-foreground">照片可见性</span>
              <span className="font-medium">上传后默认隐藏</span>
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
