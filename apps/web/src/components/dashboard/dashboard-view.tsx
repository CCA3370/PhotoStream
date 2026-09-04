"use client";

import type { AlbumSummaryView } from "@photostream/contracts";
import {
  ArrowUpRightIcon,
  CalendarRangeIcon,
  DownloadIcon,
  EyeIcon,
  HardDriveIcon,
  ImagesIcon,
  RadioIcon,
  RefreshCwIcon,
  UsersIcon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";

import { CreateAlbumForm } from "@/components/albums/create-album-form";
import { AlbumStateChart, AnalyticsTrendChart } from "@/components/dashboard/dashboard-charts";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface DashboardStatistics {
  readonly from: string;
  readonly to: string;
  readonly bucket: "5m" | "30m" | "1h" | "6h" | "1d";
  readonly maxRangeDays: number;
  readonly mediaCount: number;
  readonly logicalBytes: number;
  readonly opens: number;
  readonly sessions: number;
  readonly downloads: number;
  readonly uniqueVisitors: number;
  readonly points: readonly {
    readonly at: string;
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

type PresetKey = "30d" | "7d" | "1d" | "5h" | "1h" | "30m" | "custom";

const presets: readonly {
  readonly key: Exclude<PresetKey, "custom">;
  readonly label: string;
  readonly ms: number;
}[] = [
  { key: "30d", label: "30 天", ms: 30 * 24 * 60 * 60 * 1_000 },
  { key: "7d", label: "7 天", ms: 7 * 24 * 60 * 60 * 1_000 },
  { key: "1d", label: "1 天", ms: 24 * 60 * 60 * 1_000 },
  { key: "5h", label: "5 小时", ms: 5 * 60 * 60 * 1_000 },
  { key: "1h", label: "1 小时", ms: 60 * 60 * 1_000 },
  { key: "30m", label: "30 分钟", ms: 30 * 60 * 1_000 },
];

const bucketMs: Record<DashboardStatistics["bucket"], number> = {
  "5m": 5 * 60 * 1_000,
  "30m": 30 * 60 * 1_000,
  "1h": 60 * 60 * 1_000,
  "6h": 6 * 60 * 60 * 1_000,
  "1d": 24 * 60 * 60 * 1_000,
};

const bucketLabels: Record<DashboardStatistics["bucket"], string> = {
  "5m": "5 分钟",
  "30m": "30 分钟",
  "1h": "1 小时",
  "6h": "6 小时",
  "1d": "1 天",
};

const numberFormatter = new Intl.NumberFormat("zh-CN");
const rangeFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

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
  const counts: Record<AlbumSummaryView["state"], number> = {
    draft: 0,
    live: 0,
    ended: 0,
    archived: 0,
  };
  for (const album of albums) counts[album.state] += 1;
  return counts;
}

function localInputValue(date: Date): string {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function fillPoints(data: DashboardStatistics) {
  const interval = bucketMs[data.bucket];
  const start = Math.floor(new Date(data.from).getTime() / interval) * interval;
  const end = new Date(data.to).getTime();
  const byTime = new Map(data.points.map((point) => [new Date(point.at).getTime(), point]));
  const points: DashboardStatistics["points"][number][] = [];
  for (let at = start; at < end; at += interval) {
    points.push(
      byTime.get(at) ?? {
        at: new Date(at).toISOString(),
        opens: 0,
        sessions: 0,
        downloads: 0,
        uniqueVisitors: 0,
      },
    );
  }
  return points;
}

function rangeText(data: DashboardStatistics): string {
  return `${rangeFormatter.format(new Date(data.from))} – ${rangeFormatter.format(new Date(data.to))}`;
}

async function fetchDashboard(from: Date, to: Date): Promise<DashboardStatistics> {
  const query = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
    limit: "8",
  });
  const response = await fetch(`/api/v1/dashboard?${query.toString()}`, { cache: "no-store" });
  if (!response.ok) {
    let message = "无法加载统计数据";
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // Keep the generic message when an upstream response is not JSON.
    }
    throw new Error(message);
  }
  return (await response.json()) as DashboardStatistics;
}

export function DashboardView({
  albums,
  canCreateAlbum,
  initialData,
}: Readonly<{
  albums: readonly AlbumSummaryView[];
  canCreateAlbum: boolean;
  initialData: DashboardStatistics;
}>) {
  const [data, setData] = useState(initialData);
  const [activePreset, setActivePreset] = useState<PresetKey>("30d");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(() => localInputValue(new Date(initialData.from)));
  const [customTo, setCustomTo] = useState(() => localInputValue(new Date(initialData.to)));
  const points = useMemo(() => fillPoints(data), [data]);
  const counts = useMemo(() => stateCounts(albums), [albums]);
  const liveAlbums = useMemo(
    () => albums.filter((album) => album.state === "live").slice(0, 5),
    [albums],
  );

  async function loadRange(from: Date, to: Date, preset: PresetKey): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const next = await fetchDashboard(from, to);
      setData(next);
      setActivePreset(preset);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法加载统计数据");
    } finally {
      setPending(false);
    }
  }

  async function selectPreset(key: Exclude<PresetKey, "custom">): Promise<void> {
    const preset = presets.find((candidate) => candidate.key === key);
    if (preset === undefined) return;
    const to = new Date();
    await loadRange(new Date(to.getTime() - preset.ms), to, key);
  }

  async function refresh(): Promise<void> {
    const preset = presets.find((candidate) => candidate.key === activePreset);
    if (preset !== undefined) {
      const to = new Date();
      await loadRange(new Date(to.getTime() - preset.ms), to, activePreset);
      return;
    }
    await loadRange(new Date(data.from), new Date(data.to), "custom");
  }

  async function applyCustomRange(): Promise<void> {
    const from = new Date(customFrom);
    const to = new Date(customTo);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      setError("请选择完整的开始和结束时间");
      return;
    }
    if (to.getTime() <= from.getTime()) {
      setError("结束时间必须晚于开始时间");
      return;
    }
    if (to.getTime() - from.getTime() > data.maxRangeDays * 24 * 60 * 60 * 1_000) {
      setError(`单次时间范围最长为 ${data.maxRangeDays} 天`);
      return;
    }
    if (to.getTime() > Date.now() + 60_000) {
      setError("结束时间不能位于未来");
      return;
    }
    await loadRange(from, to, "custom");
    setCustomOpen(false);
  }

  const kpis = [
    {
      label: "浏览量",
      value: numberFormatter.format(data.opens),
      detail: `${numberFormatter.format(data.sessions)} 次有效会话`,
      icon: EyeIcon,
    },
    {
      label: "独立访客",
      value: numberFormatter.format(data.uniqueVisitors),
      detail: "当前所选时间范围",
      icon: UsersIcon,
    },
    {
      label: "下载量",
      value: numberFormatter.format(data.downloads),
      detail: "普通图与原图实际签发次数",
      icon: DownloadIcon,
    },
    {
      label: "照片总数",
      value: numberFormatter.format(data.mediaCount),
      detail: `逻辑存储 ${formatBytes(data.logicalBytes)}`,
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
            查看所选时间范围内的访问、下载和单张照片下载排行。
          </p>
        </div>
        <div className="flex gap-2">
          <Link className={buttonVariants({ variant: "outline" })} href="/studio/albums">
            管理活动
          </Link>
          {canCreateAlbum ? <CreateAlbumForm /> : null}
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <CalendarRangeIcon
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{rangeText(data)}</p>
              <p className="text-xs text-muted-foreground">
                自动聚合粒度：{bucketLabels[data.bucket]}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1 lg:pb-0">
            {presets.map((preset) => (
              <Button
                aria-pressed={activePreset === preset.key}
                disabled={pending}
                key={preset.key}
                onClick={() => void selectPreset(preset.key)}
                size="sm"
                variant={activePreset === preset.key ? "default" : "outline"}
              >
                {preset.label}
              </Button>
            ))}
            <Button
              aria-pressed={activePreset === "custom"}
              disabled={pending}
              onClick={() => {
                setCustomFrom(localInputValue(new Date(data.from)));
                setCustomTo(localInputValue(new Date(data.to)));
                setCustomOpen(true);
              }}
              size="sm"
              variant={activePreset === "custom" ? "default" : "outline"}
            >
              自定义
            </Button>
            <Button
              disabled={pending}
              onClick={() => void refresh()}
              size="icon-sm"
              title="刷新当前范围"
              variant="ghost"
            >
              <RefreshCwIcon
                aria-hidden="true"
                className={cn("size-4", pending && "animate-spin")}
              />
              <span className="sr-only">刷新当前范围</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {error === null ? null : (
        <div
          className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          {error}
        </div>
      )}

      <div className={cn("grid gap-4 sm:grid-cols-2 xl:grid-cols-4", pending && "opacity-60")}>
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
        <Card className={cn(pending && "opacity-60")}>
          <CardHeader>
            <CardTitle>访问与下载趋势</CardTitle>
            <CardDescription>缩放时间范围后，数据桶会自动切换分钟、小时或天粒度</CardDescription>
          </CardHeader>
          <CardContent>
            <AnalyticsTrendChart data={points} />
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
        <Card className={cn(pending && "opacity-60")}>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>照片下载排行</CardTitle>
                <CardDescription>精确按单张照片统计，并跟随当前时间范围</CardDescription>
              </div>
              <DownloadIcon aria-hidden="true" className="size-5 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {data.topPhotos.length === 0 ? (
              <div className="flex min-h-52 items-center justify-center rounded-xl border border-dashed bg-muted/20 px-6 text-center text-sm text-muted-foreground">
                当前时间范围内暂无照片下载记录。
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {data.topPhotos.map((photo, index) => (
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
                      <Badge
                        className="absolute top-1 left-1 h-6 min-w-6 justify-center px-1.5"
                        variant="secondary"
                      >
                        {index + 1}
                      </Badge>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{photo.albumTitle}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        照片 #{photo.publishSequence}
                      </p>
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
                <p className="py-5 text-center text-sm text-muted-foreground">
                  当前没有直播中的活动。
                </p>
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
                <p className="mt-2 text-2xl font-semibold">{formatBytes(data.logicalBytes)}</p>
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

      <Dialog open={customOpen} onOpenChange={setCustomOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>自定义统计时间范围</DialogTitle>
            <DialogDescription>
              可选择最近 {data.maxRangeDays} 天内的任意起止时间。短区间会自动使用更细的数据粒度。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="dashboard-from">开始时间</Label>
              <Input
                id="dashboard-from"
                onChange={(event) => setCustomFrom(event.target.value)}
                type="datetime-local"
                value={customFrom}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="dashboard-to">结束时间</Label>
              <Input
                id="dashboard-to"
                onChange={(event) => setCustomTo(event.target.value)}
                type="datetime-local"
                value={customTo}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setCustomOpen(false)} variant="outline">
              取消
            </Button>
            <Button disabled={pending} onClick={() => void applyCustomRange()}>
              应用范围
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
