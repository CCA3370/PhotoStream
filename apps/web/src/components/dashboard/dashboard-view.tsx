"use client";

import type { AlbumSummaryView } from "@photostream/contracts";
import {
  ArrowUpRightIcon,
  CalendarRangeIcon,
  DownloadIcon,
  EyeIcon,
  HeartIcon,
  ImagesIcon,
  RadioIcon,
  RefreshCwIcon,
  UsersIcon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";

import { CreateAlbumForm } from "@/components/albums/create-album-form";
import { AnalyticsTrendChart } from "@/components/dashboard/dashboard-charts";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  readonly topLikedPhotos: readonly {
    readonly mediaId: string;
    readonly albumId: string;
    readonly albumTitle: string;
    readonly publishSequence: number;
    readonly likes: number;
    readonly thumbnailUrl: string | null;
    readonly capturedAt: string | null;
  }[];
}

type PresetKey = "30d" | "7d" | "1d" | "5h" | "1h" | "30m" | "custom";

interface RankingItem {
  readonly mediaId: string;
  readonly albumId: string;
  readonly albumTitle: string;
  readonly publishSequence: number;
  readonly thumbnailUrl: string | null;
  readonly count: number;
}

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
  "5m": "5 分钟粒度",
  "30m": "30 分钟粒度",
  "1h": "1 小时粒度",
  "6h": "6 小时粒度",
  "1d": "1 天粒度",
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

function RankingList({
  items,
  unit,
}: Readonly<{
  items: readonly RankingItem[];
  unit: string;
}>) {
  if (items.length === 0) {
    return <div className="py-12 text-center text-sm text-muted-foreground">暂无排行数据</div>;
  }

  return (
    <div className="divide-y">
      {items.map((photo, index) => (
        <Link
          className="group grid grid-cols-[1.75rem_4rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/50"
          href={`/studio/albums/${photo.albumId}`}
          key={photo.mediaId}
        >
          <span className="text-center text-xs font-semibold tabular-nums text-muted-foreground">
            {String(index + 1).padStart(2, "0")}
          </span>
          <div className="relative aspect-[4/3] w-16 overflow-hidden rounded-md bg-muted">
            {photo.thumbnailUrl === null ? (
              <div className="flex size-full items-center justify-center text-muted-foreground">
                <ImagesIcon aria-hidden="true" className="size-4" />
              </div>
            ) : (
              <Image
                alt="排行照片缩略图"
                fill
                sizes="64px"
                src={photo.thumbnailUrl}
                style={{ objectFit: "cover" }}
                unoptimized
              />
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{photo.albumTitle}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">照片 #{photo.publishSequence}</p>
          </div>
          <div className="flex items-center gap-2 pl-2">
            <span className="text-sm font-semibold tabular-nums">
              {numberFormatter.format(photo.count)} {unit}
            </span>
            <ArrowUpRightIcon
              aria-hidden="true"
              className="size-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
            />
          </div>
        </Link>
      ))}
    </div>
  );
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
  const liveAlbums = useMemo(
    () => albums.filter((album) => album.state === "live").slice(0, 5),
    [albums],
  );
  const downloadRanking = useMemo<RankingItem[]>(
    () => data.topPhotos.map((photo) => ({ ...photo, count: photo.downloads })),
    [data.topPhotos],
  );
  const likeRanking = useMemo<RankingItem[]>(
    () => data.topLikedPhotos.map((photo) => ({ ...photo, count: photo.likes })),
    [data.topLikedPhotos],
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
      meta: `${numberFormatter.format(data.sessions)} 会话`,
      icon: EyeIcon,
    },
    {
      label: "独立访客",
      value: numberFormatter.format(data.uniqueVisitors),
      meta: null,
      icon: UsersIcon,
    },
    {
      label: "下载量",
      value: numberFormatter.format(data.downloads),
      meta: null,
      icon: DownloadIcon,
    },
    {
      label: "照片总数",
      value: numberFormatter.format(data.mediaCount),
      meta: formatBytes(data.logicalBytes),
      icon: ImagesIcon,
    },
  ] as const;

  return (
    <section aria-label="首页统计" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link
          className={buttonVariants({ size: "sm", variant: "outline" })}
          href="/studio/albums"
        >
          管理活动
        </Link>
        {canCreateAlbum ? <CreateAlbumForm /> : null}
      </div>

      <div className={cn("grid gap-3 sm:grid-cols-2 xl:grid-cols-4", pending && "opacity-60")}>
        {kpis.map(({ label, value, meta, icon: Icon }) => (
          <Card className="shadow-none" key={label}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">{label}</p>
                <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
              </div>
              <div className="mt-2 flex items-end justify-between gap-3">
                <p className="text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
                {meta === null ? null : (
                  <p className="pb-0.5 text-xs tabular-nums text-muted-foreground">{meta}</p>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className={cn("overflow-hidden", pending && "opacity-60")}>
        <CardHeader className="gap-3 border-b py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <CardTitle>访问趋势</CardTitle>
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarRangeIcon aria-hidden="true" className="size-3.5" />
                {rangeText(data)}
              </span>
              <Badge className="font-normal" variant="outline">
                {bucketLabels[data.bucket]}
              </Badge>
            </div>
            <div className="flex max-w-full items-center gap-1.5 overflow-x-auto pb-0.5">
              {presets.map((preset) => (
                <Button
                  aria-pressed={activePreset === preset.key}
                  disabled={pending}
                  key={preset.key}
                  onClick={() => void selectPreset(preset.key)}
                  size="sm"
                  variant={activePreset === preset.key ? "secondary" : "ghost"}
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
                variant={activePreset === "custom" ? "secondary" : "ghost"}
              >
                自定义
              </Button>
              <Button
                disabled={pending}
                onClick={() => void refresh()}
                size="icon-sm"
                title="刷新"
                variant="ghost"
              >
                <RefreshCwIcon
                  aria-hidden="true"
                  className={cn("size-4", pending && "animate-spin")}
                />
                <span className="sr-only">刷新</span>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-3 pt-4 pb-3 sm:px-5">
          <AnalyticsTrendChart data={points} />
        </CardContent>
      </Card>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.7fr)]">
        <Card className={cn("overflow-hidden", pending && "opacity-60")}>
          <Tabs className="gap-0" defaultValue="downloads">
            <CardHeader className="flex flex-row items-center justify-between gap-3 border-b py-4">
              <CardTitle>照片排行</CardTitle>
              <TabsList>
                <TabsTrigger value="downloads">
                  <DownloadIcon aria-hidden="true" />
                  下载
                </TabsTrigger>
                <TabsTrigger value="likes">
                  <HeartIcon aria-hidden="true" />
                  点赞
                </TabsTrigger>
              </TabsList>
            </CardHeader>
            <CardContent className="px-2 py-1">
              <TabsContent value="downloads">
                <RankingList items={downloadRanking} unit="次" />
              </TabsContent>
              <TabsContent value="likes">
                <RankingList items={likeRanking} unit="赞" />
              </TabsContent>
            </CardContent>
          </Tabs>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="border-b py-4">
            <CardTitle className="flex items-center gap-2">
              <RadioIcon aria-hidden="true" className="size-4 text-success" />
              正在直播
            </CardTitle>
          </CardHeader>
          <CardContent className="p-2">
            {liveAlbums.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">暂无直播活动</p>
            ) : (
              <div className="divide-y">
                {liveAlbums.map((album) => (
                  <Link
                    className="flex items-center justify-between gap-3 rounded-lg px-2 py-3 hover:bg-muted/50"
                    href={`/studio/albums/${album.id}`}
                    key={album.id}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{album.title}</p>
                      <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                        {album.mediaCount} 张
                      </p>
                    </div>
                    <ArrowUpRightIcon aria-hidden="true" className="size-4 text-muted-foreground" />
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={customOpen} onOpenChange={setCustomOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>自定义统计时间范围</DialogTitle>
            <DialogDescription>
              可选择最近 {data.maxRangeDays} 天内的任意起止时间。
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

      <ErrorDialog message={error} onClose={() => setError(null)} title="统计操作失败" />
    </section>
  );
}
