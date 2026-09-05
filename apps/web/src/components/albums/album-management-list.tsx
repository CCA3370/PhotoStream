"use client";

import type { AlbumSummaryView, UserRole } from "@photostream/contracts";
import {
  ArrowRightIcon,
  HardDriveIcon,
  ImageIcon,
  InboxIcon,
  SearchIcon,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type AlbumFilter = "all" | AlbumSummaryView["state"];

const stateLabels: Record<AlbumSummaryView["state"], string> = {
  draft: "草稿",
  live: "直播中",
  ended: "已结束",
  archived: "已归档",
};

const filters: readonly { readonly id: AlbumFilter; readonly label: string }[] = [
  { id: "all", label: "全部" },
  { id: "live", label: "直播中" },
  { id: "draft", label: "草稿" },
  { id: "ended", label: "已结束" },
  { id: "archived", label: "已归档" },
];

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

function countForFilter(albums: readonly AlbumSummaryView[], filter: AlbumFilter): number {
  if (filter === "all") return albums.length;
  return albums.filter((album) => album.state === filter).length;
}

function statusVariant(state: AlbumSummaryView["state"]): "default" | "outline" | "secondary" {
  if (state === "live") return "default";
  if (state === "archived") return "outline";
  return "secondary";
}

export function AlbumManagementList({
  albums,
  role,
}: Readonly<{
  albums: readonly AlbumSummaryView[];
  role: UserRole;
}>) {
  const [filter, setFilter] = useState<AlbumFilter>("all");
  const [query, setQuery] = useState("");

  const visibleAlbums = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return albums.filter((album) => {
      if (filter !== "all" && album.state !== filter) return false;
      if (normalizedQuery.length === 0) return true;
      return `${album.title}\n${album.description}`.toLocaleLowerCase("zh-CN").includes(normalizedQuery);
    });
  }, [albums, filter, query]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 rounded-lg border bg-card p-2 lg:flex-row lg:items-center lg:justify-between">
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
        <div className="relative lg:w-64">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="搜索活动"
            className="h-8 pl-8"
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="搜索活动"
            value={query}
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        {visibleAlbums.length === 0 ? (
          <div className="flex min-h-40 items-center justify-center px-4 text-sm text-muted-foreground">
            没有符合条件的活动
          </div>
        ) : (
          <div className="divide-y">
            {visibleAlbums.map((album) => {
              const href =
                role === "uploader" ? `/studio/albums/${album.id}/upload` : `/studio/albums/${album.id}`;
              return (
                <div
                  className="grid gap-3 px-4 py-3 transition-colors hover:bg-muted/25 lg:grid-cols-[minmax(0,1.5fr)_minmax(360px,0.9fr)_auto] lg:items-center"
                  key={album.id}
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="truncate text-sm font-semibold">{album.title}</p>
                      <Badge className="shrink-0" variant={statusVariant(album.state)}>
                        {stateLabels[album.state]}
                      </Badge>
                    </div>
                    {album.description.length === 0 ? null : (
                      <p className="mt-1 truncate text-xs text-muted-foreground">{album.description}</p>
                    )}
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {album.access === "password" ? "口令访问" : "公开访问"}
                      <span aria-hidden="true" className="px-1.5">
                        ·
                      </span>
                      {album.publishMode === "review" ? "审核后发布" : "自动发布"}
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="flex min-w-0 items-center gap-2">
                      <ImageIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">
                        <span className="font-medium tabular-nums">{album.mediaCount}</span>{" "}
                        <span className="text-muted-foreground">照片</span>
                      </span>
                    </div>
                    <div className="flex min-w-0 items-center gap-2">
                      <InboxIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">
                        <span className="font-medium tabular-nums">{album.pendingReviewCount}</span>{" "}
                        <span className="text-muted-foreground">待审核</span>
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

                  <Link
                    className={cn(
                      buttonVariants({ size: "sm", variant: "outline" }),
                      "w-full justify-center lg:w-auto",
                    )}
                    href={href}
                  >
                    {role === "uploader" ? "上传" : "管理"}
                    <ArrowRightIcon aria-hidden="true" data-icon="inline-end" />
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
