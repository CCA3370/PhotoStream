import type { AlbumSummaryView } from "@photostream/contracts";
import {
  ArrowUpRightIcon,
  DownloadIcon,
  EyeIcon,
  HardDriveIcon,
  ImagesIcon,
  RadioIcon,
  UsersIcon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { CreateAlbumForm } from "@/components/albums/create-album-form";
import { AlbumStateChart, AnalyticsTrendChart } from "@/components/dashboard/dashboard-charts";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { serverApi } from "@/lib/api";
import { requireInternalSession } from "@/lib/server-auth";
import { cn } from "@/lib/utils";

interface DashboardStatistics {
  readonly periodDays: number;
  readonly mediaCount: number;
  readonly logicalBytes: number;
  readonly opens: number;
  readonly sessions: number;
  readonly downloads: number;
  readonly uniqueVisitors: number;
  readonly daily: readonly {
    readonly day: string;
    readonly opens: number;
    readonly sessions: number;
    readonly downloads: number;
    readonly uniqueVisitors: number;
  }[];
  readonly topPhotos: readonly {
    readonly mediaId: string;
    readonly albumId: string;
    readonly albumTitle: string;
    readonly publishSequence: number;
    readonly downloads: number;
    readonly thumbnailUrl: string | null;
    readonly capturedAt: string | null;
  }[];
}

const numberFormatter = new Intl.NumberFormat("zh-CN");

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

function stateCounts(albums: readonly AlbumSummaryView[]) {
  return albums.reduce<Record<AlbumSummaryView["state"], number>>(
    (counts, album) => ({ ...counts, [album.state]: counts[album.state] + 1 }),
    { draft: 0, live: 0, ended: 0, archived: 0 },
  );
}

function fillDaily(
  rows: DashboardStatistics["daily"],
  days: number,
): DashboardStatistics["daily"] {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const result: DashboardStatistics["daily"][number][] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(today);
    day.setUTCDate(today.getUTCDate() - offset);
    const key = day.toISOString().slice(0, 10);
    result.push(
      byDay.get(key) ?? {
        day: key,
        opens: 0,
        sessions: 0,
        downloads: 0,
        uniqueVisitors: 0,
      },
    );
  }
  return result;
}

export default async function StudioPage() {
  const [session, albums, statistics] = await Promise.all([
    requireInternalSession(),
    serverApi<AlbumSummaryView[]>("/api/v1/albums"),
    serverApi<DashboardStatistics>("/api/v1/dashboard?limit=8"),
  ]);
  const counts = stateCounts(albums);
  const liveAlbums = albums.filter((album) => album.state === "live").slice(0, 5);
  const daily = fillDaily(statistics.daily, statistics.periodDays);

  const kpis = [
    {
      label: "累计浏览",
      value: numberFormatter.format(statistics.opens),
      detail: `${numberFormatter.format(statistics.sessions)} 次有效会话`,
      icon: EyeIcon,
    },
    {
      label: `${statistics.periodDays} 天独立访客`,
      value: numberFormatter.format(statistics.uniqueVisitors),
      detail: "按匿名访客摘要去重",
      icon: UsersIcon,
    },
    {
      label: "累计下载",
      value: numberFormatter.format(statistics.downloads),
      detail: "普通图与原图签发总次数",
      icon: DownloadIcon,
    },
    {
      label: "照片总数",
      value: numberFormatter.format(statistics.mediaCount),
      detail: `逻辑存储 ${formatBytes(statistics.logicalBytes)}`,
      icon: ImagesIcon,
    },
  ] as const;

  return (
    <section aria-labelledby="dashboard-heading" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm font-medium text-primary">运营概览</p>
          <h2 className="text-2xl font-semibold tracking-tight" id="dashboard-heading">
            首页
          </h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            查看访问、下载、内容规模和正在进行的活动。统计来自实际访问与下载事件。
          </p>
        </div>
        <div className="flex gap-2">
          <Link className={buttonVariants({ variant: "outline" })} href="/studio/albums">
            管理活动
          </Link>
          {session.user.role === "admin" ? <CreateAlbumForm /> : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map(({ label, value, detail, icon: Icon }) => (
          <Card className="overflow-hidden" key={label}>
            <CardContent className="flex items-start justify-between gap-4 p-5">
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p>
              </div>
              <div className="rounded-xl border bg-muted/50 p-2.5 text-muted-foreground">
                <Icon aria-hidden="true" className="size-5" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.8fr)]">
        <Card>
          <CardHeader>
            <CardTitle>访问与下载趋势</CardTitle>
            <CardDescription>最近 {statistics.periodDays} 天 · 每日浏览、独立访客与下载</CardDescription>
          </CardHeader>
          <CardContent>
            <AnalyticsTrendChart data={daily} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>活动状态</CardTitle>
            <CardDescription>{albums.length} 个活动的当前状态分布</CardDescription>
          </CardHeader>
          <CardContent>
            <AlbumStateChart counts={counts} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(340px,0.8fr)]">
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>照片下载排行</CardTitle>
                <CardDescription>
                  最近 {statistics.periodDays} 天 · 精确按单张照片的实际下载事件统计
                </CardDescription>
              </div>
              <DownloadIcon aria-hidden="true" className="size-5 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {statistics.topPhotos.length === 0 ? (
              <div className="flex min-h-52 items-center justify-center rounded-xl border border-dashed bg-muted/20 px-6 text-center text-sm text-muted-foreground">
                暂无照片下载记录。
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {statistics.topPhotos.map((photo, index) => (
                  <Link
                    className="group flex items-center gap-3 rounded-xl border p-2.5 transition-colors hover:bg-muted/50"
                    href={`/studio/albums/${photo.albumId}`}
                    key={photo.mediaId}
                  >
                    <div className="relative aspect-[4/3] w-24 shrink-0 overflow-hidden rounded-lg bg-muted">
                      {photo.thumbnailUrl === null ? (
                        <div className="flex size-full items-center justify-center text-muted-foreground">
                          <ImagesIcon aria-hidden="true" className="size-5" />
                        </div>
                      ) : (
                        <Image
                          alt="下载排行照片缩略图"
                          fill
                          sizes="96px"
                          src={photo.thumbnailUrl}
                          style={{ objectFit: "cover" }}
                          unoptimized
                        />
                      )}
                      <Badge className="absolute top-1 left-1 h-6 min-w-6 justify-center px-1.5" variant="secondary">
                        {index + 1}
                      </Badge>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{photo.albumTitle}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">照片 #{photo.publishSequence}</p>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold tabular-nums">
                          {numberFormatter.format(photo.downloads)} 次下载
                        </span>
                        <ArrowUpRightIcon
                          aria-hidden="true"
                          className="size-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                        />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <RadioIcon aria-hidden="true" className="size-4 text-success" />
                <CardTitle>正在直播</CardTitle>
              </div>
              <CardDescription>当前仍在对外发布新照片的活动</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {liveAlbums.length === 0 ? (
                <p className="py-5 text-center text-sm text-muted-foreground">当前没有直播中的活动。</p>
              ) : (
                liveAlbums.map((album) => (
                  <Link
                    className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 hover:bg-muted/50"
                    href={`/studio/albums/${album.id}`}
                    key={album.id}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{album.title}</p>
                      <p className="text-xs text-muted-foreground">{album.mediaCount} 张照片</p>
                    </div>
                    <Badge>直播中</Badge>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="bg-muted/25">
            <CardContent className="flex items-center justify-between gap-4 p-5">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <HardDriveIcon aria-hidden="true" className="size-4" />
                  存储占用
                </div>
                <p className="mt-2 text-2xl font-semibold">{formatBytes(statistics.logicalBytes)}</p>
                <p className="text-xs text-muted-foreground">已验证派生图与原图的逻辑总量</p>
              </div>
              <Link
                className={cn(buttonVariants({ size: "icon", variant: "outline" }), "shrink-0")}
                href="/studio/albums"
                title="查看全部活动"
              >
                <ArrowUpRightIcon aria-hidden="true" />
                <span className="sr-only">查看全部活动</span>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
