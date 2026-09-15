"use client";

import type {
  AlbumUploaderView,
  BibConfigView,
  BibMediaState,
  InternalMediaList,
  InternalMediaView,
  MediaBatchResult,
} from "@photostream/contracts";
import {
  BadgeCheckIcon,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  HashIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  SendIcon,
  SquareIcon,
  StarIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BibReviewDialog, isBibReviewConfirmed } from "@/components/bib/bib-review-editor";
import { InternalCachedImage } from "@/components/media/internal-cached-image";
import {
  ReviewLightbox,
  type ReviewLightboxItem,
  type ReviewPendingAction,
} from "@/components/review/review-lightbox";
import { Badge } from "@/components/ui/badge";
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
import { toast } from "@/components/ui/toast";
import { clientGet, clientMutation } from "@/lib/client-api";
import { LOCAL_BIB_SERVER_STATE_EVENT, resumeLocalBibOcr } from "@/lib/local-bib-ocr";
import {
  confirmLocalBibNoNumber,
  confirmLocalBibNumbers,
  deleteLocalReviewPhoto,
  effectiveBibMediaState,
  type LocalReviewPhoto,
  listLocalReviewPhotos,
  localBibMediaState,
  localBibOcrPending,
  patchLocalReviewPhoto,
} from "@/lib/local-review-queue";
import { publishLocalReviewPhoto } from "@/lib/publish-local-photo";
import { cn } from "@/lib/utils";

interface CategoryOption {
  readonly id: string;
  readonly name: string;
}

type FilterMode = "all" | "featured" | "hidden" | "local" | "published";
type RemoteBatchAction = "change_category" | "hide" | "publish";

interface LocalView {
  readonly photo: LocalReviewPhoto;
  readonly originalUrl: string;
  readonly previewUrl: string;
}

interface LocalObjectUrls {
  readonly originalUrl: string;
  readonly previewUrl: string;
}

type ReviewItem =
  | {
      readonly key: string;
      readonly source: "local";
      readonly local: LocalView;
      readonly previewUrl: string;
      readonly viewerUrl: string;
      readonly viewerFallbackUrl: null;
      readonly remoteOriginalUrl: null;
      readonly localPreferred: true;
      readonly categoryId: string | null;
      readonly uploaderId: null;
      readonly featured: boolean;
      readonly publicationStatus: "local" | "published";
      readonly bib: BibMediaState;
      readonly createdAt: string;
    }
  | {
      readonly key: string;
      readonly source: "remote";
      readonly remote: InternalMediaView;
      readonly local: LocalView | null;
      readonly previewUrl: string | null;
      readonly viewerUrl: string | null;
      readonly viewerFallbackUrl: string | null;
      readonly remoteOriginalUrl: string | null;
      readonly localPreferred: boolean;
      readonly categoryId: string | null;
      readonly uploaderId: string;
      readonly featured: boolean;
      readonly publicationStatus: InternalMediaView["publicationStatus"];
      readonly bib: BibMediaState | null;
      readonly createdAt: string;
    };

interface BatchFailure {
  readonly label: string;
  readonly message: string;
}

function preview(media: InternalMediaView): string | null {
  return (
    media.variants.find((variant) => variant.kind === "photo_480")?.url ??
    media.variants.find((variant) => variant.kind === "photo_960")?.url ??
    media.variants.find((variant) => variant.kind === "photo_1920")?.url ??
    null
  );
}

function ordinary(media: InternalMediaView): string | null {
  return (
    media.variants.find((variant) => variant.kind === "photo_1920")?.url ??
    media.variants.find((variant) => variant.kind === "photo_960")?.url ??
    media.variants.find((variant) => variant.kind === "photo_480")?.url ??
    null
  );
}

function remoteOriginal(media: InternalMediaView): string | null {
  return media.variants.find((variant) => variant.kind === "photo_original")?.url ?? null;
}

function mergeRemote(
  current: readonly InternalMediaView[],
  incoming: readonly InternalMediaView[],
): readonly InternalMediaView[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function chunks<T>(items: readonly T[], size: number): readonly T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

export function ReviewWorkspace({
  albumId,
  albumTitle,
  bibConfig,
  categories,
  initialPage,
  userRole,
  uploaders,
}: Readonly<{
  albumId: string;
  albumTitle?: string;
  bibConfig: BibConfigView;
  categories: readonly CategoryOption[];
  initialPage: InternalMediaList;
  userRole: "admin" | "reviewer";
  uploaders: readonly AlbumUploaderView[];
}>) {
  const localUrlCache = useRef(new Map<string, LocalObjectUrls>());
  const loadingMoreRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const lastSelectedIndexRef = useRef<number | null>(null);
  const [remoteMedia, setRemoteMedia] = useState<readonly InternalMediaView[]>(initialPage.items);
  const [cursor, setCursor] = useState(initialPage.nextCursor);
  const [localMedia, setLocalMedia] = useState<readonly LocalView[]>([]);
  const [featuredIds, setFeaturedIds] = useState<ReadonlySet<string>>(new Set());
  const [filter, setFilter] = useState<FilterMode>("all");
  const [category, setCategory] = useState("all");
  const [uploader, setUploader] = useState("all");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [bibDialogKey, setBibDialogKey] = useState<string | null>(null);
  const [pendingActions, setPendingActions] = useState<ReadonlyMap<string, ReviewPendingAction>>(
    new Map(),
  );
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(new Set());
  const [batchCategory, setBatchCategory] = useState("uncategorized");
  const [batchBusy, setBatchBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showNotice = useCallback((text: string, type: "success" | "warning" = "success") => {
    toast.add({ title: text, type });
  }, []);

  const refreshLocal = useCallback(async () => {
    const rows = await listLocalReviewPhotos(albumId);
    const activeIds = new Set(rows.map((photo) => photo.id));
    for (const [photoId, urls] of localUrlCache.current) {
      if (activeIds.has(photoId)) continue;
      URL.revokeObjectURL(urls.previewUrl);
      URL.revokeObjectURL(urls.originalUrl);
      localUrlCache.current.delete(photoId);
    }
    const next = rows.map((photo) => {
      let urls = localUrlCache.current.get(photo.id);
      if (urls === undefined) {
        const thumb =
          photo.variants.find((variant) => variant.kind === "photo_480")?.blob ??
          photo.originalBlob;
        urls = {
          previewUrl: URL.createObjectURL(thumb),
          originalUrl: URL.createObjectURL(photo.originalBlob),
        };
        localUrlCache.current.set(photo.id, urls);
      }
      return { photo, previewUrl: urls.previewUrl, originalUrl: urls.originalUrl };
    });
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

  const refreshRemote = useCallback(async (): Promise<InternalMediaList> => {
    const page = await fetchRemote();
    setRemoteMedia((current) => mergeRemote(current, page.items));
    setCursor(page.nextCursor);
    return page;
  }, [fetchRemote]);

  const updateBibState = useCallback((mediaId: string, state: BibMediaState): void => {
    setRemoteMedia((current) =>
      current.map((media) => (media.id === mediaId ? { ...media, bib: state } : media)),
    );
  }, []);

  useEffect(() => {
    void Promise.all([
      refreshLocal(),
      refreshFeatured(),
      resumeLocalBibOcr(albumId, bibConfig),
    ]).catch((cause) => setError(cause instanceof Error ? cause.message : "审核数据加载失败"));
    const localChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ readonly albumId?: string }>).detail;
      if (detail?.albumId !== albumId) return;
      void refreshLocal();
      void resumeLocalBibOcr(albumId, bibConfig);
    };
    const serverBibChanged = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          readonly albumId?: string;
          readonly mediaId?: string | null;
          readonly state?: BibMediaState;
        }>
      ).detail;
      if (
        detail?.albumId !== albumId ||
        typeof detail.mediaId !== "string" ||
        detail.state === undefined
      ) {
        return;
      }
      updateBibState(detail.mediaId, detail.state);
    };
    window.addEventListener("photostream:local-review-changed", localChanged);
    window.addEventListener(LOCAL_BIB_SERVER_STATE_EVENT, serverBibChanged);
    return () => {
      window.removeEventListener("photostream:local-review-changed", localChanged);
      window.removeEventListener(LOCAL_BIB_SERVER_STATE_EVENT, serverBibChanged);
      for (const urls of localUrlCache.current.values()) {
        URL.revokeObjectURL(urls.previewUrl);
        URL.revokeObjectURL(urls.originalUrl);
      }
      localUrlCache.current.clear();
    };
  }, [albumId, bibConfig, refreshFeatured, refreshLocal, updateBibState]);

  const items = useMemo<readonly ReviewItem[]>(() => {
    const remoteIds = new Set(remoteMedia.map((item) => item.id));
    const localByMediaId = new Map<string, LocalView>();
    for (const item of localMedia) {
      if (item.photo.mediaId !== null) localByMediaId.set(item.photo.mediaId, item);
    }
    const localItems: ReviewItem[] = localMedia
      .filter((item) => item.photo.mediaId === null || !remoteIds.has(item.photo.mediaId))
      .map((item) => ({
        key: `local:${item.photo.id}`,
        source: "local",
        local: item,
        previewUrl: item.previewUrl,
        viewerUrl: item.originalUrl,
        viewerFallbackUrl: null,
        remoteOriginalUrl: null,
        localPreferred: true,
        categoryId: item.photo.categoryId,
        uploaderId: null,
        featured: item.photo.featured,
        publicationStatus:
          item.photo.uploadState === "published" && item.photo.mediaId !== null
            ? ("published" as const)
            : ("local" as const),
        bib: localBibMediaState(item.photo),
        createdAt: item.photo.createdAt,
      }));
    const remoteItems: ReviewItem[] = remoteMedia
      .filter((item) => item.publicationStatus !== "deleted")
      .map((item) => {
        const linkedLocal = localByMediaId.get(item.id) ?? null;
        const ordinaryUrl = ordinary(item);
        return {
          key: linkedLocal === null ? `remote:${item.id}` : `local:${linkedLocal.photo.id}`,
          source: "remote" as const,
          remote: item,
          local: linkedLocal,
          previewUrl: linkedLocal?.previewUrl ?? preview(item),
          viewerUrl: linkedLocal?.originalUrl ?? ordinaryUrl,
          viewerFallbackUrl: linkedLocal === null ? null : ordinaryUrl,
          remoteOriginalUrl: remoteOriginal(item),
          localPreferred: linkedLocal !== null,
          categoryId: item.categoryId,
          uploaderId: item.uploaderId,
          featured: featuredIds.has(item.id),
          publicationStatus: item.publicationStatus,
          bib:
            linkedLocal === null
              ? (item.bib ?? null)
              : effectiveBibMediaState(linkedLocal.photo, item.bib),
          createdAt: linkedLocal?.photo.createdAt ?? item.createdAt,
        };
      });
    return [...localItems, ...remoteItems].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    );
  }, [featuredIds, localMedia, remoteMedia]);

  const visibleItems = useMemo(
    () =>
      items.filter((item) => {
        if (category !== "all" && item.categoryId !== category) return false;
        if (uploader !== "all" && item.uploaderId !== uploader) return false;
        if (filter === "local")
          return item.source === "local" && item.publicationStatus === "local";
        if (filter === "featured") return item.featured;
        if (filter === "published") return item.publicationStatus === "published";
        if (filter === "hidden") return item.publicationStatus === "hidden";
        return true;
      }),
    [category, filter, items, uploader],
  );

  function resetSelection(): void {
    setSelectedKeys(new Set());
    lastSelectedIndexRef.current = null;
  }

  useEffect(() => {
    const validKeys = new Set(items.map((item) => item.key));
    setSelectedKeys((current) => {
      const next = new Set([...current].filter((key) => validKeys.has(key)));
      return next.size === current.size ? current : next;
    });
  }, [items]);

  const selectedItems = useMemo(
    () => visibleItems.filter((item) => selectedKeys.has(item.key)),
    [selectedKeys, visibleItems],
  );

  const lightboxSourceItems = useMemo(() => {
    if (activeKey === null || visibleItems.some((item) => item.key === activeKey))
      return visibleItems;
    const activeItem = items.find((item) => item.key === activeKey);
    return activeItem === undefined ? visibleItems : [...visibleItems, activeItem];
  }, [activeKey, items, visibleItems]);

  const lightboxItems = useMemo<readonly ReviewLightboxItem[]>(
    () =>
      lightboxSourceItems.map((item) => ({
        key: item.key,
        src: item.viewerUrl,
        variants: item.source === "remote" ? item.remote.variants : [],
        fallbackSrc: item.viewerFallbackUrl,
        originalSrc: item.remoteOriginalUrl,
        localPreferred: item.localPreferred,
        width: item.source === "local" ? item.local.photo.width : item.remote.width,
        height: item.source === "local" ? item.local.photo.height : item.remote.height,
        featured: item.featured,
        publicationStatus: item.publicationStatus,
        mediaId: item.source === "remote" ? item.remote.id : item.local.photo.mediaId,
        bib: item.bib,
        canDelete:
          item.source === "local"
            ? item.publicationStatus === "local" || userRole === "admin"
            : userRole === "admin",
        pendingAction: pendingActions.get(item.key) ?? null,
      })),
    [lightboxSourceItems, pendingActions, userRole],
  );

  function itemByKey(key: string): ReviewItem | null {
    return items.find((item) => item.key === key) ?? null;
  }

  function localPhoto(item: ReviewItem): LocalReviewPhoto | null {
    if (item.source === "local") return item.local.photo;
    return item.local?.photo ?? null;
  }

  function bibOcrIsPending(item: ReviewItem): boolean {
    const photo = localPhoto(item);
    if (photo !== null) return localBibOcrPending(photo);
    return item.bib?.review.ocrStatus === "processing";
  }

  async function confirmLocalNumbersByKey(
    key: string,
    numbers: readonly string[],
  ): Promise<BibMediaState> {
    const item = itemByKey(key);
    const photo = item === null ? null : localPhoto(item);
    if (photo === null || photo.mediaId !== null) throw new Error("本地号码状态不可用");
    const updated = await confirmLocalBibNumbers(photo.id, numbers, bibConfig.patterns);
    return localBibMediaState(updated);
  }

  async function confirmLocalNoNumberByKey(key: string): Promise<BibMediaState> {
    const item = itemByKey(key);
    const photo = item === null ? null : localPhoto(item);
    if (photo === null || photo.mediaId !== null) throw new Error("本地号码状态不可用");
    const updated = await confirmLocalBibNoNumber(photo.id);
    return localBibMediaState(updated);
  }

  function isPending(key: string): boolean {
    return pendingActions.has(key);
  }

  function setPending(key: string, action: ReviewPendingAction | null): void {
    setPendingActions((current) => {
      const next = new Map(current);
      if (action === null) next.delete(key);
      else next.set(key, action);
      return next;
    });
  }

  function remoteId(item: ReviewItem): string | null {
    if (item.source === "remote") return item.remote.id;
    return item.local.photo.mediaId;
  }

  function canDeleteItem(item: ReviewItem): boolean {
    if (item.source === "remote") return userRole === "admin";
    if (item.publicationStatus === "published") return userRole === "admin";
    return true;
  }

  async function toggleFeatured(item: ReviewItem): Promise<void> {
    if (isPending(item.key)) return;
    setPending(item.key, "featured");
    try {
      const next = !item.featured;
      const mediaId = remoteId(item);
      if (item.source === "local" && item.publicationStatus === "local") {
        await patchLocalReviewPhoto(item.local.photo.id, { featured: next });
      } else if (mediaId !== null) {
        await clientMutation(`/api/v1/media/${mediaId}/featured`, { body: { featured: next } });
        if (item.local !== null) {
          await patchLocalReviewPhoto(item.local.photo.id, { featured: next }).catch(
            () => undefined,
          );
        }
        setFeaturedIds((current) => {
          const updated = new Set(current);
          if (next) updated.add(mediaId);
          else updated.delete(mediaId);
          return updated;
        });
      }
      showNotice(next ? "已设为精选" : "已取消精选");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "精选状态修改失败");
    } finally {
      setPending(item.key, null);
    }
  }

  async function publish(item: ReviewItem): Promise<void> {
    if (isPending(item.key)) return;
    setPending(item.key, "state");
    try {
      if (item.source === "local") {
        if (item.publicationStatus === "published") return;
        const result = await publishLocalReviewPhoto(item.local.photo);
        await patchLocalReviewPhoto(item.local.photo.id, {
          mediaId: result.mediaId,
          uploadState: "published",
          error: null,
        });
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
      setPending(item.key, null);
    }
  }

  async function toggleVisibility(item: ReviewItem): Promise<void> {
    if (isPending(item.key)) return;
    if (item.publicationStatus !== "published" && item.publicationStatus !== "hidden") return;
    const mediaId = remoteId(item);
    if (mediaId === null) return;
    setPending(item.key, "state");
    try {
      const hiding = item.publicationStatus === "published";
      await clientMutation<{ readonly ok: true }>(
        `/api/v1/media/${mediaId}/${hiding ? "hide" : "restore"}`,
        { idempotencyKey: `review-visibility-${crypto.randomUUID()}` },
      );
      if (item.source === "remote") {
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
      } else {
        await refreshRemote();
      }
      showNotice(hiding ? "已隐藏" : "已显示");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "可见状态修改失败");
    } finally {
      setPending(item.key, null);
    }
  }

  async function deleteItem(item: ReviewItem): Promise<void> {
    if (isPending(item.key) || !canDeleteItem(item)) return;
    const currentIndex = lightboxSourceItems.findIndex((candidate) => candidate.key === item.key);
    const nextKey =
      activeKey === item.key && lightboxSourceItems.length > 1 && currentIndex >= 0
        ? (lightboxSourceItems[(currentIndex + 1) % lightboxSourceItems.length]?.key ?? null)
        : null;
    setPending(item.key, "delete");
    try {
      const mediaId = remoteId(item);
      if (item.source === "local" && mediaId === null) {
        await deleteLocalReviewPhoto(item.local.photo.id);
      } else if (mediaId !== null) {
        await clientMutation(`/api/v1/media/${mediaId}/direct`, { method: "DELETE" });
        setRemoteMedia((current) => current.filter((candidate) => candidate.id !== mediaId));
        setFeaturedIds((current) => {
          const next = new Set(current);
          next.delete(mediaId);
          return next;
        });
        const linkedLocal = item.local;
        if (linkedLocal !== null) {
          await deleteLocalReviewPhoto(linkedLocal.photo.id).catch(() => undefined);
        }
      }
      setSelectedKeys((current) => {
        const next = new Set(current);
        next.delete(item.key);
        return next;
      });
      if (activeKey === item.key) setActiveKey(nextKey);
      if (bibDialogKey === item.key) setBibDialogKey(null);
      showNotice("已删除");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除失败");
    } finally {
      setPending(item.key, null);
    }
  }

  async function stateAction(item: ReviewItem): Promise<void> {
    if (item.publicationStatus === "published" || item.publicationStatus === "hidden") {
      await toggleVisibility(item);
      return;
    }
    await publish(item);
  }

  function toggleSelection(key: string, index: number, range: boolean): void {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (range && lastSelectedIndexRef.current !== null) {
        const start = Math.min(lastSelectedIndexRef.current, index);
        const end = Math.max(lastSelectedIndexRef.current, index);
        for (const item of visibleItems.slice(start, end + 1)) next.add(item.key);
      } else if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
    lastSelectedIndexRef.current = index;
  }

  async function applyRemoteBatch(
    action: RemoteBatchAction,
    mediaIds: readonly string[],
    categoryId?: string | null,
  ): Promise<{ readonly okIds: readonly string[]; readonly failures: readonly BatchFailure[] }> {
    const okIds: string[] = [];
    const failures: BatchFailure[] = [];
    for (const batch of chunks(mediaIds, 200)) {
      try {
        const result = await clientMutation<MediaBatchResult>("/api/v1/media/batch", {
          body: {
            action,
            mediaIds: batch,
            ...(action === "change_category" ? { categoryId: categoryId ?? null } : {}),
          },
          idempotencyKey: `review-batch-${crypto.randomUUID()}`,
        });
        for (const item of result.items) {
          if (item.ok) okIds.push(item.mediaId);
          else
            failures.push({
              label: item.mediaId.slice(0, 8),
              message: item.message ?? item.code ?? "操作失败",
            });
        }
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "批量请求失败";
        failures.push(...batch.map((id) => ({ label: id.slice(0, 8), message })));
      }
    }
    return { okIds, failures };
  }

  function finishBatch(
    label: string,
    successCount: number,
    failures: readonly BatchFailure[],
  ): void {
    if (failures.length === 0) {
      showNotice(`${label}完成：${successCount} 张`);
    } else {
      showNotice(`${label}部分完成：成功 ${successCount}，失败 ${failures.length}`, "warning");
      setError(
        failures
          .slice(0, 12)
          .map((failure) => `${failure.label}：${failure.message}`)
          .join("\n") + (failures.length > 12 ? `\n另有 ${failures.length - 12} 项失败` : ""),
      );
    }
    setSelectedKeys(new Set());
    lastSelectedIndexRef.current = null;
  }

  async function batchPublish(): Promise<void> {
    if (batchBusy || selectedItems.length === 0) return;
    setBatchBusy(true);
    const failures: BatchFailure[] = [];
    let successCount = 0;
    try {
      const localTargets = selectedItems.filter(
        (item): item is Extract<ReviewItem, { source: "local" }> =>
          item.source === "local" && item.publicationStatus === "local",
      );
      for (const item of localTargets) {
        setPending(item.key, "state");
        try {
          const result = await publishLocalReviewPhoto(item.local.photo);
          await patchLocalReviewPhoto(item.local.photo.id, {
            mediaId: result.mediaId,
            uploadState: "published",
            error: null,
          });
          successCount += 1;
        } catch (cause) {
          failures.push({
            label: item.local.photo.fileName,
            message: cause instanceof Error ? cause.message : "发布失败",
          });
        } finally {
          setPending(item.key, null);
        }
      }

      const remoteTargets = selectedItems.filter(
        (item): item is Extract<ReviewItem, { source: "remote" }> =>
          item.source === "remote" && item.publicationStatus === "draft",
      );
      const remoteResult = await applyRemoteBatch(
        "publish",
        remoteTargets.map((item) => item.remote.id),
      );
      successCount += remoteResult.okIds.length;
      failures.push(...remoteResult.failures);

      const skipped = selectedItems.length - localTargets.length - remoteTargets.length;
      if (skipped > 0) {
        failures.push({ label: `${skipped} 张`, message: "当前状态不适用于批量发布" });
      }
      await Promise.all([refreshLocal(), refreshRemote(), refreshFeatured()]);
      finishBatch("批量发布", successCount, failures);
    } finally {
      setBatchBusy(false);
    }
  }

  async function batchHide(): Promise<void> {
    if (batchBusy || selectedItems.length === 0) return;
    setBatchBusy(true);
    try {
      const targets = selectedItems.filter(
        (item): item is Extract<ReviewItem, { source: "remote" }> =>
          item.source === "remote" && item.publicationStatus === "published",
      );
      const result = await applyRemoteBatch(
        "hide",
        targets.map((item) => item.remote.id),
      );
      const ok = new Set(result.okIds);
      setRemoteMedia((current) =>
        current.map((item) =>
          ok.has(item.id) ? { ...item, publicationStatus: "hidden" as const } : item,
        ),
      );
      const failures = [...result.failures];
      const skipped = selectedItems.length - targets.length;
      if (skipped > 0)
        failures.push({ label: `${skipped} 张`, message: "只有已发布照片可以批量隐藏" });
      finishBatch("批量隐藏", result.okIds.length, failures);
    } finally {
      setBatchBusy(false);
    }
  }

  async function batchChangeCategory(): Promise<void> {
    if (batchBusy || selectedItems.length === 0) return;
    setBatchBusy(true);
    const nextCategory = batchCategory === "uncategorized" ? null : batchCategory;
    const failures: BatchFailure[] = [];
    let successCount = 0;
    try {
      const localOnly = selectedItems.filter(
        (item): item is Extract<ReviewItem, { source: "local" }> =>
          item.source === "local" && item.local.photo.mediaId === null,
      );
      for (const item of localOnly) {
        try {
          await patchLocalReviewPhoto(item.local.photo.id, { categoryId: nextCategory });
          successCount += 1;
        } catch (cause) {
          failures.push({
            label: item.local.photo.fileName,
            message: cause instanceof Error ? cause.message : "修改分类失败",
          });
        }
      }

      const remoteTargets = selectedItems.filter(
        (item): item is Extract<ReviewItem, { source: "remote" }> => item.source === "remote",
      );
      const remoteResult = await applyRemoteBatch(
        "change_category",
        remoteTargets.map((item) => item.remote.id),
        nextCategory,
      );
      const remoteOk = new Set(remoteResult.okIds);
      successCount += remoteResult.okIds.length;
      failures.push(...remoteResult.failures);
      setRemoteMedia((current) =>
        current.map((item) =>
          remoteOk.has(item.id) ? { ...item, categoryId: nextCategory } : item,
        ),
      );
      for (const item of remoteTargets) {
        if (!remoteOk.has(item.remote.id) || item.local === null) continue;
        await patchLocalReviewPhoto(item.local.photo.id, { categoryId: nextCategory }).catch(
          () => undefined,
        );
      }
      await refreshLocal();
      finishBatch("批量修改分类", successCount, failures);
    } finally {
      setBatchBusy(false);
    }
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

  const filters: readonly { readonly id: FilterMode; readonly label: string }[] = [
    { id: "all", label: "全部" },
    { id: "local", label: "待发布" },
    { id: "published", label: "已发布" },
    { id: "hidden", label: "已隐藏" },
    { id: "featured", label: "精选" },
  ];
  const bibDialogItem = bibDialogKey === null ? null : itemByKey(bibDialogKey);
  const bibDialogMediaId = bibDialogItem === null ? null : remoteId(bibDialogItem);
  const bibDialogLocalActions =
    bibDialogItem !== null && bibDialogMediaId === null
      ? {
          confirmNumbers: (numbers: readonly string[]) =>
            confirmLocalNumbersByKey(bibDialogItem.key, numbers),
          confirmNoNumber: () => confirmLocalNoNumberByKey(bibDialogItem.key),
        }
      : undefined;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border bg-card px-2 py-1.5">
        <div className="flex items-center gap-1 overflow-x-auto">
          {filters.map((item) => (
            <Button
              className="h-7 shrink-0 px-2.5 text-xs"
              key={item.id}
              onClick={() => {
                setFilter(item.id);
                resetSelection();
              }}
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
              onValueChange={(value) => {
                setCategory(value ?? "all");
                resetSelection();
              }}
              value={category}
            >
              <SelectTrigger aria-label="分类筛选" className="h-7 w-28 text-xs">
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
              onValueChange={(value) => {
                setUploader(value ?? "all");
                resetSelection();
              }}
              value={uploader}
            >
              <SelectTrigger aria-label="上传者筛选" className="h-7 w-28 text-xs">
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
              void Promise.all([refreshLocal(), refreshRemote(), refreshFeatured()]).catch(
                (cause) => setError(cause instanceof Error ? cause.message : "刷新失败"),
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

      {selectedItems.length === 0 ? null : (
        <div className="sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-lg border bg-background/95 p-2 shadow-sm backdrop-blur">
          <Badge variant="secondary">已选择 {selectedItems.length} 张</Badge>
          <Button
            disabled={batchBusy || selectedItems.length === visibleItems.length}
            onClick={() => {
              setSelectedKeys(new Set(visibleItems.map((item) => item.key)));
              lastSelectedIndexRef.current = visibleItems.length - 1;
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            选择当前已加载 {visibleItems.length} 张
          </Button>
          <Button
            disabled={batchBusy}
            onClick={() => void batchPublish()}
            size="sm"
            type="button"
            variant="outline"
          >
            {batchBusy ? (
              <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
            ) : (
              <SendIcon data-icon="inline-start" />
            )}
            批量发布
          </Button>
          <Button
            disabled={batchBusy}
            onClick={() => void batchHide()}
            size="sm"
            type="button"
            variant="outline"
          >
            <EyeOffIcon data-icon="inline-start" />
            批量隐藏
          </Button>
          <div className="flex items-center gap-1">
            <Select
              items={[
                { label: "未分类", value: "uncategorized" },
                ...categories.map((item) => ({ label: item.name, value: item.id })),
              ]}
              onValueChange={(value) => setBatchCategory(value ?? "uncategorized")}
              value={batchCategory}
            >
              <SelectTrigger aria-label="批量分类" className="h-8 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="uncategorized">未分类</SelectItem>
                  {categories.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button
              disabled={batchBusy}
              onClick={() => void batchChangeCategory()}
              size="sm"
              type="button"
              variant="outline"
            >
              应用分类
            </Button>
          </div>
          <Button
            aria-label="清除选择"
            className="ml-auto"
            disabled={batchBusy}
            onClick={() => {
              setSelectedKeys(new Set());
              lastSelectedIndexRef.current = null;
            }}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <XIcon />
          </Button>
          {albumTitle === undefined ? null : (
            <span className="sr-only">当前活动：{albumTitle}</span>
          )}
        </div>
      )}

      {visibleItems.length === 0 ? (
        <div className="flex min-h-56 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          当前筛选没有图片
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {visibleItems.map((item, index) => {
            const pendingAction = pendingActions.get(item.key) ?? null;
            const pending = pendingAction !== null;
            const published = item.publicationStatus === "published";
            const hidden = item.publicationStatus === "hidden";
            const selected = selectedKeys.has(item.key);
            const bibConfirmed = isBibReviewConfirmed(item.bib);
            const ocrPending = bibOcrIsPending(item);
            const bibBlocked = !bibConfirmed && ocrPending;
            return (
              <div
                className={cn(
                  "group overflow-hidden rounded-lg border bg-card outline-none transition-shadow hover:shadow-sm focus-within:ring-2 focus-within:ring-ring",
                  selected && "ring-2 ring-primary",
                )}
                data-bib-ocr-pending={ocrPending ? "true" : "false"}
                key={item.key}
              >
                <div className="relative aspect-[4/3] bg-muted">
                  <button
                    aria-label="查看大图"
                    className="absolute inset-0"
                    onClick={() => setActiveKey(item.key)}
                    type="button"
                  >
                    {item.previewUrl === null ? null : (
                      <InternalCachedImage
                        alt="审核图片"
                        className="object-cover"
                        fill
                        sizes="(max-width: 639px) 50vw, (max-width: 767px) 33vw, 20vw"
                        src={item.previewUrl}
                        mediaId={item.source === "remote" ? item.remote.id : null}
                        variantKind={
                          item.source === "remote"
                            ? item.remote.variants.find(
                                (variant) => variant.url === item.previewUrl,
                              )?.kind
                            : undefined
                        }
                        unoptimized
                      />
                    )}
                  </button>
                  <Button
                    aria-label={selected ? "取消选择" : "选择照片"}
                    aria-pressed={selected}
                    className="absolute left-1.5 top-1.5 size-7 shadow-sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleSelection(item.key, index, event.shiftKey);
                    }}
                    size="icon"
                    title="点击选择；Shift 点击可连续选择"
                    type="button"
                    variant={selected ? "default" : "secondary"}
                  >
                    {selected ? (
                      <CheckIcon className="size-3.5" />
                    ) : (
                      <SquareIcon className="size-3.5" />
                    )}
                  </Button>
                </div>
                <div className="flex items-center justify-center gap-1 border-t bg-card p-1.5">
                  <Button
                    aria-label={item.featured ? "取消精选" : "设为精选"}
                    className={cn("size-8", item.featured && "text-primary")}
                    disabled={pending || batchBusy}
                    onClick={() => void toggleFeatured(item)}
                    size="icon"
                    title={item.featured ? "取消精选" : "精选"}
                    type="button"
                    variant="ghost"
                  >
                    {pendingAction === "featured" ? (
                      <LoaderCircleIcon className="size-4 animate-spin" />
                    ) : (
                      <StarIcon className={cn("size-4", item.featured && "fill-current")} />
                    )}
                  </Button>
                  <Button
                    aria-label={published ? "隐藏" : hidden ? "显示" : "发布"}
                    className={cn(
                      "size-8",
                      published &&
                        "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
                    )}
                    disabled={pending || batchBusy}
                    onClick={() => void stateAction(item)}
                    size="icon"
                    title={published ? "隐藏" : hidden ? "显示" : "发布"}
                    type="button"
                    variant="ghost"
                  >
                    {pendingAction === "state" ? (
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
                    aria-label={
                      bibBlocked ? "号码识别中" : bibConfirmed ? "修改号码确认" : "确认号码"
                    }
                    className={cn(
                      "size-8",
                      bibBlocked
                        ? "bg-muted text-muted-foreground"
                        : bibConfirmed
                          ? "bg-secondary text-secondary-foreground"
                          : "bg-muted text-foreground",
                    )}
                    disabled={pending || batchBusy || bibBlocked}
                    onClick={() => setBibDialogKey(item.key)}
                    size="icon"
                    title={
                      bibBlocked
                        ? "号码识别中"
                        : bibConfirmed
                          ? "号码已确认，点击修改"
                          : "号码待确认"
                    }
                    type="button"
                    variant="ghost"
                  >
                    {bibBlocked ? (
                      <LoaderCircleIcon className="size-4 animate-spin" />
                    ) : bibConfirmed ? (
                      <BadgeCheckIcon className="size-4" />
                    ) : (
                      <HashIcon className="size-4" />
                    )}
                  </Button>
                  <Button
                    aria-label="删除"
                    className="size-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={pending || batchBusy || !canDeleteItem(item)}
                    onClick={() => void deleteItem(item)}
                    size="icon"
                    title={canDeleteItem(item) ? "删除" : "仅管理员可删除"}
                    type="button"
                    variant="ghost"
                  >
                    {pendingAction === "delete" ? (
                      <LoaderCircleIcon className="size-4 animate-spin" />
                    ) : (
                      <Trash2Icon className="size-4" />
                    )}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex h-8 items-center justify-center" ref={sentinelRef}>
        {loadingMore ? (
          <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" />
        ) : null}
      </div>

      <ReviewLightbox
        items={lightboxItems}
        onBibError={setError}
        onBibStateChange={updateBibState}
        onClose={() => setActiveKey(null)}
        onDelete={(key) => {
          const item = itemByKey(key);
          if (item !== null) void deleteItem(item);
        }}
        onLocalBibConfirmNoNumber={confirmLocalNoNumberByKey}
        onLocalBibConfirmNumbers={confirmLocalNumbersByKey}
        onSelect={setActiveKey}
        onStateAction={(key) => {
          const item = itemByKey(key);
          if (item !== null) void stateAction(item);
        }}
        onToggleFeatured={(key) => {
          const item = itemByKey(key);
          if (item !== null) void toggleFeatured(item);
        }}
        onToggleVisibility={(key) => {
          const item = itemByKey(key);
          if (item !== null) void toggleVisibility(item);
        }}
        selectedKey={activeKey}
      />

      <BibReviewDialog
        localActions={bibDialogLocalActions}
        mediaId={bibDialogMediaId}
        onChange={(state) => {
          if (bibDialogItem === null) return;
          const mediaId = remoteId(bibDialogItem);
          if (mediaId !== null) updateBibState(mediaId, state);
          else void refreshLocal();
        }}
        onError={setError}
        onOpenChange={(open) => {
          if (!open) setBibDialogKey(null);
        }}
        open={bibDialogItem !== null}
        state={bibDialogItem?.bib ?? null}
      />

      <ErrorDialog message={error} onClose={() => setError(null)} title="操作失败" />
    </div>
  );
}
