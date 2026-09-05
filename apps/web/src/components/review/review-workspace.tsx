"use client";

import type { AlbumUploaderView, InternalMediaList, InternalMediaView } from "@photostream/contracts";
import {
  EyeIcon,
  EyeOffIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  SendIcon,
  StarIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ErrorDialog } from "@/components/ui/error-dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { clientGet, clientMutation } from "@/lib/client-api";
import {
  deleteLocalReviewPhoto,
  listLocalReviewPhotos,
  patchLocalReviewPhoto,
  type LocalReviewPhoto,
} from "@/lib/local-review-queue";
import { publishLocalReviewPhoto } from "@/lib/publish-local-photo";
import { cn } from "@/lib/utils";

interface CategoryOption {
  readonly id: string;
  readonly name: string;
}

type FilterMode = "all" | "featured" | "hidden" | "local" | "published";

interface LocalView {
  readonly photo: LocalReviewPhoto;
  readonly originalUrl: string;
  readonly previewUrl: string;
}

type ReviewItem =
  | {
      readonly key: string;
      readonly source: "local";
      readonly local: LocalView;
      readonly previewUrl: string;
      readonly originalUrl: string;
      readonly categoryId: string | null;
      readonly uploaderId: null;
      readonly featured: boolean;
      readonly publicationStatus: "local";
      readonly createdAt: string;
    }
  | {
      readonly key: string;
      readonly source: "remote";
      readonly remote: InternalMediaView;
      readonly previewUrl: string | null;
      readonly originalUrl: string | null;
      readonly categoryId: string | null;
      readonly uploaderId: string;
      readonly featured: boolean;
      readonly publicationStatus: InternalMediaView["publicationStatus"];
      readonly createdAt: string;
    };

function preview(media: InternalMediaView): string | null {
  return (
    media.variants.find((variant) => variant.kind === "photo_480")?.url ??
    media.variants.find((variant) => variant.kind === "photo_960")?.url ??
    media.variants.find((variant) => variant.kind === "photo_1920")?.url ??
    null
  );
}

function original(media: InternalMediaView): string | null {
  return (
    media.variants.find((variant) => variant.kind === "photo_original")?.url ??
    media.variants.find((variant) => variant.kind === "photo_1920")?.url ??
    preview(media)
  );
}

function mergeRemote(
  current: readonly InternalMediaView[],
  incoming: readonly InternalMediaView[],
): readonly InternalMediaView[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function ReviewWorkspace({
  albumId,
  categories,
  initialPage,
  userRole,
  uploaders,
}: Readonly<{
  albumId: string;
  categories: readonly CategoryOption[];
  initialPage: InternalMediaList;
  userRole: "admin" | "reviewer";
  uploaders: readonly AlbumUploaderView[];
}>) {
  const localUrls = useRef<string[]>([]);
  const noticeTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const deleteTap = useRef<{ readonly key: string; readonly at: number } | null>(null);
  const loadingMoreRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [remoteMedia, setRemoteMedia] = useState<readonly InternalMediaView[]>(initialPage.items);
  const [cursor, setCursor] = useState(initialPage.nextCursor);
  const [localMedia, setLocalMedia] = useState<readonly LocalView[]>([]);
  const [featuredIds, setFeaturedIds] = useState<ReadonlySet<string>>(new Set());
  const [filter, setFilter] = useState<FilterMode>("all");
  const [category, setCategory] = useState("all");
  const [uploader, setUploader] = useState("all");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(new Set());
  const [loadingMore, setLoadingMore] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const showNotice = useCallback((text: string) => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    setNotice(text);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 2_000);
  }, []);

  const refreshLocal = useCallback(async () => {
    const rows = await listLocalReviewPhotos(albumId);
    for (const url of localUrls.current) URL.revokeObjectURL(url);
    const next = rows.map((photo) => {
      const thumb =
        photo.variants.find((variant) => variant.kind === "photo_480")?.blob ?? photo.originalBlob;
      return {
        photo,
        previewUrl: URL.createObjectURL(thumb),
        originalUrl: URL.createObjectURL(photo.originalBlob),
      };
    });
    localUrls.current = next.flatMap((item) => [item.previewUrl, item.originalUrl]);
    setLocalMedia(next);
  }, [albumId]);

  const refreshFeatured = useCallback(async () => {
    const result = await clientGet<{ readonly mediaIds: readonly string[] }>(
      `/api/v1/albums/${albumId}/featured`,
    );
    setFeaturedIds(new Set(result.mediaIds));
  }, [albumId]);

  const fetchRemote = useCallback(
    async (pageCursor?: string): Promise<InternalMediaList> => {
      const query = new URLSearchParams({ limit: "60" });
      if (pageCursor !== undefined) query.set("cursor", pageCursor);
      return clientGet<InternalMediaList>(`/api/v1/albums/${albumId}/media?${query.toString()}`);
    },
    [albumId],
  );

  const refreshRemote = useCallback(async () => {
    const page = await fetchRemote();
    setRemoteMedia((current) => mergeRemote(current, page.items));
    setCursor(page.nextCursor);
  }, [fetchRemote]);

  useEffect(() => {
    void Promise.all([refreshLocal(), refreshFeatured()]).catch((cause) => {
      setError(cause instanceof Error ? cause.message : "审核数据加载失败");
    });
    const localChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ readonly albumId?: string }>).detail;
      if (detail?.albumId === albumId) void refreshLocal();
    };
    window.addEventListener("photostream:local-review-changed", localChanged);
    return () => {
      window.removeEventListener("photostream:local-review-changed", localChanged);
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
      for (const url of localUrls.current) URL.revokeObjectURL(url);
      localUrls.current = [];
    };
  }, [albumId, refreshFeatured, refreshLocal]);

  const items = useMemo<readonly ReviewItem[]>(() => {
    const localItems: ReviewItem[] = localMedia.map((item) => ({
      key: `local:${item.photo.id}`,
      source: "local",
      local: item,
      previewUrl: item.previewUrl,
      originalUrl: item.originalUrl,
      categoryId: item.photo.categoryId,
      uploaderId: null,
      featured: item.photo.featured,
      publicationStatus: "local",
      createdAt: item.photo.createdAt,
    }));
    const remoteItems: ReviewItem[] = remoteMedia
      .filter((item) => item.publicationStatus !== "deleted")
      .map((item) => ({
        key: `remote:${item.id}`,
        source: "remote",
        remote: item,
        previewUrl: preview(item),
        originalUrl: original(item),
        categoryId: item.categoryId,
        uploaderId: item.uploaderId,
        featured: featuredIds.has(item.id),
        publicationStatus: item.publicationStatus,
        createdAt: item.createdAt,
      }));
    return [...localItems, ...remoteItems].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    );
  }, [featuredIds, localMedia, remoteMedia]);

  const visibleItems = useMemo(
    () =>
      items.filter((item) => {
        if (category !== "all" && item.categoryId !== category) return false;
        if (uploader !== "all" && item.uploaderId !== uploader) return false;
        if (filter === "local") return item.source === "local";
        if (filter === "featured") return item.featured;
        if (filter === "published") {
          return item.source === "remote" && item.publicationStatus === "published";
        }
        if (filter === "hidden") {
          return item.source === "remote" && item.publicationStatus === "hidden";
        }
        return true;
      }),
    [category, filter, items, uploader],
  );

  const activeIndex = activeKey === null ? -1 : visibleItems.findIndex((item) => item.key === activeKey);
  const activeItem = activeIndex < 0 ? null : visibleItems[activeIndex] ?? null;

  function setPending(key: string, value: boolean): void {
    setPendingKeys((current) => {
      const next = new Set(current);
      if (value) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  async function toggleFeatured(item: ReviewItem): Promise<void> {
    if (pendingKeys.has(item.key)) return;
    setPending(item.key, true);
    try {
      const next = !item.featured;
      if (item.source === "local") {
        await patchLocalReviewPhoto(item.local.photo.id, { featured: next });
      } else {
        await clientMutation(`/api/v1/media/${item.remote.id}/featured`, {
          body: { featured: next },
        });
        setFeaturedIds((current) => {
          const updated = new Set(current);
          if (next) updated.add(item.remote.id);
          else updated.delete(item.remote.id);
          return updated;
        });
      }
      showNotice(next ? "已设为精选" : "已取消精选");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "精选状态修改失败");
    } finally {
      setPending(item.key, false);
    }
  }

  async function publish(item: ReviewItem): Promise<void> {
    if (pendingKeys.has(item.key)) return;
    setPending(item.key, true);
    try {
      if (item.source === "local") {
        await publishLocalReviewPhoto(item.local.photo);
        await deleteLocalReviewPhoto(item.local.photo.id);
        await Promise.all([refreshRemote(), refreshFeatured()]);
      } else {
        await clientMutation<{ readonly ok: true }>(`/api/v1/media/${item.remote.id}/publish`, {
          idempotencyKey: `review-publish-${crypto.randomUUID()}`,
        });
        setRemoteMedia((current) =>
          current.map((candidate) =>
            candidate.id === item.remote.id
              ? { ...candidate, publicationStatus: "published" as const }
              : candidate,
          ),
        );
      }
      showNotice("已发布");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "发布失败");
    } finally {
      setPending(item.key, false);
    }
  }

  async function toggleVisibility(item: ReviewItem): Promise<void> {
    if (item.source === "local" || pendingKeys.has(item.key)) return;
    if (item.publicationStatus !== "published" && item.publicationStatus !== "hidden") return;
    setPending(item.key, true);
    try {
      const hiding = item.publicationStatus === "published";
      await clientMutation<{ readonly ok: true }>(
        `/api/v1/media/${item.remote.id}/${hiding ? "hide" : "restore"}`,
        { idempotencyKey: `review-visibility-${crypto.randomUUID()}` },
      );
      setRemoteMedia((current) =>
        current.map((candidate) =>
          candidate.id === item.remote.id
            ? {
                ...candidate,
                publicationStatus: hiding ? ("hidden" as const) : ("published" as const),
              }
            : candidate,
        ),
      );
      showNotice(hiding ? "已隐藏" : "已显示");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "可见状态修改失败");
    } finally {
      setPending(item.key, false);
    }
  }

  async function deleteItem(item: ReviewItem): Promise<void> {
    if (pendingKeys.has(item.key)) return;
    if (item.source === "remote" && userRole !== "admin") return;
    setPending(item.key, true);
    try {
      if (item.source === "local") {
        await deleteLocalReviewPhoto(item.local.photo.id);
      } else {
        await clientMutation(`/api/v1/media/${item.remote.id}/direct`, { method: "DELETE" });
        setRemoteMedia((current) => current.filter((candidate) => candidate.id !== item.remote.id));
        setFeaturedIds((current) => {
          const next = new Set(current);
          next.delete(item.remote.id);
          return next;
        });
      }
      if (activeKey === item.key) setActiveKey(null);
      showNotice("已删除");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除失败");
    } finally {
      setPending(item.key, false);
    }
  }

  async function stateAction(item: ReviewItem): Promise<void> {
    if (item.source === "local") {
      await publish(item);
      return;
    }
    if (item.publicationStatus === "published" || item.publicationStatus === "hidden") {
      await toggleVisibility(item);
      return;
    }
    await publish(item);
  }

  const loadMore = useCallback(async () => {
    if (cursor === null || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await fetchRemote(cursor);
      setRemoteMedia((current) => mergeRemote(current, page.items));
      setCursor(page.nextCursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载更多图片失败");
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [cursor, fetchRemote]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (sentinel === null || cursor === null) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [cursor, loadMore]);

  useEffect(() => {
    if (activeItem === null) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        const nextIndex = activeIndex + direction;
        if (nextIndex >= 0 && nextIndex < visibleItems.length) {
          setActiveKey(visibleItems[nextIndex]?.key ?? null);
        }
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        if (
          activeItem.source === "remote" &&
          (activeItem.publicationStatus === "published" || activeItem.publicationStatus === "hidden")
        ) {
          void toggleVisibility(activeItem);
        }
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        void toggleFeatured(activeItem);
        return;
      }
      if (event.key === "Delete") {
        event.preventDefault();
        const now = Date.now();
        if (deleteTap.current?.key === activeItem.key && now - deleteTap.current.at <= 900) {
          deleteTap.current = null;
          void deleteItem(activeItem);
        } else {
          deleteTap.current = { key: activeItem.key, at: now };
        }
        return;
      }
      if (event.key === "Escape") setActiveKey(null);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [activeIndex, activeItem, visibleItems]);

  const filters: readonly { readonly id: FilterMode; readonly label: string }[] = [
    { id: "all", label: "全部" },
    { id: "local", label: "待发布" },
    { id: "published", label: "已发布" },
    { id: "hidden", label: "已隐藏" },
    { id: "featured", label: "精选" },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border bg-card px-2 py-1.5">
        <div className="flex items-center gap-1 overflow-x-auto">
          {filters.map((item) => (
            <Button
              className="h-7 shrink-0 px-2.5 text-xs"
              key={item.id}
              onClick={() => setFilter(item.id)}
              size="sm"
              type="button"
              variant={filter === item.id ? "secondary" : "ghost"}
            >
              {item.label}
            </Button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {categories.length === 0 ? null : (
            <Select
              items={[
                { label: "全部分类", value: "all" },
                ...categories.map((item) => ({ label: item.name, value: item.id })),
              ]}
              onValueChange={(value) => setCategory(value ?? "all")}
              value={category}
            >
              <SelectTrigger className="h-7 w-28 text-xs" aria-label="分类筛选">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">全部分类</SelectItem>
                  {categories.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
          {uploaders.length === 0 ? null : (
            <Select
              items={[
                { label: "全部上传者", value: "all" },
                ...uploaders.map((item) => ({ label: item.displayName, value: item.id })),
              ]}
              onValueChange={(value) => setUploader(value ?? "all")}
              value={uploader}
            >
              <SelectTrigger className="h-7 w-28 text-xs" aria-label="上传者筛选">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">全部上传者</SelectItem>
                  {uploaders.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.displayName}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
          <Button
            aria-label="刷新审核列表"
            className="size-7"
            onClick={() =>
              void Promise.all([refreshLocal(), refreshRemote(), refreshFeatured()]).catch((cause) =>
                setError(cause instanceof Error ? cause.message : "刷新失败"),
              )
            }
            size="icon"
            type="button"
            variant="ghost"
          >
            <RefreshCwIcon className="size-3.5" />
          </Button>
        </div>
      </div>

      {visibleItems.length === 0 ? (
        <div className="flex min-h-56 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          当前筛选没有图片
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {visibleItems.map((item) => {
            const pending = pendingKeys.has(item.key);
            const published = item.source === "remote" && item.publicationStatus === "published";
            const hidden = item.source === "remote" && item.publicationStatus === "hidden";
            return (
              <button
                className="group relative aspect-square overflow-hidden rounded-md bg-muted text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                key={item.key}
                onClick={() => setActiveKey(item.key)}
                type="button"
              >
                {item.previewUrl === null ? null : (
                  <Image
                    alt="审核图片"
                    className="object-cover"
                    fill
                    sizes="(max-width: 639px) 50vw, (max-width: 767px) 33vw, 20vw"
                    src={item.previewUrl}
                    unoptimized
                  />
                )}
                <div className="absolute inset-x-0 top-0 flex justify-end gap-1 p-1.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  <Button
                    aria-label={item.featured ? "取消精选" : "设为精选"}
                    className={cn(
                      "size-8 bg-black/70 text-white hover:bg-black/85",
                      item.featured && "text-amber-400",
                    )}
                    disabled={pending}
                    onClick={(event) => {
                      event.stopPropagation();
                      void toggleFeatured(item);
                    }}
                    size="icon"
                    title={item.featured ? "取消精选" : "精选"}
                    type="button"
                    variant="ghost"
                  >
                    <StarIcon className={cn("size-4", item.featured && "fill-current")} />
                  </Button>
                  <Button
                    aria-label={published ? "隐藏" : hidden ? "显示" : "发布"}
                    className={cn(
                      "size-8 bg-black/70 text-white hover:bg-black/85",
                      published && "bg-blue-600/90 hover:bg-blue-600",
                    )}
                    disabled={pending}
                    onClick={(event) => {
                      event.stopPropagation();
                      void stateAction(item);
                    }}
                    size="icon"
                    title={published ? "隐藏" : hidden ? "显示" : "发布"}
                    type="button"
                    variant="ghost"
                  >
                    {pending ? (
                      <LoaderCircleIcon className="size-4 animate-spin" />
                    ) : published ? (
                      <EyeIcon className="size-4" />
                    ) : hidden ? (
                      <EyeOffIcon className="size-4" />
                    ) : (
                      <SendIcon className="size-4" />
                    )}
                  </Button>
                  <Button
                    aria-label="删除"
                    className="size-8 bg-red-600/90 text-white hover:bg-red-600"
                    disabled={pending || (item.source === "remote" && userRole !== "admin")}
                    onClick={(event) => {
                      event.stopPropagation();
                      void deleteItem(item);
                    }}
                    size="icon"
                    title={item.source === "remote" && userRole !== "admin" ? "仅管理员可删除" : "删除"}
                    type="button"
                    variant="ghost"
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex h-8 items-center justify-center" ref={sentinelRef}>
        {loadingMore ? <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" /> : null}
      </div>

      {activeItem === null ? null : (
        <div
          aria-label="原图预览"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/95"
          onClick={() => setActiveKey(null)}
          role="dialog"
        >
          <Button
            aria-label="关闭原图"
            className="absolute right-3 top-3 z-10 size-9 bg-black/50 text-white hover:bg-black/70"
            onClick={() => setActiveKey(null)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <XIcon className="size-5" />
          </Button>
          {activeItem.originalUrl === null ? null : (
            <div className="absolute inset-4 sm:inset-8" onClick={(event) => event.stopPropagation()}>
              <Image
                alt="完整原图"
                className="object-contain"
                fill
                priority
                sizes="100vw"
                src={activeItem.originalUrl}
                unoptimized
              />
            </div>
          )}
        </div>
      )}

      {notice === null ? null : (
        <div className="pointer-events-none fixed inset-x-0 top-1/2 z-[70] flex -translate-y-1/2 justify-center px-4">
          <div className="rounded-md bg-black/85 px-4 py-2 text-sm font-medium text-white shadow-xl">
            {notice}
          </div>
        </div>
      )}

      <ErrorDialog message={error} onClose={() => setError(null)} title="操作失败" />
    </div>
  );
}
