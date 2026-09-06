"use client";

import type { AlbumSummaryView, UserRole } from "@photostream/contracts";
import {
  ArrowUpRightIcon,
  HardDriveIcon,
  ImageIcon,
  InboxIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
              onChange={(event) => setQuery(event.currentTarget.value)}
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
                      <span>{album.publishMode === "review" ? "审核后发布" : "自动发布"}</span>
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
                        album.pendingReviewCount > 0 && "text-amber-700 dark:text-amber-400",
                      )}
                    >
                      <InboxIcon
                        aria-hidden="true"
                        className={cn(
                          "size-3.5 shrink-0",
                          album.pendingReviewCount === 0 && "text-muted-foreground",
                        )}
                      />
                      <span className="truncate">
                        <span className="font-medium tabular-nums">{album.pendingReviewCount}</span>{" "}
                        <span
                          className={
                            album.pendingReviewCount === 0 ? "text-muted-foreground" : undefined
                          }
                        >
                          待审核
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
                    className="size-4 justify-self-end text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground"
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
