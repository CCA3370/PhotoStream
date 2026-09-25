"use client";

import type { AlbumSummaryView, UserRole } from "@photostream/contracts";
import {
  AlertTriangleIcon,
  ArrowUpRightIcon,
  HardDriveIcon,
  ImageIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

type AlbumFilter = "all" | AlbumSummaryView["state"];
type DeletionProgress = NonNullable<AlbumSummaryView["deletionProgress"]>;

const stateLabels: Record<AlbumSummaryView["state"], string> = {
  draft: "草稿",
  live: "直播中",
  ended: "已结束",
  archived: "已归档",
  deleting: "删除中",
};

const filters: readonly { readonly id: AlbumFilter; readonly label: string }[] = [
  { id: "all", label: "全部" },
  { id: "live", label: "直播中" },
  { id: "draft", label: "草稿" },
  { id: "ended", label: "已结束" },
  { id: "archived", label: "已归档" },
  { id: "deleting", label: "删除中" },
];

const deletionPhaseLabels: Record<DeletionProgress["phase"], string> = {
  waiting_upload_expiry: "等待旧上传签名失效",
  object_cleanup: "清理对象存储与 CDN",
  face_cleanup: "清理人脸资源",
  finalizing: "执行最终数据库清理",
};

const deletionSourceLabels: Record<NonNullable<DeletionProgress["latestError"]>["source"], string> =
  {
    object_storage: "对象存储 / CDN",
    face_provider: "人脸云端服务",
    face_reference: "人脸参考照",
  };

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "short",
  timeStyle: "medium",
  timeZone: "Asia/Shanghai",
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

function formatDateTime(value: string): string {
  return dateTimeFormatter.format(new Date(value));
}

function countForFilter(albums: readonly AlbumSummaryView[], filter: AlbumFilter): number {
  if (filter === "all") return albums.length;
  return albums.filter((album) => album.state === filter).length;
}

function statusVariant(state: AlbumSummaryView["state"]): "default" | "outline" | "secondary" {
  if (state === "live") return "default";
  if (state === "archived") return "outline";
  return "secondary";
}

function cleanupStatusLabel(
  status: DeletionProgress["objectCleanup"]["status"] | DeletionProgress["faceCleanup"]["status"],
): string {
  if (status === "complete") return "已完成";
  if (status === "retrying") return "自动重试中";
  if (status === "running") return "正在清理";
  if (status === "waiting") return "等待最终复扫";
  return "等待清理";
}

function DeletingAlbumRow({
  album,
  onRefresh,
}: Readonly<{
  album: AlbumSummaryView;
  onRefresh: () => void;
}>) {
  const progress = album.deletionProgress;

  return (
    <div className="px-4 py-4" data-album-deletion-progress={album.id}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold">{album.title}</p>
            <Badge variant="secondary">删除中</Badge>
            <span className="text-[11px] text-muted-foreground">自动每 10 秒更新</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            活动已停止访问。所有清理完成后，此记录会自动从列表消失。
          </p>
        </div>
        <Button onClick={onRefresh} size="sm" type="button" variant="outline">
          <RefreshCwIcon aria-hidden="true" />
          刷新状态
        </Button>
      </div>

      {progress === null ? (
        <div className="mt-4 rounded-lg border bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
          正在初始化删除任务状态…
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <Progress value={progress.progressPercent}>
            <ProgressLabel>阶段进度 · {deletionPhaseLabels[progress.phase]}</ProgressLabel>
            <ProgressValue />
          </Progress>

          <div className="grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border bg-muted/15 px-3 py-2.5">
              <p className="text-muted-foreground">对象存储 / CDN</p>
              <p className="mt-1 font-medium">
                {cleanupStatusLabel(progress.objectCleanup.status)}
                {progress.objectCleanup.attempts > 0
                  ? ` · 已重试 ${progress.objectCleanup.attempts} 次`
                  : ""}
              </p>
            </div>
            <div className="rounded-lg border bg-muted/15 px-3 py-2.5">
              <p className="text-muted-foreground">人脸资源</p>
              <p className="mt-1 font-medium">
                {cleanupStatusLabel(progress.faceCleanup.status)}
                {progress.faceCleanup.pendingReferences > 0
                  ? ` · ${progress.faceCleanup.pendingReferences} 个参考照待清理`
                  : ""}
                {progress.faceCleanup.attempts > 0
                  ? ` · 已重试 ${progress.faceCleanup.attempts} 次`
                  : ""}
              </p>
            </div>
            <div className="rounded-lg border bg-muted/15 px-3 py-2.5">
              <p className="text-muted-foreground">开始删除</p>
              <p className="mt-1 font-medium tabular-nums">{formatDateTime(progress.startedAt)}</p>
            </div>
            <div className="rounded-lg border bg-muted/15 px-3 py-2.5">
              <p className="text-muted-foreground">下次处理</p>
              <p className="mt-1 font-medium tabular-nums">
                {progress.nextAttemptAt === null
                  ? "后台持续检查"
                  : formatDateTime(progress.nextAttemptAt)}
              </p>
            </div>
          </div>

          {progress.latestError === null ? null : (
            <div className="flex gap-2 rounded-lg border border-amber-300/70 bg-amber-50/70 px-3 py-2.5 text-xs text-amber-950 dark:border-amber-800/70 dark:bg-amber-950/25 dark:text-amber-100">
              <AlertTriangleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0">
                <p className="font-medium">
                  最近错误 · {deletionSourceLabels[progress.latestError.source]}
                </p>
                <p className="mt-1 break-words leading-5">{progress.latestError.message}</p>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-amber-800/80 dark:text-amber-200/75">
                  {progress.latestError.code === null ? null : (
                    <span className="font-mono">代码：{progress.latestError.code}</span>
                  )}
                  <span className="tabular-nums">
                    {formatDateTime(progress.latestError.occurredAt)}
                  </span>
                </div>
              </div>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">
            最后更新：{formatDateTime(progress.lastUpdatedAt)}
          </p>
        </div>
      )}
    </div>
  );
}

export function AlbumManagementList({
  albums,
  role,
}: Readonly<{
  albums: readonly AlbumSummaryView[];
  role: UserRole;
}>) {
  const router = useRouter();
  const [filter, setFilter] = useState<AlbumFilter>("all");
  const [query, setQuery] = useState("");
  const deletingCount = albums.filter((album) => album.state === "deleting").length;

  useEffect(() => {
    if (deletingCount === 0) return;
    const timer = window.setInterval(() => {
      router.refresh();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [deletingCount, router]);

  const visibleAlbums = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return albums.filter((album) => {
      if (filter !== "all" && album.state !== filter) return false;
      if (normalizedQuery.length === 0) return true;
      return `${album.title}\n${album.description}\n${album.slug}`
        .toLocaleLowerCase("zh-CN")
        .includes(normalizedQuery);
    });
  }, [albums, filter, query]);

  const filtered = filter !== "all" || query.trim().length > 0;

  function clearFilters(): void {
    setFilter("all");
    setQuery("");
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 rounded-xl border bg-card p-2 shadow-none lg:flex-row lg:items-center lg:justify-between">
        <div className="flex max-w-full items-center gap-1 overflow-x-auto">
          {filters.map((item) => (
            <Button
              aria-pressed={filter === item.id}
              className="shrink-0 gap-1.5"
              key={item.id}
              onClick={() => setFilter(item.id)}
              size="sm"
              type="button"
              variant={filter === item.id ? "secondary" : "ghost"}
            >
              {item.label}
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {countForFilter(albums, item.id)}
              </span>
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2 lg:w-72">
          <div className="relative min-w-0 flex-1">
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              aria-label="搜索活动"
              className="h-8 pr-8 pl-8"
              onChange={(event) => {
                const { value } = event.currentTarget;
                setQuery(value);
              }}
              placeholder="搜索名称、说明或路径"
              value={query}
            />
            {query.length > 0 ? (
              <Button
                aria-label="清除搜索"
                className="absolute top-1/2 right-1 size-6 -translate-y-1/2"
                onClick={() => setQuery("")}
                size="icon-xs"
                type="button"
                variant="ghost"
              >
                <XIcon aria-hidden="true" />
              </Button>
            ) : null}
          </div>
          {filtered ? (
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {visibleAlbums.length}/{albums.length}
            </span>
          ) : null}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card shadow-none">
        {visibleAlbums.length === 0 ? (
          <div className="flex min-h-44 flex-col items-center justify-center gap-3 px-4 text-center">
            <p className="text-sm text-muted-foreground">没有符合条件的活动</p>
            {filtered ? (
              <Button onClick={clearFilters} size="sm" type="button" variant="outline">
                清除筛选
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="divide-y">
            {visibleAlbums.map((album) => {
              if (album.state === "deleting") {
                return (
                  <DeletingAlbumRow
                    album={album}
                    key={album.id}
                    onRefresh={() => router.refresh()}
                  />
                );
              }

              const href =
                role === "uploader"
                  ? `/studio/albums/${album.id}/upload`
                  : `/studio/albums/${album.id}`;
              return (
                <Link
                  className="group grid gap-3 px-4 py-3 outline-none transition-colors hover:bg-muted/30 focus-visible:bg-muted/40 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.9fr)_2rem] lg:items-center"
                  href={href}
                  key={album.id}
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold">{album.title}</p>
                      <Badge className="shrink-0" variant={statusVariant(album.state)}>
                        {stateLabels[album.state]}
                      </Badge>
                    </div>
                    {album.description.length === 0 ? null : (
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {album.description}
                      </p>
                    )}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span>{album.access === "password" ? "口令访问" : "公开访问"}</span>
                      <span aria-hidden="true">·</span>
                      <span>上传后默认隐藏</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">/{album.slug}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="flex min-w-0 items-center gap-2">
                      <ImageIcon
                        aria-hidden="true"
                        className="size-3.5 shrink-0 text-muted-foreground"
                      />
                      <span className="truncate">
                        <span className="font-medium tabular-nums">{album.mediaCount}</span>{" "}
                        <span className="text-muted-foreground">照片</span>
                      </span>
                    </div>
                    <div
                      className={cn(
                        "flex min-w-0 items-center gap-2",
                        album.incompleteCount > 0 && "text-amber-700 dark:text-amber-400",
                      )}
                    >
                      <LoaderCircleIcon
                        aria-hidden="true"
                        className={cn(
                          "size-3.5 shrink-0",
                          album.incompleteCount === 0 && "text-muted-foreground",
                        )}
                      />
                      <span className="truncate">
                        <span className="font-medium tabular-nums">{album.incompleteCount}</span>{" "}
                        <span
                          className={
                            album.incompleteCount === 0 ? "text-muted-foreground" : undefined
                          }
                        >
                          处理中
                        </span>
                      </span>
                    </div>
                    <div className="flex min-w-0 items-center gap-2">
                      <HardDriveIcon
                        aria-hidden="true"
                        className="size-3.5 shrink-0 text-muted-foreground"
                      />
                      <span className="truncate font-medium tabular-nums">
                        {formatBytes(album.logicalBytes)}
                      </span>
                    </div>
                  </div>

                  <ArrowUpRightIcon
                    aria-hidden="true"
                    className="size-4 justify-self-end text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
                  />
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
