"use client";

import type {
  AlbumUploaderView,
  BibBatchResult,
  BibConfigView,
  BibMediaState,
  InternalMediaList,
  InternalMediaView,
  MediaBatchResult,
  ReviewCollaborationView,
} from "@photostream/contracts";
import {
  BadgeCheckIcon,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  HashIcon,
  LoaderCircleIcon,
  PanelRightOpenIcon,
  RefreshCwIcon,
  SquareIcon,
  StarIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { BibReviewDialog, isBibReviewConfirmed } from "@/components/bib/bib-review-editor";
import { InternalCachedImage } from "@/components/media/internal-cached-image";
import {
  type ReviewAssignmentFilter,
  ReviewCollaborationControl,
} from "@/components/review/review-collaboration-control";
import {
  ReviewBatchInspector,
  ReviewInspector,
  type ReviewInspectorItem,
} from "@/components/review/review-inspector";
import {
  ReviewLightbox,
  type ReviewLightboxItem,
  type ReviewPendingAction,
} from "@/components/review/review-lightbox";
import { REVIEW_REMOTE_CHANGED_EVENT } from "@/components/review/review-remote-sync";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { Input } from "@/components/ui/input";
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
import { deleteLocalPhotoEditDraft } from "@/lib/photo-edit/local-drafts";
import { cn } from "@/lib/utils";

async function deleteLocalReviewState(localPhotoId: string): Promise<void> {
  await Promise.all([
    deleteLocalReviewPhoto(localPhotoId),
    deleteLocalPhotoEditDraft(localPhotoId),
  ]);
}

interface CategoryOption {
  readonly id: string;
  readonly name: string;
}

type FilterMode = "all" | "featured" | "hidden" | "local" | "published";
type IngestFilter = "all" | "failed" | "incomplete";
type BibDecisionFilter =
  | "all"
  | "needs_review"
  | "no_number_confirmed"
  | "numbers_confirmed"
  | "pending";
type BibOcrFilter = "all" | "completed" | "failed" | "not_started" | "processing" | "unsupported";
type SortOrder = "newest" | "oldest";
type GridDensity = "compact" | "standard" | "large";
type RemoteBatchAction = "change_category" | "hide" | "restore";

type RemoteCursor = { readonly kind: "single"; readonly value: string };

interface RemotePage {
  readonly items: readonly InternalMediaView[];
  readonly nextCursor: RemoteCursor | null;
}

interface RemoteSelectionItem {
  readonly id: string;
  readonly publicationStatus: InternalMediaView["publicationStatus"];
  readonly categoryId: string | null;
  readonly featured: boolean;
}

interface RemoteSelectionPage {
  readonly items: readonly RemoteSelectionItem[];
  readonly nextCursor: string | null;
  readonly total: number;
}

interface LocalView {
  readonly photo: LocalReviewPhoto;
  readonly originalUrl: string;
  readonly previewUrl: string;
  readonly viewerUrl: string;
}

interface LocalObjectUrls {
  readonly originalUrl: string;
  readonly previewUrl: string;
  readonly viewerUrl: string;
}

interface DragSelectionState {
  readonly selecting: boolean;
  readonly seen: Set<string>;
  lastX: number;
  lastY: number;
}

type ReviewItem =
  | {
      readonly key: string;
      readonly source: "local";
      readonly local: LocalView;
      readonly previewUrl: string;
      readonly viewerUrl: string;
      readonly viewerFallbackUrl: null;
      readonly remoteOriginalUrl: string;
      readonly localPreferred: true;
      readonly categoryId: string | null;
      readonly uploaderId: null;
      readonly featured: boolean;
      readonly publicationStatus: "local";
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

const filterModes = new Set<FilterMode>(["all", "featured", "hidden", "local", "published"]);
const assignmentFilters = new Set<ReviewAssignmentFilter>(["all", "mine"]);
const ingestFilters = new Set<IngestFilter>(["all", "failed", "incomplete"]);
const bibDecisionFilters = new Set<BibDecisionFilter>([
  "all",
  "needs_review",
  "no_number_confirmed",
  "numbers_confirmed",
  "pending",
]);
const bibOcrFilters = new Set<BibOcrFilter>([
  "all",
  "completed",
  "failed",
  "not_started",
  "processing",
  "unsupported",
]);
const sortOrders = new Set<SortOrder>(["newest", "oldest"]);
const gridDensities = new Set<GridDensity>(["compact", "standard", "large"]);
const reviewGridDensityStorageKey = "photostream:review-grid-density";

function enumQueryValue<T extends string>(
  params: URLSearchParams,
  key: string,
  allowed: ReadonlySet<T>,
  fallback: T,
): T {
  const value = params.get(key);
  return value !== null && allowed.has(value as T) ? (value as T) : fallback;
}

function simpleQueryValue(params: URLSearchParams, key: string): string {
  return params.get(key) ?? "all";
}

function preview(media: InternalMediaView): string | null {
  return (
    media.variants.find((variant) => variant.kind === "photo_480")?.url ??
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

function stableRemoteMedia(
  previous: InternalMediaView | undefined,
  incoming: InternalMediaView,
): InternalMediaView {
  if (
    previous === undefined ||
    (previous.edit?.activeRevisionId ?? null) !== (incoming.edit?.activeRevisionId ?? null)
  ) {
    return incoming;
  }
  const previousByKind = new Map(
    previous.variants.map((variant) => [variant.kind, variant] as const),
  );
  return {
    ...incoming,
    variants: incoming.variants.map((variant) => {
      const existing = previousByKind.get(variant.kind);
      if (
        existing === undefined ||
        existing.bytes !== variant.bytes ||
        existing.width !== variant.width ||
        existing.height !== variant.height ||
        existing.contentType !== variant.contentType
      ) {
        return variant;
      }
      return { ...variant, url: existing.url };
    }),
  };
}

function reconcileRemotePage(
  current: readonly InternalMediaView[],
  incoming: readonly InternalMediaView[],
  openKeys: ReadonlySet<string>,
  preserveLoadedTail: boolean,
): readonly InternalMediaView[] {
  const currentById = new Map(current.map((item) => [item.id, item] as const));
  const next = incoming.map((item) => stableRemoteMedia(currentById.get(item.id), item));
  const present = new Set(next.map((item) => item.id));
  for (const existing of current) {
    if (present.has(existing.id)) continue;
    const open = openKeys.has(`remote:${existing.id}`);
    if (!open && !preserveLoadedTail) continue;
    next.push(existing);
    present.add(existing.id);
  }
  return next;
}

function chunks<T>(items: readonly T[], size: number): readonly T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    result.push(items.slice(index, index + size));
  return result;
}

export function ReviewWorkspace({
  albumId,
  albumTitle,
  bibConfig,
  categories,
  initialPage,
  initialReviewCollaboration,
  userRole,
  uploaders,
}: Readonly<{
  albumId: string;
  albumTitle?: string;
  bibConfig: BibConfigView;
  categories: readonly CategoryOption[];
  initialPage: InternalMediaList;
  initialReviewCollaboration: ReviewCollaborationView;
  userRole: "admin" | "operator" | "reviewer";
  uploaders: readonly AlbumUploaderView[];
}>) {
  const localUrlCache = useRef(new Map<string, LocalObjectUrls>());
  const loadingMoreRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const lastSelectedIndexRef = useRef<number | null>(null);
  const dragSelectionRef = useRef<DragSelectionState | null>(null);
  const filterRequestIdRef = useRef(0);
  const reviewedMediaIdsRef = useRef<Set<string>>(new Set());
  const [remoteMedia, setRemoteMedia] = useState<readonly InternalMediaView[]>(initialPage.items);
  const [cursor, setCursor] = useState<RemoteCursor | null>(
    initialPage.nextCursor === null ? null : { kind: "single", value: initialPage.nextCursor },
  );
  const [localMedia, setLocalMedia] = useState<readonly LocalView[]>([]);
  const [featuredIds, setFeaturedIds] = useState<ReadonlySet<string>>(new Set());
  const [filter, setFilter] = useState<FilterMode>("all");
  const [category, setCategory] = useState("all");
  const [uploader, setUploader] = useState("all");
  const [assignmentFilter, setAssignmentFilter] = useState<ReviewAssignmentFilter>("all");
  const [reviewCollaboration, setReviewCollaboration] = useState(initialReviewCollaboration);
  const [ingestFilter, setIngestFilter] = useState<IngestFilter>("all");
  const [bibDecision, setBibDecision] = useState<BibDecisionFilter>("all");
  const [bibOcrStatus, setBibOcrStatus] = useState<BibOcrFilter>("all");
  const [gradeOption, setGradeOption] = useState("all");
  const [classOption, setClassOption] = useState("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [gridDensity, setGridDensity] = useState<GridDensity>("standard");
  const [filtersHydrated, setFiltersHydrated] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [inspectorKey, setInspectorKey] = useState<string | null>(null);
  const [inspectorDeleteOpen, setInspectorDeleteOpen] = useState(false);
  const [bibDialogKey, setBibDialogKey] = useState<string | null>(null);
  const openItemKeysRef = useRef<ReadonlySet<string>>(new Set());
  openItemKeysRef.current = new Set(
    [activeKey, inspectorKey, bibDialogKey].filter((key): key is string => key !== null),
  );
  const [pendingActions, setPendingActions] = useState<ReadonlyMap<string, ReviewPendingAction>>(
    new Map(),
  );
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(new Set());
  const [remoteSelection, setRemoteSelection] = useState<ReadonlyMap<
    string,
    RemoteSelectionItem
  > | null>(null);
  const [batchCategory, setBatchCategory] = useState("uncategorized");
  const [batchBibNumber, setBatchBibNumber] = useState("");
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gradeOptions = useMemo(
    () =>
      bibConfig.attributeOptions.filter((option) => option.enabled && option.dimension === "grade"),
    [bibConfig.attributeOptions],
  );
  const classOptions = useMemo(
    () =>
      bibConfig.attributeOptions.filter(
        (option) =>
          option.enabled &&
          option.dimension === "class" &&
          (gradeOption === "all" ||
            option.parentGradeOptionId == null ||
            option.parentGradeOptionId === gradeOption),
      ),
    [bibConfig.attributeOptions, gradeOption],
  );

  useEffect(() => {
    if (
      classOption !== "all" &&
      !classOptions.some((option) => option.id === classOption)
    ) {
      setClassOption("all");
    }
  }, [classOption, classOptions]);

  const showNotice = useCallback((text: string, type: "success" | "warning" = "success") => {
    toast.add({ title: text, type });
  }, []);

  const applyFiltersFromLocation = useCallback((): void => {
    const params = new URLSearchParams(window.location.search);
    setFilter(enumQueryValue(params, "review", filterModes, "all"));
    setCategory(simpleQueryValue(params, "category"));
    setUploader(simpleQueryValue(params, "uploader"));
    setAssignmentFilter(enumQueryValue(params, "assignment", assignmentFilters, "all"));
    setIngestFilter(enumQueryValue(params, "ingest", ingestFilters, "all"));
    setBibDecision(enumQueryValue(params, "bibDecision", bibDecisionFilters, "all"));
    setBibOcrStatus(enumQueryValue(params, "bibOcr", bibOcrFilters, "all"));
    setGradeOption(simpleQueryValue(params, "grade"));
    setClassOption(simpleQueryValue(params, "class"));
    setSortOrder(enumQueryValue(params, "sort", sortOrders, "newest"));
    setFiltersHydrated(true);
  }, []);

  useEffect(() => {
    applyFiltersFromLocation();
    window.addEventListener("popstate", applyFiltersFromLocation);
    return () => window.removeEventListener("popstate", applyFiltersFromLocation);
  }, [applyFiltersFromLocation]);

  useEffect(() => {
    const saved = window.localStorage.getItem(reviewGridDensityStorageKey);
    if (saved !== null && gridDensities.has(saved as GridDensity)) {
      setGridDensity(saved as GridDensity);
    }
  }, []);

  function changeGridDensity(value: GridDensity): void {
    setGridDensity(value);
    window.localStorage.setItem(reviewGridDensityStorageKey, value);
  }

  useEffect(() => {
    if (!filtersHydrated) return;
    const url = new URL(window.location.href);
    const setOrDelete = (key: string, value: string, fallback = "all") => {
      if (value === fallback) url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    };
    setOrDelete("review", filter);
    setOrDelete("category", category);
    setOrDelete("uploader", uploader);
    setOrDelete("assignment", assignmentFilter);
    setOrDelete("ingest", ingestFilter);
    setOrDelete("bibDecision", bibDecision);
    setOrDelete("bibOcr", bibOcrStatus);
    setOrDelete("grade", gradeOption);
    if (gradeOption === "all") url.searchParams.delete("class");
    else setOrDelete("class", classOption);
    setOrDelete("sort", sortOrder, "newest");
    const next = `${url.pathname}${url.search}${url.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== current) window.history.replaceState(window.history.state, "", next);
  }, [
    assignmentFilter,
    bibDecision,
    bibOcrStatus,
    category,
    classOption,
    filter,
    filtersHydrated,
    gradeOption,
    ingestFilter,
    sortOrder,
    uploader,
  ]);

  const refreshLocal = useCallback(async () => {
    const rows = await listLocalReviewPhotos(albumId);
    const activeIds = new Set(rows.map((photo) => photo.id));
    for (const [photoId, urls] of localUrlCache.current) {
      if (activeIds.has(photoId)) continue;
      URL.revokeObjectURL(urls.previewUrl);
      URL.revokeObjectURL(urls.viewerUrl);
      URL.revokeObjectURL(urls.originalUrl);
      localUrlCache.current.delete(photoId);
    }
    const next = rows.map((photo) => {
      let urls = localUrlCache.current.get(photo.id);
      if (urls === undefined) {
        const previewBlob =
          photo.variants.find((variant) => variant.kind === "photo_480")?.blob ??
          photo.variants.find((variant) => variant.kind === "photo_960")?.blob ??
          photo.variants.find((variant) => variant.kind === "photo_1920")?.blob ??
          photo.originalBlob;
        const viewerBlob =
          photo.variants.find((variant) => variant.kind === "photo_1920")?.blob ??
          photo.variants.find((variant) => variant.kind === "photo_960")?.blob ??
          photo.variants.find((variant) => variant.kind === "photo_480")?.blob ??
          photo.originalBlob;
        urls = {
          previewUrl: URL.createObjectURL(previewBlob),
          viewerUrl: URL.createObjectURL(viewerBlob),
          originalUrl: URL.createObjectURL(photo.originalBlob),
        };
        localUrlCache.current.set(photo.id, urls);
      }
      return {
        photo,
        previewUrl: urls.previewUrl,
        viewerUrl: urls.viewerUrl,
        originalUrl: urls.originalUrl,
      };
    });
    setLocalMedia(next);
  }, [albumId]);

  const refreshFeatured = useCallback(async () => {
    const result = await clientGet<{ readonly mediaIds: readonly string[] }>(
      `/api/v1/albums/${albumId}/featured`,
    );
    setFeaturedIds(new Set(result.mediaIds));
  }, [albumId]);

  const refreshReviewCollaboration = useCallback(async () => {
    const next = await clientGet<ReviewCollaborationView>(
      `/api/v1/albums/${albumId}/review-collaboration`,
    );
    setReviewCollaboration(next);
    if (!next.enabled || !next.currentUserParticipating) setAssignmentFilter("all");
    return next;
  }, [albumId]);

  const buildRemoteQuery = useCallback(
    (
      publicationStatus?: "draft" | "hidden" | "pending_review" | "published",
      pageCursor?: string,
    ) => {
      const query = new URLSearchParams({ limit: "60" });
      if (publicationStatus !== undefined) query.set("publicationStatus", publicationStatus);
      if (category !== "all") query.set("categoryId", category);
      if (uploader !== "all") query.set("uploaderId", uploader);
      if (assignmentFilter === "mine") query.set("reviewAssignment", "mine");
      if (ingestFilter !== "all") query.set("ingestGroup", ingestFilter);
      if (bibDecision !== "all") query.set("bibReviewDecision", bibDecision);
      if (bibOcrStatus !== "all") query.set("bibOcrStatus", bibOcrStatus);
      if (gradeOption !== "all") query.set("gradeOptionId", gradeOption);
      if (gradeOption !== "all" && classOption !== "all") query.set("classOptionId", classOption);
      query.set("sort", sortOrder);
      if (pageCursor !== undefined) query.set("cursor", pageCursor);
      return query;
    },
    [
      assignmentFilter,
      bibDecision,
      bibOcrStatus,
      category,
      classOption,
      gradeOption,
      ingestFilter,
      sortOrder,
      uploader,
    ],
  );

  const fetchRemote = useCallback(
    async (pageCursor?: RemoteCursor): Promise<RemotePage> => {
      const publicationStatus =
        filter === "published" ? "published" : filter === "hidden" ? "hidden" : undefined;
      const query = buildRemoteQuery(publicationStatus, pageCursor?.value);
      if (filter === "featured") query.set("featured", "true");
      const page = await clientGet<InternalMediaList>(
        `/api/v1/albums/${albumId}/media?${query.toString()}`,
      );
      return {
        items: page.items,
        nextCursor:
          page.nextCursor === null ? null : { kind: "single" as const, value: page.nextCursor },
      };
    },
    [albumId, buildRemoteQuery, filter],
  );

  const refreshRemote = useCallback(async (): Promise<RemotePage> => {
    const page = await fetchRemote();
    setRemoteMedia((current) =>
      reconcileRemotePage(
        current,
        page.items,
        openItemKeysRef.current,
        current.length > page.items.length,
      ),
    );
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
        URL.revokeObjectURL(urls.viewerUrl);
        URL.revokeObjectURL(urls.originalUrl);
      }
      localUrlCache.current.clear();
    };
  }, [albumId, bibConfig, refreshFeatured, refreshLocal, updateBibState]);

  useEffect(() => {
    const remoteChanged = (event: Event) => {
      const detail = (
        event as CustomEvent<{ readonly albumId?: string; readonly revision?: string }>
      ).detail;
      if (detail?.albumId !== albumId) return;
      if (openItemKeysRef.current.size > 0) {
        toast.add({
          title: "审核数据已实时同步",
          description: "当前打开的照片可能已在其他会话或操作中发生变化，已加载最新状态。",
          type: "info",
        });
      }
      void Promise.all([refreshRemote(), refreshFeatured(), refreshReviewCollaboration()]).catch(
        (cause) => setError(cause instanceof Error ? cause.message : "审核数据同步失败"),
      );
    };
    window.addEventListener(REVIEW_REMOTE_CHANGED_EVENT, remoteChanged);
    return () => window.removeEventListener(REVIEW_REMOTE_CHANGED_EVENT, remoteChanged);
  }, [albumId, refreshFeatured, refreshRemote, refreshReviewCollaboration]);

  useEffect(() => {
    if (!filtersHydrated) return;
    const requestId = filterRequestIdRef.current + 1;
    filterRequestIdRef.current = requestId;
    loadingMoreRef.current = false;
    setLoadingMore(true);
    setSelectedKeys(new Set());
    setRemoteSelection(null);
    lastSelectedIndexRef.current = null;
    void fetchRemote()
      .then((page) => {
        if (filterRequestIdRef.current !== requestId) return;
        setRemoteMedia((current) =>
          reconcileRemotePage(current, page.items, openItemKeysRef.current, false),
        );
        setCursor(page.nextCursor);
      })
      .catch((cause) => {
        if (filterRequestIdRef.current !== requestId) return;
        setError(cause instanceof Error ? cause.message : "筛选加载失败");
      })
      .finally(() => {
        if (filterRequestIdRef.current === requestId) setLoadingMore(false);
      });
  }, [fetchRemote, filtersHydrated]);

  const items = useMemo<readonly ReviewItem[]>(() => {
    const localByMediaId = new Map<string, LocalView>();
    for (const item of localMedia) {
      if (item.photo.mediaId !== null) localByMediaId.set(item.photo.mediaId, item);
    }
    const localItems: ReviewItem[] = localMedia
      .filter((item) => item.photo.mediaId === null)
      .map((item) => ({
        key: `local:${item.photo.id}`,
        source: "local",
        local: item,
        previewUrl: item.previewUrl,
        viewerUrl: item.viewerUrl,
        viewerFallbackUrl: null,
        remoteOriginalUrl: item.originalUrl,
        localPreferred: true,
        categoryId: item.photo.categoryId,
        uploaderId: null,
        featured: item.photo.featured,
        publicationStatus: "local" as const,
        bib: localBibMediaState(item.photo),
        createdAt: item.photo.createdAt,
      }));
    const remoteItems: ReviewItem[] = remoteMedia
      .filter((item) => item.publicationStatus !== "deleted")
      .map((item) => {
        const linkedLocal = localByMediaId.get(item.id) ?? null;
        const ordinaryUrl = ordinary(item);
        const previewUrl = preview(item);
        const localPreviewUrl = linkedLocal?.previewUrl ?? null;
        const localViewerUrl = linkedLocal?.viewerUrl ?? null;
        const localOriginalUrl = linkedLocal?.originalUrl ?? null;
        return {
          key: `remote:${item.id}`,
          source: "remote" as const,
          remote: item,
          local: linkedLocal,
          previewUrl: localPreviewUrl ?? previewUrl,
          viewerUrl: localViewerUrl ?? ordinaryUrl,
          viewerFallbackUrl:
            localViewerUrl === null && previewUrl !== ordinaryUrl ? previewUrl : null,
          remoteOriginalUrl: localOriginalUrl ?? remoteOriginal(item),
          localPreferred: localOriginalUrl !== null,
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
      sortOrder === "oldest"
        ? left.createdAt.localeCompare(right.createdAt)
        : right.createdAt.localeCompare(left.createdAt),
    );
  }, [featuredIds, localMedia, remoteMedia, sortOrder]);

  const visibleItems = useMemo(
    () =>
      items.filter((item) => {
        if (assignmentFilter === "mine" && item.source === "local") return false;
        if (category !== "all" && item.categoryId !== category) return false;
        if (uploader !== "all" && item.uploaderId !== uploader) return false;
        if (filter === "local" && item.source !== "local") return false;
        if (filter === "featured" && !item.featured) return false;
        if (filter === "published" && item.publicationStatus !== "published") return false;
        if (filter === "hidden" && item.publicationStatus !== "hidden") return false;
        if (item.source === "local") {
          if (ingestFilter === "failed" && item.local.photo.uploadState !== "failed") return false;
          if (ingestFilter === "incomplete" && item.local.photo.uploadState === "published")
            return false;
        }
        const decision = item.bib?.review.decision ?? "pending";
        const ocrStatus = item.bib?.review.ocrStatus ?? "not_started";
        if (bibDecision !== "all" && decision !== bibDecision) return false;
        if (bibOcrStatus !== "all" && ocrStatus !== bibOcrStatus) return false;
        if (gradeOption !== "all") {
          const matchedAttribute = item.bib?.tags.some(
            (tag) =>
              tag.status === "confirmed" &&
              tag.gradeOptionId === gradeOption &&
              (classOption === "all" || tag.classOptionId === classOption),
          );
          if (matchedAttribute !== true) return false;
        }
        return true;
      }),
    [
      assignmentFilter,
      bibDecision,
      bibOcrStatus,
      category,
      classOption,
      filter,
      gradeOption,
      ingestFilter,
      items,
      uploader,
    ],
  );

  function resetSelection(): void {
    setSelectedKeys(new Set());
    setRemoteSelection(null);
    lastSelectedIndexRef.current = null;
    dragSelectionRef.current = null;
  }

  function clearAdvancedFilters(): void {
    setAssignmentFilter("all");
    setIngestFilter("all");
    setBibDecision("all");
    setBibOcrStatus("all");
    setGradeOption("all");
    setClassOption("all");
    resetSelection();
  }

  useEffect(() => {
    const validKeys = new Set(items.map((item) => item.key));
    setSelectedKeys((current) => {
      const next = new Set([...current].filter((key) => validKeys.has(key)));
      return next.size === current.size ? current : next;
    });
  }, [items]);

  useEffect(() => {
    if (activeKey === null || !activeKey.startsWith("local:")) return;
    if (items.some((item) => item.key === activeKey)) return;
    const localPhotoId = activeKey.slice("local:".length);
    const linked = localMedia.find((item) => item.photo.id === localPhotoId);
    const mediaId = linked?.photo.mediaId ?? null;
    if (mediaId === null) return;
    const remoteKey = `remote:${mediaId}`;
    if (items.some((item) => item.key === remoteKey)) setActiveKey(remoteKey);
  }, [activeKey, items, localMedia]);

  const selectedItems = useMemo(
    () =>
      visibleItems.filter((item) =>
        item.source === "remote" && remoteSelection !== null
          ? remoteSelection.has(item.remote.id)
          : selectedKeys.has(item.key),
      ),
    [remoteSelection, selectedKeys, visibleItems],
  );
  const selectedLocalItems = useMemo(
    () =>
      selectedItems.filter(
        (item): item is Extract<ReviewItem, { source: "local" }> => item.source === "local",
      ),
    [selectedItems],
  );
  const selectedRemoteItems = useMemo<readonly RemoteSelectionItem[]>(() => {
    if (remoteSelection !== null) return [...remoteSelection.values()];
    return selectedItems
      .filter((item): item is Extract<ReviewItem, { source: "remote" }> => item.source === "remote")
      .map((item) => ({
        id: item.remote.id,
        publicationStatus: item.publicationStatus,
        categoryId: item.categoryId,
        featured: item.featured,
      }));
  }, [remoteSelection, selectedItems]);
  const selectedCount = selectedLocalItems.length + selectedRemoteItems.length;

  useEffect(() => {
    if (selectedCount === 0) {
      setBatchCategory("uncategorized");
      return;
    }
    const values = new Set([
      ...selectedLocalItems.map((item) => item.categoryId ?? "uncategorized"),
      ...selectedRemoteItems.map((item) => item.categoryId ?? "uncategorized"),
    ]);
    setBatchCategory(values.size === 1 ? ([...values][0] ?? "uncategorized") : "mixed");
  }, [selectedCount, selectedLocalItems, selectedRemoteItems]);

  function itemSelected(item: ReviewItem): boolean {
    return item.source === "remote" && remoteSelection !== null
      ? remoteSelection.has(item.remote.id)
      : selectedKeys.has(item.key);
  }

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
        inspector:
          item.source === "local"
            ? {
                key: item.key,
                title: item.local.photo.fileName,
                mediaId: item.local.photo.mediaId,
                categoryId: item.categoryId,
                uploaderName: null,
                sourceLabel: "本机",
                featured: item.featured,
                publicationStatus: item.publicationStatus,
                ingestStatus: item.local.photo.uploadState,
                editPending: false,
                editActive: false,
                width: item.local.photo.width,
                height: item.local.photo.height,
                totalBytes: item.local.photo.totalBytes,
                createdAt: item.createdAt,
                capturedAt: item.local.photo.capturedAt,
                bib: item.bib,
                canDelete: true,
              }
            : {
                key: item.key,
                title: item.local?.photo.fileName ?? `媒体 ${item.remote.id.slice(0, 8)}`,
                mediaId: item.remote.id,
                categoryId: item.categoryId,
                uploaderName:
                  uploaders.find((entry) => entry.id === item.uploaderId)?.displayName ?? null,
                sourceLabel: "远端",
                featured: item.featured,
                publicationStatus: item.publicationStatus,
                ingestStatus: item.remote.ingestStatus,
                editPending: item.remote.edit?.pendingRevisionId != null,
                editActive: item.remote.edit?.activeRevisionId != null,
                width: item.remote.width,
                height: item.remote.height,
                totalBytes: item.remote.totalBytes,
                createdAt: item.createdAt,
                capturedAt: item.remote.capturedAt,
                bib: item.bib,
                canDelete: userRole === "admin" || userRole === "operator",
              },
        src: item.viewerUrl,
        variants: item.source === "remote" ? item.remote.variants : [],
        fallbackSrc: item.viewerFallbackUrl,
        originalSrc: item.remoteOriginalUrl,
        localPreferred: item.localPreferred,
        visualRevision:
          item.source === "remote" ? (item.remote.edit?.activeRevisionId ?? null) : null,
        width: item.source === "local" ? item.local.photo.width : item.remote.width,
        height: item.source === "local" ? item.local.photo.height : item.remote.height,
        featured: item.featured,
        publicationStatus: item.publicationStatus,
        mediaId: item.source === "remote" ? item.remote.id : item.local.photo.mediaId,
        localPhotoId:
          item.source === "local" ? item.local.photo.id : (item.local?.photo.id ?? null),
        bib: item.bib,
        canDelete: item.source === "local" ? true : userRole === "admin" || userRole === "operator",
        pendingAction: pendingActions.get(item.key) ?? null,
      })),
    [lightboxSourceItems, pendingActions, uploaders, userRole],
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
    if (item.source === "remote") return userRole === "admin" || userRole === "operator";
    return true;
  }

  async function changeCategory(item: ReviewItem, nextCategory: string | null): Promise<void> {
    if (isPending(item.key) || item.categoryId === nextCategory) return;
    setPending(item.key, "category");
    try {
      const mediaId = remoteId(item);
      if (item.source === "local" && mediaId === null) {
        await patchLocalReviewPhoto(item.local.photo.id, { categoryId: nextCategory });
      } else if (mediaId !== null) {
        const result = await applyRemoteBatch("change_category", [mediaId], nextCategory);
        if (result.failures.length > 0 || result.okIds.length === 0) {
          throw new Error(result.failures[0]?.message ?? "修改分类失败");
        }
        setRemoteMedia((current) =>
          current.map((media) =>
            media.id === mediaId ? { ...media, categoryId: nextCategory } : media,
          ),
        );
        const linkedLocal = localPhoto(item);
        if (linkedLocal !== null) {
          await patchLocalReviewPhoto(linkedLocal.id, { categoryId: nextCategory }).catch(
            () => undefined,
          );
        }
      }
      await refreshLocal();
      showNotice("分类已更新");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "修改分类失败");
    } finally {
      setPending(item.key, null);
    }
  }

  const selectionStats = (() => {
    let hideable = 0;
    let restorable = 0;
    let featureable = 0;
    let unfeatureable = 0;
    let deletable = 0;
    for (const item of selectedLocalItems) {
      if (item.featured) unfeatureable += 1;
      else featureable += 1;
      if (canDeleteItem(item)) deletable += 1;
    }
    for (const item of selectedRemoteItems) {
      if (item.publicationStatus === "published") hideable += 1;
      if (item.publicationStatus === "hidden") restorable += 1;
      if (item.featured) unfeatureable += 1;
      else featureable += 1;
      if (userRole === "admin" || userRole === "operator") deletable += 1;
    }
    return { hideable, restorable, featureable, unfeatureable, deletable };
  })();

  async function toggleFeatured(item: ReviewItem): Promise<void> {
    if (isPending(item.key)) return;
    setPending(item.key, "featured");
    try {
      const next = !item.featured;
      const mediaId = remoteId(item);
      if (item.source === "local") {
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
      await refreshLocal();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "精选状态修改失败");
    } finally {
      setPending(item.key, null);
    }
  }

  async function toggleVisibility(item: ReviewItem): Promise<void> {
    if (isPending(item.key)) return;
    if (item.publicationStatus !== "published" && item.publicationStatus !== "hidden") return;
    if (
      item.source === "remote" &&
      item.publicationStatus === "hidden" &&
      item.remote.edit?.pendingRevisionId != null
    ) {
      showNotice("修图版本仍在处理中，完成或取消后才能显示");
      return;
    }
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
        await deleteLocalReviewState(item.local.photo.id);
      } else if (mediaId !== null) {
        await clientMutation(`/api/v1/media/${mediaId}/direct`, { method: "DELETE" });
        setRemoteMedia((current) => current.filter((candidate) => candidate.id !== mediaId));
        setFeaturedIds((current) => {
          const next = new Set(current);
          next.delete(mediaId);
          return next;
        });
        if (item.source === "local") {
          await deleteLocalReviewState(item.local.photo.id).catch(() => undefined);
        } else if (item.local !== null) {
          await deleteLocalReviewState(item.local.photo.id).catch(() => undefined);
        }
      }
      setSelectedKeys((current) => {
        const next = new Set(current);
        next.delete(item.key);
        return next;
      });
      if (activeKey === item.key) setActiveKey(nextKey);
      if (inspectorKey === item.key) setInspectorKey(null);
      if (bibDialogKey === item.key) setBibDialogKey(null);
      showNotice("已删除");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除失败");
    } finally {
      setPending(item.key, null);
    }
  }

  async function stateAction(item: ReviewItem): Promise<void> {
    await toggleVisibility(item);
  }

  async function markViewedItemReviewed(key: string): Promise<void> {
    const item = itemByKey(key);
    if (item === null) return;
    const mediaId = remoteId(item);
    if (mediaId === null || reviewedMediaIdsRef.current.has(mediaId)) return;
    reviewedMediaIdsRef.current.add(mediaId);
    try {
      await clientMutation<{ readonly ok: true }>(`/api/v1/media/${mediaId}/reviewed`);
      await refreshReviewCollaboration();
    } catch (cause) {
      reviewedMediaIdsRef.current.delete(mediaId);
      setError(cause instanceof Error ? cause.message : "记录审核完成状态失败");
    }
  }

  const setSelectionForKey = useCallback(
    (key: string, selecting: boolean): void => {
      const item = visibleItems.find((candidate) => candidate.key === key);
      if (item?.source === "remote" && remoteSelection !== null) {
        const snapshot: RemoteSelectionItem = {
          id: item.remote.id,
          publicationStatus: item.publicationStatus,
          categoryId: item.categoryId,
          featured: item.featured,
        };
        setRemoteSelection((current) => {
          if (current === null) return current;
          const next = new Map(current);
          if (selecting) next.set(snapshot.id, snapshot);
          else next.delete(snapshot.id);
          return next;
        });
        return;
      }
      setSelectedKeys((current) => {
        const currentlySelected = current.has(key);
        if (currentlySelected === selecting) return current;
        const next = new Set(current);
        if (selecting) next.add(key);
        else next.delete(key);
        return next;
      });
    },
    [remoteSelection, visibleItems],
  );

  function toggleSelection(key: string, index: number, range: boolean): void {
    if (range && lastSelectedIndexRef.current !== null) {
      const start = Math.min(lastSelectedIndexRef.current, index);
      const end = Math.max(lastSelectedIndexRef.current, index);
      for (const item of visibleItems.slice(start, end + 1)) setSelectionForKey(item.key, true);
    } else {
      const item = visibleItems[index];
      if (item !== undefined) setSelectionForKey(key, !itemSelected(item));
    }
    lastSelectedIndexRef.current = index;
  }

  function beginDragSelection(
    event: ReactPointerEvent<HTMLButtonElement>,
    key: string,
    index: number,
    selected: boolean,
  ): void {
    if (!selectionMode || event.button !== 0 || event.pointerType === "touch") return;
    event.preventDefault();
    event.stopPropagation();
    const selecting = !selected;
    dragSelectionRef.current = {
      selecting,
      seen: new Set([key]),
      lastX: event.clientX,
      lastY: event.clientY,
    };
    lastSelectedIndexRef.current = index;
    setSelectionForKey(key, selecting);
  }

  useEffect(() => {
    if (!selectionMode) {
      dragSelectionRef.current = null;
      return;
    }
    const applyAtPoint = (x: number, y: number): void => {
      const state = dragSelectionRef.current;
      if (state === null) return;
      const target = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-review-key]");
      const key = target?.dataset.reviewKey;
      if (key === undefined || state.seen.has(key)) return;
      state.seen.add(key);
      setSelectionForKey(key, state.selecting);
    };
    const onPointerMove = (event: PointerEvent): void => {
      const state = dragSelectionRef.current;
      if (state === null) return;
      if (event.cancelable) event.preventDefault();
      const distance = Math.hypot(event.clientX - state.lastX, event.clientY - state.lastY);
      const steps = Math.max(1, Math.ceil(distance / 18));
      for (let step = 1; step <= steps; step += 1) {
        const progress = step / steps;
        applyAtPoint(
          state.lastX + (event.clientX - state.lastX) * progress,
          state.lastY + (event.clientY - state.lastY) * progress,
        );
      }
      state.lastX = event.clientX;
      state.lastY = event.clientY;
      const edge = Math.min(96, Math.max(56, window.innerHeight * 0.08));
      if (event.clientY < edge) {
        const strength = (edge - event.clientY) / edge;
        window.scrollBy({ top: -Math.ceil(8 + strength * 24), behavior: "auto" });
      } else if (event.clientY > window.innerHeight - edge) {
        const strength = (event.clientY - (window.innerHeight - edge)) / edge;
        window.scrollBy({ top: Math.ceil(8 + strength * 24), behavior: "auto" });
      }
    };
    const stopDragging = (): void => {
      dragSelectionRef.current = null;
    };
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
      dragSelectionRef.current = null;
    };
  }, [selectionMode, setSelectionForKey]);

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

  async function applyRemoteBibBatch(
    endpoint: "/api/v1/media/bib-review/no-number/batch" | "/api/v1/media/bib-tags/batch",
    mediaIds: readonly string[],
    number?: string,
  ): Promise<{ readonly successCount: number; readonly failures: readonly BatchFailure[] }> {
    let successCount = 0;
    const failures: BatchFailure[] = [];
    for (const batch of chunks(mediaIds, 200)) {
      try {
        const result = await clientMutation<BibBatchResult>(endpoint, {
          body: { mediaIds: batch, ...(number === undefined ? {} : { number }) },
          idempotencyKey: `review-bib-batch-${crypto.randomUUID()}`,
        });
        for (const item of result.items) {
          if (item.ok) successCount += 1;
          else
            failures.push({
              label: item.mediaId.slice(0, 8),
              message: item.message ?? item.code ?? "号码操作失败",
            });
        }
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "批量号码请求失败";
        failures.push(...batch.map((id) => ({ label: id.slice(0, 8), message })));
      }
    }
    return { successCount, failures };
  }

  function finishBatch(
    label: string,
    successCount: number,
    failures: readonly BatchFailure[],
    skippedCount = 0,
  ): void {
    const skippedText = skippedCount > 0 ? `，跳过 ${skippedCount} 张` : "";
    if (failures.length === 0) showNotice(`${label}完成：${successCount} 张${skippedText}`);
    else {
      showNotice(
        `${label}部分完成：成功 ${successCount}，失败 ${failures.length}${skippedText}`,
        "warning",
      );
      setError(
        failures
          .slice(0, 12)
          .map((failure) => `${failure.label}：${failure.message}`)
          .join("\n") + (failures.length > 12 ? `\n另有 ${failures.length - 12} 项失败` : ""),
      );
    }
    setSelectedKeys(new Set());
    setRemoteSelection(null);
    lastSelectedIndexRef.current = null;
  }

  async function batchHide(): Promise<void> {
    if (batchBusy || selectedCount === 0) return;
    setBatchBusy(true);
    try {
      const targets = selectedRemoteItems.filter((item) => item.publicationStatus === "published");
      const result = await applyRemoteBatch(
        "hide",
        targets.map((item) => item.id),
      );
      const ok = new Set(result.okIds);
      setRemoteMedia((current) =>
        current.map((item) =>
          ok.has(item.id) ? { ...item, publicationStatus: "hidden" as const } : item,
        ),
      );
      finishBatch("批量隐藏", result.okIds.length, result.failures, selectedCount - targets.length);
    } finally {
      setBatchBusy(false);
    }
  }

  async function batchRestore(): Promise<void> {
    if (batchBusy || selectedCount === 0) return;
    setBatchBusy(true);
    try {
      const targets = selectedRemoteItems.filter((item) => item.publicationStatus === "hidden");
      const result = await applyRemoteBatch(
        "restore",
        targets.map((item) => item.id),
      );
      const ok = new Set(result.okIds);
      setRemoteMedia((current) =>
        current.map((item) =>
          ok.has(item.id) ? { ...item, publicationStatus: "published" as const } : item,
        ),
      );
      finishBatch("批量显示", result.okIds.length, result.failures, selectedCount - targets.length);
    } finally {
      setBatchBusy(false);
    }
  }

  async function batchSetFeatured(featured: boolean): Promise<void> {
    if (batchBusy || selectedCount === 0) return;
    setBatchBusy(true);
    const localTargets = selectedLocalItems.filter((item) => item.featured !== featured);
    const remoteTargets = selectedRemoteItems.filter((item) => item.featured !== featured);
    const failures: BatchFailure[] = [];
    let successCount = 0;
    try {
      for (const item of localTargets) {
        try {
          await patchLocalReviewPhoto(item.local.photo.id, { featured });
          successCount += 1;
        } catch (cause) {
          failures.push({
            label: item.local.photo.fileName,
            message: cause instanceof Error ? cause.message : "精选状态修改失败",
          });
        }
      }
      for (const group of chunks(remoteTargets, 16)) {
        await Promise.all(
          group.map(async (item) => {
            try {
              await clientMutation(`/api/v1/media/${item.id}/featured`, { body: { featured } });
              successCount += 1;
              setFeaturedIds((current) => {
                const next = new Set(current);
                if (featured) next.add(item.id);
                else next.delete(item.id);
                return next;
              });
            } catch (cause) {
              failures.push({
                label: item.id.slice(0, 8),
                message: cause instanceof Error ? cause.message : "精选状态修改失败",
              });
            }
          }),
        );
      }
      await refreshLocal();
      finishBatch(
        featured ? "批量设为精选" : "批量取消精选",
        successCount,
        failures,
        selectedCount - localTargets.length - remoteTargets.length,
      );
    } finally {
      setBatchBusy(false);
    }
  }

  async function batchChangeCategory(): Promise<void> {
    if (batchBusy || selectedCount === 0 || batchCategory === "mixed") return;
    setBatchBusy(true);
    const nextCategory = batchCategory === "uncategorized" ? null : batchCategory;
    const failures: BatchFailure[] = [];
    let successCount = 0;
    try {
      for (const item of selectedLocalItems) {
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
      const remoteResult = await applyRemoteBatch(
        "change_category",
        selectedRemoteItems.map((item) => item.id),
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
      await refreshLocal();
      finishBatch("批量修改分类", successCount, failures);
    } finally {
      setBatchBusy(false);
    }
  }

  async function batchAddBibNumber(): Promise<void> {
    if (batchBusy || selectedCount === 0) return;
    const number = batchBibNumber.trim();
    if (!/^\d{1,12}$/u.test(number)) {
      setError("统一号码必须为 1–12 位数字");
      return;
    }
    setBatchBusy(true);
    const failures: BatchFailure[] = [];
    let successCount = 0;
    try {
      for (const item of selectedLocalItems) {
        try {
          await confirmLocalBibNumbers(item.local.photo.id, [number], bibConfig.patterns);
          successCount += 1;
        } catch (cause) {
          failures.push({
            label: item.local.photo.fileName,
            message: cause instanceof Error ? cause.message : "号码确认失败",
          });
        }
      }
      const remoteResult = await applyRemoteBibBatch(
        "/api/v1/media/bib-tags/batch",
        selectedRemoteItems.map((item) => item.id),
        number,
      );
      successCount += remoteResult.successCount;
      failures.push(...remoteResult.failures);
      await Promise.all([refreshLocal(), refreshRemote()]);
      setBatchBibNumber("");
      finishBatch("批量添加号码", successCount, failures);
    } finally {
      setBatchBusy(false);
    }
  }

  async function batchConfirmNoNumber(): Promise<void> {
    if (batchBusy || selectedCount === 0) return;
    setBatchBusy(true);
    const failures: BatchFailure[] = [];
    let successCount = 0;
    try {
      for (const item of selectedLocalItems) {
        try {
          await confirmLocalBibNoNumber(item.local.photo.id);
          successCount += 1;
        } catch (cause) {
          failures.push({
            label: item.local.photo.fileName,
            message: cause instanceof Error ? cause.message : "确认无号码失败",
          });
        }
      }
      const remoteResult = await applyRemoteBibBatch(
        "/api/v1/media/bib-review/no-number/batch",
        selectedRemoteItems.map((item) => item.id),
      );
      successCount += remoteResult.successCount;
      failures.push(...remoteResult.failures);
      await Promise.all([refreshLocal(), refreshRemote()]);
      finishBatch("批量确认无号码", successCount, failures);
    } finally {
      setBatchBusy(false);
    }
  }

  async function batchDelete(): Promise<void> {
    if (batchBusy || selectedCount === 0) return;
    setBatchBusy(true);
    const failures: BatchFailure[] = [];
    const deletedMediaIds = new Set<string>();
    let successCount = 0;
    try {
      for (const item of selectedLocalItems) {
        try {
          await deleteLocalReviewState(item.local.photo.id);
          successCount += 1;
        } catch (cause) {
          failures.push({
            label: item.local.photo.fileName,
            message: cause instanceof Error ? cause.message : "删除失败",
          });
        }
      }
      const remoteTargets =
        userRole === "admin" || userRole === "operator" ? selectedRemoteItems : [];
      for (const item of remoteTargets) {
        try {
          await clientMutation(`/api/v1/media/${item.id}/direct`, { method: "DELETE" });
          deletedMediaIds.add(item.id);
          successCount += 1;
        } catch (cause) {
          failures.push({
            label: item.id.slice(0, 8),
            message: cause instanceof Error ? cause.message : "删除失败",
          });
        }
      }
      if (deletedMediaIds.size > 0) {
        setRemoteMedia((current) => current.filter((item) => !deletedMediaIds.has(item.id)));
        setFeaturedIds((current) => {
          const next = new Set(current);
          for (const id of deletedMediaIds) next.delete(id);
          return next;
        });
      }
      await refreshLocal();
      finishBatch(
        "批量删除",
        successCount,
        failures,
        selectedCount - selectedLocalItems.length - remoteTargets.length,
      );
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

  async function fetchSelectionPage(
    publicationStatus?: "draft" | "hidden" | "pending_review" | "published",
    pageCursor?: string,
  ): Promise<RemoteSelectionPage> {
    const query = buildRemoteQuery(publicationStatus, pageCursor);
    query.set("limit", "1000");
    if (filter === "featured") query.set("featured", "true");
    return clientGet<RemoteSelectionPage>(
      `/api/v1/albums/${albumId}/media-selection?${query.toString()}`,
    );
  }

  async function collectSelection(
    publicationStatus?: "draft" | "hidden" | "pending_review" | "published",
  ): Promise<ReadonlyMap<string, RemoteSelectionItem>> {
    const selected = new Map<string, RemoteSelectionItem>();
    let pageCursor: string | undefined;
    let pages = 0;
    do {
      const page = await fetchSelectionPage(publicationStatus, pageCursor);
      for (const item of page.items) selected.set(item.id, item);
      pageCursor = page.nextCursor ?? undefined;
      pages += 1;
      if (pages > 1000) throw new Error("筛选分页异常，已停止全量选择");
    } while (pageCursor !== undefined);
    return selected;
  }

  async function selectAllMatching(): Promise<void> {
    if (batchBusy || selectingAll) return;
    setSelectingAll(true);
    try {
      const remote = new Map<string, RemoteSelectionItem>();
      const publicationStatus =
        filter === "published" ? "published" : filter === "hidden" ? "hidden" : undefined;
      if (filter !== "local") {
        const selected = await collectSelection(publicationStatus);
        for (const item of selected.values()) remote.set(item.id, item);
      }
      const localKeys = visibleItems
        .filter((item) => item.source === "local")
        .map((item) => item.key);
      setSelectedKeys(new Set(localKeys));
      setRemoteSelection(remote);
      lastSelectedIndexRef.current = visibleItems.length === 0 ? null : visibleItems.length - 1;
      showNotice(`已选择全部匹配结果：${localKeys.length + remote.size} 张`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "选择全部匹配结果失败");
    } finally {
      setSelectingAll(false);
    }
  }

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (sentinel === null || cursor === null || selectingAll) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [cursor, loadMore, selectingAll]);

  const advancedFiltersActive =
    assignmentFilter !== "all" ||
    ingestFilter !== "all" ||
    bibDecision !== "all" ||
    bibOcrStatus !== "all" ||
    gradeOption !== "all" ||
    classOption !== "all";
  const inspectorSourceItem = inspectorKey === null ? null : itemByKey(inspectorKey);
  const inspectorItem: ReviewInspectorItem | null =
    inspectorSourceItem === null
      ? null
      : inspectorSourceItem.source === "local"
        ? {
            key: inspectorSourceItem.key,
            title: inspectorSourceItem.local.photo.fileName,
            mediaId: inspectorSourceItem.local.photo.mediaId,
            categoryId: inspectorSourceItem.categoryId,
            uploaderName: null,
            sourceLabel: "本机",
            featured: inspectorSourceItem.featured,
            publicationStatus: inspectorSourceItem.publicationStatus,
            ingestStatus: inspectorSourceItem.local.photo.uploadState,
            editPending: false,
            editActive: false,
            width: inspectorSourceItem.local.photo.width,
            height: inspectorSourceItem.local.photo.height,
            totalBytes: inspectorSourceItem.local.photo.totalBytes,
            createdAt: inspectorSourceItem.createdAt,
            capturedAt: inspectorSourceItem.local.photo.capturedAt,
            bib: inspectorSourceItem.bib,
            canDelete: canDeleteItem(inspectorSourceItem),
          }
        : {
            key: inspectorSourceItem.key,
            title:
              inspectorSourceItem.local?.photo.fileName ??
              `媒体 ${inspectorSourceItem.remote.id.slice(0, 8)}`,
            mediaId: inspectorSourceItem.remote.id,
            categoryId: inspectorSourceItem.categoryId,
            uploaderName:
              uploaders.find((entry) => entry.id === inspectorSourceItem.uploaderId)?.displayName ??
              null,
            sourceLabel: "远端",
            featured: inspectorSourceItem.featured,
            publicationStatus: inspectorSourceItem.publicationStatus,
            ingestStatus: inspectorSourceItem.remote.ingestStatus,
            editPending: inspectorSourceItem.remote.edit?.pendingRevisionId != null,
            editActive: inspectorSourceItem.remote.edit?.activeRevisionId != null,
            width: inspectorSourceItem.remote.width,
            height: inspectorSourceItem.remote.height,
            totalBytes: inspectorSourceItem.remote.totalBytes,
            createdAt: inspectorSourceItem.createdAt,
            capturedAt: inspectorSourceItem.remote.capturedAt,
            bib: inspectorSourceItem.bib,
            canDelete: canDeleteItem(inspectorSourceItem),
          };
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
    <div
      className={cn(
        "flex flex-col gap-3",
        ((inspectorItem !== null && !selectionMode) || (selectionMode && selectedCount > 0)) &&
          "xl:pr-[21rem]",
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-card px-2 py-1.5">
        <Select
          items={[
            { label: "全部状态", value: "all" },
            { label: "处理中", value: "local" },
            { label: "显示中", value: "published" },
            { label: "已隐藏", value: "hidden" },
            { label: "精选", value: "featured" },
          ]}
          onValueChange={(value) => {
            setFilter((value ?? "all") as FilterMode);
            resetSelection();
          }}
          value={filter}
        >
          <SelectTrigger aria-label="照片状态筛选" className="h-8 w-32 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="local">处理中</SelectItem>
              <SelectItem value="published">显示中</SelectItem>
              <SelectItem value="hidden">已隐藏</SelectItem>
              <SelectItem value="featured">精选</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

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
            <SelectTrigger aria-label="分类筛选" className="h-8 w-40 text-xs">
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
            <SelectTrigger aria-label="上传者筛选" className="h-8 w-40 text-xs">
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

        <ReviewCollaborationControl
          albumId={albumId}
          assignment={assignmentFilter}
          onAssignmentChange={(value) => {
            setAssignmentFilter(value);
            if (value === "mine" && filter === "local") setFilter("all");
            resetSelection();
          }}
          onValueChange={(next) => {
            setReviewCollaboration(next);
            resetSelection();
            void refreshRemote().catch((cause) =>
              setError(cause instanceof Error ? cause.message : "刷新审核分工失败"),
            );
          }}
          userRole={userRole}
          value={reviewCollaboration}
        />

        <Select
          items={[
            { label: "最新优先", value: "newest" },
            { label: "最早优先", value: "oldest" },
          ]}
          onValueChange={(value) => {
            setSortOrder((value ?? "newest") as SortOrder);
            resetSelection();
          }}
          value={sortOrder}
        >
          <SelectTrigger aria-label="照片排序" className="h-8 w-28 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="newest">最新优先</SelectItem>
              <SelectItem value="oldest">最早优先</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select
          items={[
            { label: "紧凑", value: "compact" },
            { label: "标准", value: "standard" },
            { label: "大图", value: "large" },
          ]}
          onValueChange={(value) => changeGridDensity((value ?? "standard") as GridDensity)}
          value={gridDensity}
        >
          <SelectTrigger aria-label="网格密度" className="h-8 w-24 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="compact">紧凑</SelectItem>
              <SelectItem value="standard">标准</SelectItem>
              <SelectItem value="large">大图</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select
          items={[
            { label: "全部处理状态", value: "all" },
            { label: "不完整", value: "incomplete" },
            { label: "处理失败", value: "failed" },
          ]}
          onValueChange={(value) => setIngestFilter((value ?? "all") as IngestFilter)}
          value={ingestFilter}
        >
          <SelectTrigger aria-label="处理状态筛选" className="h-8 w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">全部处理状态</SelectItem>
              <SelectItem value="incomplete">不完整</SelectItem>
              <SelectItem value="failed">处理失败</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select
          items={[
            { label: "全部号码状态", value: "all" },
            { label: "待复核", value: "pending" },
            { label: "已确认号码", value: "numbers_confirmed" },
            { label: "已确认无号码", value: "no_number_confirmed" },
            { label: "需复核", value: "needs_review" },
          ]}
          onValueChange={(value) => setBibDecision((value ?? "all") as BibDecisionFilter)}
          value={bibDecision}
        >
          <SelectTrigger aria-label="号码审核状态筛选" className="h-8 w-40 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">全部号码状态</SelectItem>
              <SelectItem value="pending">待复核</SelectItem>
              <SelectItem value="numbers_confirmed">已确认号码</SelectItem>
              <SelectItem value="no_number_confirmed">已确认无号码</SelectItem>
              <SelectItem value="needs_review">需复核</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select
          items={[
            { label: "全部 OCR 状态", value: "all" },
            { label: "未开始", value: "not_started" },
            { label: "识别中", value: "processing" },
            { label: "已完成", value: "completed" },
            { label: "识别失败", value: "failed" },
            { label: "不支持", value: "unsupported" },
          ]}
          onValueChange={(value) => setBibOcrStatus((value ?? "all") as BibOcrFilter)}
          value={bibOcrStatus}
        >
          <SelectTrigger aria-label="号码 OCR 状态筛选" className="h-8 w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">全部 OCR 状态</SelectItem>
              <SelectItem value="not_started">未开始</SelectItem>
              <SelectItem value="processing">识别中</SelectItem>
              <SelectItem value="completed">已完成</SelectItem>
              <SelectItem value="failed">识别失败</SelectItem>
              <SelectItem value="unsupported">不支持</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        {gradeOptions.length === 0 ? null : (
          <Select
            items={[
              { label: "全部年级", value: "all" },
              ...gradeOptions.map((item) => ({ label: item.displayName, value: item.id })),
            ]}
            onValueChange={(value) => {
              setGradeOption(value ?? "all");
              setClassOption("all");
            }}
            value={gradeOption}
          >
            <SelectTrigger aria-label="年级筛选" className="h-8 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">全部年级</SelectItem>
                {gradeOptions.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.displayName}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        )}

        {classOptions.length === 0 || gradeOption === "all" ? null : (
          <Select
            items={[
              { label: "全部班级", value: "all" },
              ...classOptions.map((item) => ({ label: item.displayName, value: item.id })),
            ]}
            onValueChange={(value) => setClassOption(value ?? "all")}
            value={classOption}
          >
            <SelectTrigger aria-label="班级筛选" className="h-8 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">全部班级</SelectItem>
                {classOptions.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.displayName}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        )}

        <Button
          className="ml-auto h-8 px-3 text-xs"
          onClick={() => {
            if (selectionMode) resetSelection();
            else setInspectorKey(null);
            setSelectionMode((current) => !current);
          }}
          size="sm"
          type="button"
          variant={selectionMode ? "secondary" : "outline"}
        >
          {selectionMode ? "退出批量" : "批量选择"}
        </Button>

        {advancedFiltersActive ? (
          <Button
            className="h-8 px-2.5 text-xs"
            onClick={clearAdvancedFilters}
            size="sm"
            type="button"
            variant="ghost"
          >
            清除筛选
          </Button>
        ) : null}

        <Button
          aria-label="刷新审核列表"
          className="size-8"
          onClick={() =>
            void Promise.all([
              refreshLocal(),
              refreshRemote(),
              refreshFeatured(),
              refreshReviewCollaboration(),
            ]).catch((cause) => setError(cause instanceof Error ? cause.message : "刷新失败"))
          }
          size="icon"
          title="刷新审核列表"
          type="button"
          variant="ghost"
        >
          <RefreshCwIcon className="size-3.5" />
        </Button>
      </div>

      {selectionMode ? (
        <div className="sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-lg border bg-background/95 p-2 shadow-sm backdrop-blur">
          <Badge variant="secondary">已选择 {selectedCount} 张</Badge>
          <Button
            disabled={
              batchBusy ||
              selectingAll ||
              (remoteSelection === null && selectedItems.length === visibleItems.length)
            }
            onClick={() => {
              setRemoteSelection(null);
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
            disabled={batchBusy || selectingAll}
            onClick={() => void selectAllMatching()}
            size="sm"
            type="button"
            variant="outline"
          >
            {selectingAll ? (
              <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
            ) : null}
            选择全部匹配
          </Button>
          {selectedCount === 0 ? (
            <span className="text-xs text-muted-foreground">
              点击照片选择；从复选框按住拖动可连续选择，Shift 点击可范围选择
            </span>
          ) : (
            <>
              <span className="text-xs text-muted-foreground">
                可显示 {selectionStats.restorable} · 可隐藏 {selectionStats.hideable} · 可删除{" "}
                {selectionStats.deletable}
              </span>
              <Button
                disabled={batchBusy || selectionStats.restorable === 0}
                onClick={() => void batchRestore()}
                size="sm"
                type="button"
                variant="outline"
              >
                <EyeIcon data-icon="inline-start" />
                显示 {selectionStats.restorable}
              </Button>
              <Button
                disabled={batchBusy || selectionStats.hideable === 0}
                onClick={() => void batchHide()}
                size="sm"
                type="button"
                variant="outline"
              >
                <EyeOffIcon data-icon="inline-start" />
                隐藏 {selectionStats.hideable}
              </Button>
              <Button
                disabled={batchBusy || selectionStats.featureable === 0}
                onClick={() => void batchSetFeatured(true)}
                size="sm"
                type="button"
                variant="outline"
              >
                <StarIcon data-icon="inline-start" />
                精选 {selectionStats.featureable}
              </Button>
              <Button
                disabled={batchBusy || selectionStats.unfeatureable === 0}
                onClick={() => void batchSetFeatured(false)}
                size="sm"
                type="button"
                variant="outline"
              >
                <StarIcon data-icon="inline-start" />
                取消精选 {selectionStats.unfeatureable}
              </Button>
              <div className="flex items-center gap-1">
                <Select
                  items={[
                    ...(batchCategory === "mixed" ? [{ label: "多个值", value: "mixed" }] : []),
                    { label: "未分类", value: "uncategorized" },
                    ...categories.map((item) => ({ label: item.name, value: item.id })),
                  ]}
                  onValueChange={(value) => setBatchCategory(value ?? "mixed")}
                  value={batchCategory}
                >
                  <SelectTrigger aria-label="批量分类" className="h-8 w-32 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {batchCategory === "mixed" ? (
                        <SelectItem disabled value="mixed">
                          多个值
                        </SelectItem>
                      ) : null}
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
                  disabled={batchBusy || batchCategory === "mixed"}
                  onClick={() => void batchChangeCategory()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  应用分类
                </Button>
              </div>
              {bibConfig.recognitionEnabled ? (
                <div className="flex items-center gap-1">
                  <Input
                    aria-label="批量添加统一号码"
                    className="h-8 w-24 text-xs"
                    disabled={batchBusy}
                    inputMode="numeric"
                    maxLength={12}
                    onChange={(event) => {
                      const { value } = event.currentTarget;
                      setBatchBibNumber(value);
                    }}
                    placeholder="统一号码"
                    value={batchBibNumber}
                  />
                  <Button
                    disabled={batchBusy || batchBibNumber.trim().length === 0}
                    onClick={() => void batchAddBibNumber()}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    添加号码
                  </Button>
                  <Button
                    disabled={batchBusy}
                    onClick={() => void batchConfirmNoNumber()}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    确认无号码
                  </Button>
                </div>
              ) : null}
              <Button
                disabled={batchBusy || selectionStats.deletable === 0}
                onClick={() => setBatchDeleteOpen(true)}
                size="sm"
                type="button"
                variant="destructive"
              >
                <Trash2Icon data-icon="inline-start" />
                删除 {selectionStats.deletable}
              </Button>
            </>
          )}
          <Button
            aria-label="清除选择"
            className="ml-auto"
            disabled={batchBusy || selectedCount === 0}
            onClick={resetSelection}
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
      ) : null}

      {visibleItems.length === 0 ? (
        <div className="flex min-h-56 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          当前筛选没有图片
        </div>
      ) : (
        <div
          className={cn(
            "grid grid-cols-2 gap-2 sm:grid-cols-3",
            gridDensity === "compact" && "md:grid-cols-4 xl:grid-cols-7 2xl:grid-cols-8",
            gridDensity === "standard" && "md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6",
            gridDensity === "large" && "md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5",
          )}
        >
          {visibleItems.map((item, index) => {
            const pendingAction = pendingActions.get(item.key) ?? null;
            const pending = pendingAction !== null;
            const published = item.publicationStatus === "published";
            const hidden = item.publicationStatus === "hidden";
            const canToggleVisibility = published || hidden;
            const selected = itemSelected(item);
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
                data-review-key={item.key}
                key={item.key}
              >
                <div className="relative aspect-[4/3] bg-muted">
                  <button
                    aria-label={selectionMode ? (selected ? "取消选择" : "选择照片") : "查看大图"}
                    className="absolute inset-0"
                    onClick={(event) => {
                      if (selectionMode) {
                        toggleSelection(item.key, index, event.shiftKey);
                        return;
                      }
                      setActiveKey(item.key);
                    }}
                    type="button"
                  >
                    {item.previewUrl === null ? null : (
                      <InternalCachedImage
                        alt="审核图片"
                        className="object-cover"
                        fill
                        mediaId={item.source === "remote" ? item.remote.id : null}
                        sizes="(max-width: 639px) 50vw, (max-width: 767px) 33vw, 20vw"
                        src={item.previewUrl}
                        unoptimized
                        variantKind={
                          item.source === "remote"
                            ? item.remote.variants.find(
                                (variant) => variant.url === item.previewUrl,
                              )?.kind
                            : undefined
                        }
                      />
                    )}
                  </button>
                  {selectionMode ? (
                    <Button
                      aria-label={selected ? "取消选择" : "选择照片"}
                      aria-pressed={selected}
                      className="absolute left-1.5 top-1.5 size-7 shadow-sm"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onPointerDown={(event) =>
                        beginDragSelection(event, item.key, index, selected)
                      }
                      size="icon"
                      title="按住并拖动可连续选择；从已选照片开始拖动会连续取消"
                      type="button"
                      variant={selected ? "default" : "secondary"}
                    >
                      {selected ? (
                        <CheckIcon className="size-3.5" />
                      ) : (
                        <SquareIcon className="size-3.5" />
                      )}
                    </Button>
                  ) : null}
                </div>
                {selectionMode ? null : (
                  <div className="flex items-center justify-center gap-1 border-t bg-card p-1.5">
                    <Button
                      aria-label={item.featured ? "取消精选" : "设为精选"}
                      className={cn(
                        "size-8",
                        item.featured &&
                          "bg-amber-100 text-amber-700 hover:bg-amber-200 hover:text-amber-800",
                      )}
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
                      aria-label={published ? "隐藏" : hidden ? "显示" : "等待上传完成"}
                      className={cn(
                        "size-8",
                        published &&
                          "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
                      )}
                      disabled={pending || batchBusy || !canToggleVisibility}
                      onClick={() => void toggleVisibility(item)}
                      size="icon"
                      title={published ? "隐藏" : hidden ? "显示" : "等待上传完成"}
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
                        <LoaderCircleIcon className="size-4 opacity-50" />
                      )}
                    </Button>
                    <Button
                      aria-label={
                        bibBlocked ? "号码识别中" : bibConfirmed ? "修改号码确认" : "确认号码"
                      }
                      className={cn(
                        "size-8",
                        bibBlocked
                          ? "border border-violet-300/70 bg-violet-100/70 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/15 dark:text-violet-200"
                          : bibConfirmed
                            ? "bg-secondary text-secondary-foreground"
                            : "border border-violet-500 bg-violet-600 text-white hover:bg-violet-700 hover:text-white dark:border-violet-400 dark:bg-violet-500 dark:hover:bg-violet-600",
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
                      aria-label="编辑照片属性"
                      className="size-8 max-xl:hidden"
                      disabled={pending || batchBusy}
                      onClick={() => setInspectorKey(item.key)}
                      size="icon"
                      title="照片属性"
                      type="button"
                      variant={inspectorKey === item.key ? "secondary" : "ghost"}
                    >
                      <PanelRightOpenIcon className="size-4" />
                    </Button>
                    <Button
                      aria-label="删除照片"
                      className="size-8"
                      disabled={pending || batchBusy || !canDeleteItem(item)}
                      onClick={() => void deleteItem(item)}
                      size="icon"
                      title={canDeleteItem(item) ? "删除照片" : "仅管理员可删除"}
                      type="button"
                      variant="destructive"
                    >
                      {pendingAction === "delete" ? (
                        <LoaderCircleIcon className="size-4 animate-spin" />
                      ) : (
                        <Trash2Icon className="size-4" />
                      )}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex h-8 items-center justify-center" ref={sentinelRef}>
        {loadingMore || selectingAll ? (
          <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" />
        ) : null}
      </div>

      {selectionMode && selectedCount > 0 ? (
        <div className="fixed bottom-4 right-4 top-20 z-30 hidden w-80 xl:block">
          <ReviewBatchInspector
            bibEnabled={bibConfig.recognitionEnabled}
            bibNumber={batchBibNumber}
            busy={batchBusy}
            categories={categories}
            categoryValue={batchCategory}
            count={selectedCount}
            onAddBibNumber={() => void batchAddBibNumber()}
            onApplyCategory={() => void batchChangeCategory()}
            onBibNumberChange={setBatchBibNumber}
            onCategoryValueChange={setBatchCategory}
            onConfirmNoNumber={() => void batchConfirmNoNumber()}
            onDelete={() => setBatchDeleteOpen(true)}
            onExit={() => {
              resetSelection();
              setSelectionMode(false);
            }}
            onFeature={() => void batchSetFeatured(true)}
            onHide={() => void batchHide()}
            onRestore={() => void batchRestore()}
            onUnfeature={() => void batchSetFeatured(false)}
            stats={selectionStats}
          />
        </div>
      ) : null}

      {!selectionMode && inspectorItem !== null && inspectorSourceItem !== null ? (
        <div className="fixed bottom-4 right-4 top-20 z-30 hidden w-80 xl:block">
          <ReviewInspector
            busy={pendingActions.has(inspectorSourceItem.key) || batchBusy}
            categories={categories}
            item={inspectorItem}
            onCategoryChange={(categoryId) => void changeCategory(inspectorSourceItem, categoryId)}
            onClose={() => setInspectorKey(null)}
            onDelete={() => setInspectorDeleteOpen(true)}
            onOpenBib={() => setBibDialogKey(inspectorSourceItem.key)}
            onStateAction={() => void stateAction(inspectorSourceItem)}
            onToggleFeatured={() => void toggleFeatured(inspectorSourceItem)}
          />
        </div>
      ) : null}

      <ReviewLightbox
        categories={categories}
        items={lightboxItems}
        onBibError={setError}
        onCategoryChange={(key, categoryId) => {
          const item = itemByKey(key);
          if (item !== null) void changeCategory(item, categoryId);
        }}
        onBibStateChange={updateBibState}
        onClose={() => setActiveKey(null)}
        onDelete={(key) => {
          const item = itemByKey(key);
          if (item !== null) void deleteItem(item);
        }}
        onLocalBibConfirmNoNumber={confirmLocalNoNumberByKey}
        onLocalBibConfirmNumbers={confirmLocalNumbersByKey}
        onEditApplied={async () => {
          await Promise.all([refreshRemote(), refreshLocal()]);
        }}
        onSelect={setActiveKey}
        onViewed={(key) => void markViewedItemReviewed(key)}
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

      <AlertDialog open={inspectorDeleteOpen} onOpenChange={setInspectorDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这张照片？</AlertDialogTitle>
            <AlertDialogDescription>
              这是危险操作。远端照片会进入现有删除任务流程，本机照片会从本地处理队列移除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={inspectorSourceItem === null || !canDeleteItem(inspectorSourceItem)}
              onClick={() => {
                setInspectorDeleteOpen(false);
                if (inspectorSourceItem !== null) void deleteItem(inspectorSourceItem);
              }}
              variant="destructive"
            >
              删除照片
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={batchDeleteOpen} onOpenChange={setBatchDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>批量删除照片？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除 {selectionStats.deletable} 张可删除照片。
              {selectedCount > selectionStats.deletable
                ? ` 另有 ${selectedCount - selectionStats.deletable} 张因权限或状态限制会被跳过。`
                : ""}
              删除属于危险操作，远端照片会进入现有删除任务流程。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={batchBusy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={batchBusy || selectionStats.deletable === 0}
              onClick={() => {
                setBatchDeleteOpen(false);
                void batchDelete();
              }}
              variant="destructive"
            >
              删除 {selectionStats.deletable} 张
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ErrorDialog message={error} onClose={() => setError(null)} title="操作失败" />
    </div>
  );
}
