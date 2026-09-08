"use client";

import type {
  CreateFaceSearchResponse,
  FaceSearchView,
  PublicMediaView,
} from "@photostream/contracts";
import { CameraIcon, ScanFaceIcon, ScanSearchIcon, SearchIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";

import { MediaGrid } from "@/components/gallery/media-grid";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { clientGet, publicMutation } from "@/lib/client-api";
import { preprocessFaceReference } from "@/lib/face-reference";
import { recordSearchUsage } from "@/lib/search-usage";

interface SearchPage {
  readonly items: readonly PublicMediaView[];
  readonly nextCursor: string | null;
  readonly eventCursor: number;
}

interface AttributeOption {
  readonly id: string;
  readonly dimension: "grade" | "class";
  readonly displayName: string;
  readonly sortOrder: number;
}

interface AttributePair {
  readonly gradeOptionId: string;
  readonly classOptionId: string | null;
}

interface FaceSearchOptions {
  readonly noticeVersion: string;
  readonly privacyNotice: string;
}

type SearchMode = "attributes" | "face" | "number";
type ResultMode = "attributes" | "face" | "number";
type FaceStage = "consent" | "choose" | "preparing" | "uploading" | "searching" | "failed";

function mergeItems(
  current: readonly PublicMediaView[],
  incoming: readonly PublicMediaView[],
): PublicMediaView[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}

function isFaceWorking(view: FaceSearchView | null, stage: FaceStage): boolean {
  return (
    stage === "preparing" ||
    stage === "uploading" ||
    stage === "searching" ||
    view?.search.status === "awaiting_upload" ||
    view?.search.status === "processing" ||
    view?.search.status === "partial"
  );
}

function faceProgress(stage: FaceStage, view: FaceSearchView | null): number {
  if (stage === "preparing") return 16;
  if (stage === "uploading") return 42;
  if (stage === "searching" && view === null) return 64;
  if (view?.search.status === "partial") return 88;
  if (view?.search.status === "processing") return 74;
  if (view?.search.status === "completed" || view?.search.status === "failed") return 100;
  return 0;
}

export function BibSearchPanel({
  attributeFilterEnabled,
  attributeOptions,
  attributePairs,
  bibSearchEnabled = true,
  categoryId,
  children,
  faceSearch,
  numberLengths,
  slug,
}: Readonly<{
  attributeFilterEnabled: boolean;
  attributeOptions: readonly AttributeOption[];
  attributePairs: readonly AttributePair[];
  bibSearchEnabled?: boolean;
  categoryId?: string;
  children: ReactNode;
  faceSearch?: FaceSearchOptions;
  numberLengths: readonly number[];
  slug: string;
}>) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<SearchMode>(bibSearchEnabled ? "number" : "face");
  const [resultMode, setResultMode] = useState<ResultMode | null>(null);
  const [number, setNumber] = useState("");
  const [gradeOptionId, setGradeOptionId] = useState<string | null>(null);
  const [classOptionId, setClassOptionId] = useState<string | null>(null);
  const [result, setResult] = useState<SearchPage | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [faceStage, setFaceStage] = useState<FaceStage>("consent");
  const [acknowledged, setAcknowledged] = useState(false);
  const [faceView, setFaceView] = useState<FaceSearchView | null>(null);
  const [faceSearchId, setFaceSearchId] = useState<string | null>(null);
  const [facePending, setFacePending] = useState(false);
  const [faceCloseWarning, setFaceCloseWarning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const gradeOptions = attributeOptions.filter((option) => option.dimension === "grade");
  const allowedClassIds = new Set(
    attributePairs.flatMap((pair) =>
      pair.gradeOptionId === gradeOptionId && pair.classOptionId !== null
        ? [pair.classOptionId]
        : [],
    ),
  );
  const classOptions = attributeOptions.filter(
    (option) => option.dimension === "class" && allowedClassIds.has(option.id),
  );
  const numberPlaceholder =
    numberLengths.length === 0
      ? "输入完整号码"
      : `输入号码（${numberLengths.map((length) => `${length} 位`).join("或")}）`;

  async function search(cursor?: string, trackUsage = true): Promise<void> {
    if (pending || mode === "face") return;
    if (mode === "number" && number.length === 0) return;
    if (mode === "attributes" && gradeOptionId === null) return;
    setPending(true);
    setError(null);
    try {
      const page =
        mode === "number"
          ? await publicMutation<SearchPage>(`/api/v1/public/albums/${slug}/bib-search`, {
              body: { number, ...(cursor === undefined ? {} : { cursor }) },
            })
          : await publicMutation<SearchPage>(
              `/api/v1/public/albums/${slug}/bib-attributes-filter`,
              {
                body: {
                  gradeOptionId,
                  ...(classOptionId === null ? {} : { classOptionId }),
                  ...(categoryId === undefined ? {} : { categoryId }),
                  ...(cursor === undefined ? {} : { cursor }),
                },
              },
            );
      if (cursor === undefined && trackUsage) recordSearchUsage(slug, mode);
      setResult((current) => {
        if (cursor === undefined || current === null) return page;
        return { ...page, items: mergeItems(current.items, page.items) };
      });
      setResultMode(mode);
      if (cursor === undefined) setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "查找失败");
    } finally {
      setPending(false);
    }
  }

  const refreshCurrentSearch = useEffectEvent(() => {
    if (resultMode === "number" || resultMode === "attributes") void search(undefined, false);
  });

  useEffect(() => {
    if (result === null || resultMode === "face") return;
    const refresh = () => refreshCurrentSearch();
    window.addEventListener("photostream:bib-updated", refresh);
    window.addEventListener("photostream:media-published", refresh);
    return () => {
      window.removeEventListener("photostream:bib-updated", refresh);
      window.removeEventListener("photostream:media-published", refresh);
    };
  }, [result, resultMode]);

  const refreshFace = useCallback(
    async (id: string, cursor?: string): Promise<FaceSearchView> => {
      const query = new URLSearchParams({ limit: "100" });
      if (cursor !== undefined) query.set("cursor", cursor);
      const next = await clientGet<FaceSearchView>(
        `/api/v1/public/albums/${slug}/face-searches/${id}?${query.toString()}`,
        abortRef.current?.signal,
      );
      setFaceView((current) => ({
        ...next,
        items: current === null ? next.items : mergeItems(current.items, next.items),
      }));
      return next;
    },
    [slug],
  );

  useEffect(() => {
    const status = faceView?.search.status;
    if (
      faceSearchId === null ||
      (status !== "processing" && status !== "partial" && status !== "awaiting_upload")
    ) {
      return;
    }
    let cancelled = false;
    let delay = 1_000;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const next = await refreshFace(faceSearchId);
        if (cancelled) return;
        if (next.search.status === "completed") {
          setResultMode("face");
          setOpen(false);
          return;
        }
        if (next.search.status === "failed") {
          if (next.items.length > 0) {
            setResultMode("face");
            setOpen(false);
          } else {
            setFaceStage("failed");
          }
          return;
        }
        if (
          next.search.status === "processing" ||
          next.search.status === "partial" ||
          next.search.status === "awaiting_upload"
        ) {
          delay = Math.min(4_000, Math.round(delay * 1.45));
          timer = setTimeout(() => void poll(), delay);
        }
      } catch (caught) {
        if (cancelled || abortRef.current?.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : "查询人脸候选失败");
        timer = setTimeout(() => void poll(), Math.min(4_000, Math.round(delay * 1.45)));
      }
    };

    timer = setTimeout(() => void poll(), delay);
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [faceSearchId, faceView?.search.status, refreshFace]);

  async function chooseFace(file: File | undefined): Promise<void> {
    if (file === undefined || faceSearch === undefined || facePending) return;
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setFacePending(true);
    setError(null);
    setFaceView(null);
    setFaceStage("preparing");
    let created: CreateFaceSearchResponse | null = null;
    try {
      const blob = await preprocessFaceReference(file);
      created = await publicMutation<CreateFaceSearchResponse>(
        `/api/v1/public/albums/${slug}/face-searches`,
        {
          body: {
            declaration: "guardian_or_authorized",
            noticeVersion: faceSearch.noticeVersion,
            reference: { contentType: "image/jpeg", bytes: blob.size },
          },
          signal: controller.signal,
        },
      );
      recordSearchUsage(slug, "face");
      setFaceSearchId(created.id);
      setFaceStage("uploading");
      const upload = await fetch(created.upload.url, {
        method: "PUT",
        body: blob,
        cache: "no-store",
        credentials: "omit",
        headers: created.upload.headers,
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      if (!upload.ok) throw new Error("参考照片上传失败，请检查网络后重试。");
      setFaceStage("searching");
      await publicMutation(`/api/v1/public/albums/${slug}/face-searches/${created.id}/complete`, {
        signal: controller.signal,
      });
      const next = await refreshFace(created.id);
      if (next.search.status === "completed") {
        setResultMode("face");
        setOpen(false);
      } else if (next.search.status === "failed") {
        if (next.items.length > 0) {
          setResultMode("face");
          setOpen(false);
        } else {
          setFaceStage("failed");
        }
      }
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : "参考照片处理失败");
      setFaceStage(created === null ? "choose" : "failed");
    } finally {
      setFacePending(false);
    }
  }

  async function cancelFaceSearch(): Promise<void> {
    abortRef.current?.abort();
    const id = faceSearchId;
    setFacePending(true);
    try {
      if (id !== null) {
        await publicMutation(`/api/v1/public/albums/${slug}/face-searches/${id}`, {
          method: "DELETE",
        });
      }
    } catch {
      // Server expiry and cleanup remain authoritative if immediate cancellation fails.
    } finally {
      setFaceView(null);
      setFaceSearchId(null);
      setFaceStage("choose");
      setFaceCloseWarning(false);
      setFacePending(false);
      setResultMode(null);
    }
  }

  async function loadMoreFace(): Promise<void> {
    if (faceSearchId === null || faceView?.nextCursor == null || facePending) return;
    setFacePending(true);
    setError(null);
    try {
      await refreshFace(faceSearchId, faceView.nextCursor);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "加载更多候选失败");
    } finally {
      setFacePending(false);
    }
  }

  function changeMode(nextMode: SearchMode): void {
    setMode(nextMode);
    setFaceCloseWarning(false);
  }

  function requestDialogChange(nextOpen: boolean): void {
    if (!nextOpen && mode === "face" && isFaceWorking(faceView, faceStage)) {
      setFaceCloseWarning(true);
      return;
    }
    setOpen(nextOpen);
  }

  function clearResult(): void {
    setResult(null);
    setResultMode(null);
    if (faceSearchId !== null) void cancelFaceSearch();
  }

  const faceWorking = mode === "face" && isFaceWorking(faceView, faceStage);
  const faceItems = faceView?.items ?? [];
  const faceStatus = faceView?.search.status;
  const resultItems = resultMode === "face" ? faceItems : (result?.items ?? []);
  const resultNextCursor = resultMode === "face" ? faceView?.nextCursor : result?.nextCursor;
  const resultLabel =
    resultMode === "number"
      ? `号码 ${number}`
      : resultMode === "attributes"
        ? "年级班级"
        : resultMode === "face"
          ? "人脸找图"
          : "找照片";
  const resultSummary =
    resultMode === null
      ? "按号码、年级班级或人脸筛选"
      : resultMode === "face" && faceStatus === "failed"
        ? `检索未完整完成 · 已找到 ${resultItems.length} 张候选`
        : `找到 ${resultItems.length} 张照片`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-1 rounded-xl border bg-background/75 p-1 shadow-xs backdrop-blur-sm">
        <button
          className="group flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 text-left transition-[transform,background-color] duration-150 hover:bg-muted/45 active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 motion-reduce:transform-none motion-reduce:transition-none"
          onClick={() => setOpen(true)}
          type="button"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted/65 transition-[transform,background-color] duration-200 group-hover:bg-muted group-active:scale-95 motion-reduce:transform-none motion-reduce:transition-none">
            <SearchIcon aria-hidden="true" className="size-4 text-muted-foreground" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{resultLabel}</span>
            <span className="block truncate text-[11px] leading-4 text-muted-foreground">
              {resultSummary}
            </span>
          </span>
        </button>
        {resultMode === null ? null : (
          <Button
            aria-label="清除找照片条件"
            className="shrink-0 rounded-lg animate-in fade-in-0 zoom-in-90 duration-200 motion-reduce:animate-none"
            onClick={clearResult}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <XIcon aria-hidden="true" />
          </Button>
        )}
      </div>

      {resultMode === null ? (
        children
      ) : resultItems.length === 0 ? (
        <div className="flex min-h-44 items-center justify-center rounded-2xl border border-dashed bg-muted/15 px-5 text-center text-sm text-muted-foreground animate-in fade-in-0 slide-in-from-bottom-1 duration-200 motion-reduce:animate-none">
          {resultMode === "face" ? "检索已完成，没有找到匹配照片" : "没有匹配照片"}
        </div>
      ) : (
        <section
          aria-label="照片查找结果"
          className="flex flex-col gap-4 animate-in fade-in-0 slide-in-from-bottom-1 duration-250 motion-reduce:animate-none"
        >
          <MediaGrid items={resultItems} slug={slug} />
          {resultNextCursor == null ? null : resultMode === "face" ? (
            <Button
              className="self-center rounded-full"
              disabled={facePending}
              onClick={() => void loadMoreFace()}
              size="sm"
              type="button"
              variant="outline"
            >
              加载更多
            </Button>
          ) : (
            <Button
              className="self-center rounded-full"
              disabled={pending}
              onClick={() => void search(resultNextCursor ?? undefined)}
              size="sm"
              type="button"
              variant="outline"
            >
              加载更多
            </Button>
          )}
        </section>
      )}

      <Dialog open={open} onOpenChange={requestDialogChange}>
        <DialogContent className="public-theme flex max-h-[88dvh] flex-col gap-0 overflow-hidden border bg-background/98 p-0 shadow-2xl max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-t-[1.75rem] max-sm:rounded-b-none max-sm:data-open:slide-in-from-bottom-full max-sm:data-open:zoom-in-100 max-sm:data-closed:slide-out-to-bottom-full max-sm:data-closed:zoom-out-100 max-sm:duration-300 sm:max-w-md sm:rounded-3xl motion-reduce:duration-0">
          <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/20 sm:hidden" />
          <DialogHeader className="shrink-0 px-5 pt-3 pb-2.5 pr-12 sm:pt-5 sm:pb-3">
            <DialogTitle className="text-base">找照片</DialogTitle>
            <DialogDescription className="text-xs leading-5">
              选择一种方式快速筛选照片
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 overflow-y-auto px-4 py-3 overscroll-contain sm:px-5 sm:pb-4">
            <div className="flex flex-col gap-3.5">
              <ToggleGroup
                aria-label="找照片方式"
                className="grid w-full grid-cols-3 rounded-2xl border bg-muted/30 p-1"
                onValueChange={(values) => {
                  const value = values[0];
                  if (value === "number" || value === "attributes" || value === "face") {
                    changeMode(value);
                  }
                }}
                spacing={2}
                value={[mode]}
              >
                {bibSearchEnabled ? (
                  <ToggleGroupItem className="h-11 rounded-xl text-xs sm:h-9" value="number">
                    号码
                  </ToggleGroupItem>
                ) : null}
                {bibSearchEnabled && attributeFilterEnabled ? (
                  <ToggleGroupItem
                    className="h-11 rounded-xl text-xs sm:h-9"
                    value="attributes"
                  >
                    年级班级
                  </ToggleGroupItem>
                ) : null}
                {faceSearch === undefined ? null : (
                  <ToggleGroupItem className="h-11 rounded-xl text-xs sm:h-9" value="face">
                    人脸
                  </ToggleGroupItem>
                )}
              </ToggleGroup>

              <div
                className="animate-in fade-in-0 slide-in-from-bottom-1 duration-200 motion-reduce:animate-none"
                key={mode}
              >
                {mode === "number" && bibSearchEnabled ? (
                  <Field>
                    <FieldLabel className="sr-only" htmlFor="public-bib-number">
                      输入号码找照片
                    </FieldLabel>
                    <Input
                      autoComplete="off"
                      className="h-12 rounded-2xl border-muted-foreground/15 bg-muted/20 px-4 text-base shadow-none"
                      id="public-bib-number"
                      inputMode="numeric"
                      maxLength={12}
                      onChange={(event) => setNumber(event.currentTarget.value.replace(/\D/gu, ""))}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && number.length > 0) void search();
                      }}
                      placeholder={numberPlaceholder}
                      value={number}
                    />
                  </Field>
                ) : null}

                {mode === "attributes" && bibSearchEnabled && attributeFilterEnabled ? (
                  <FieldGroup className="grid grid-cols-2 gap-2.5 rounded-2xl bg-muted/20 p-3 max-sm:grid-cols-1">
                    <Field>
                      <FieldLabel className="text-xs" htmlFor="public-bib-grade">
                        年级
                      </FieldLabel>
                      <Select
                        items={gradeOptions.map((option) => ({
                          value: option.id,
                          label: option.displayName,
                        }))}
                        onValueChange={(value) => {
                          setGradeOptionId(typeof value === "string" ? value : null);
                          setClassOptionId(null);
                        }}
                        value={gradeOptionId}
                      >
                        <SelectTrigger
                          className="h-12 min-h-12 rounded-xl bg-background sm:h-11 sm:min-h-11"
                          id="public-bib-grade"
                        >
                          <SelectValue>
                            {(value) =>
                              value === null
                                ? "选择年级"
                                : (gradeOptions.find((option) => option.id === value)?.displayName ??
                                  "选择年级")
                            }
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {gradeOptions.map((option) => (
                              <SelectItem key={option.id} value={option.id}>
                                {option.displayName}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field data-disabled={gradeOptionId === null || undefined}>
                      <FieldLabel className="text-xs" htmlFor="public-bib-class">
                        班级
                      </FieldLabel>
                      <Select
                        disabled={gradeOptionId === null}
                        items={[
                          { value: "all", label: "全部班级" },
                          ...classOptions.map((option) => ({
                            value: option.id,
                            label: option.displayName,
                          })),
                        ]}
                        onValueChange={(value) =>
                          setClassOptionId(
                            typeof value === "string" && value !== "all" ? value : null,
                          )
                        }
                        value={classOptionId ?? "all"}
                      >
                        <SelectTrigger
                          className="h-12 min-h-12 rounded-xl bg-background sm:h-11 sm:min-h-11"
                          id="public-bib-class"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="all">全部班级</SelectItem>
                            {classOptions.map((option) => (
                              <SelectItem key={option.id} value={option.id}>
                                {option.displayName}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                  </FieldGroup>
                ) : null}

                {mode === "face" && faceSearch !== undefined ? (
                  <div className="flex flex-col gap-3">
                    {faceStage === "consent" ? (
                      <div className="contents animate-in fade-in-0 duration-200 motion-reduce:animate-none">
                        <Alert className="rounded-2xl border-0 bg-muted/35 shadow-none">
                          <ScanFaceIcon aria-hidden="true" />
                          <AlertTitle>人脸找图处理说明</AlertTitle>
                          <AlertDescription className="flex flex-col gap-1.5 text-xs leading-5">
                            <p>
                              系统会使用你提交的一张参考照片，只在本相册中查找可能包含同一人物的照片。参考照片仅用于本次找图，不用于身份认证或建立人物档案。
                            </p>
                            <p>
                              参考照片会在查找结束后删除，异常情况下最长保留 1
                              小时；本次候选结果最长保留 2 小时。结果可能存在漏检、误匹配或无结果。
                            </p>
                            <p>请仅提交本人或已取得明确授权的人物照片。</p>
                          </AlertDescription>
                        </Alert>

                        <div className="flex items-start gap-3 rounded-xl border border-border/70 bg-muted/10 px-3.5 py-3">
                          <Checkbox
                            checked={acknowledged}
                            className="mt-0.5 size-5 rounded-md border-2 border-muted-foreground/30 bg-background shadow-xs transition-[border-color,background-color,box-shadow,transform] hover:border-primary/60 active:scale-95 focus-visible:ring-2 focus-visible:ring-ring/40 data-checked:border-primary data-checked:bg-primary"
                            id="face-search-consent"
                            onCheckedChange={setAcknowledged}
                          />
                          <label
                            className="cursor-pointer text-xs leading-5 text-muted-foreground"
                            htmlFor="face-search-consent"
                          >
                            我已阅读并同意上述处理方式，并确认提交的是本人或已获得明确授权的人物照片。
                          </label>
                        </div>
                      </div>
                    ) : null}

                    {faceStage === "choose" ? (
                      <div className="rounded-2xl border bg-muted/15 p-5 text-center animate-in fade-in-0 zoom-in-95 duration-200 motion-reduce:animate-none">
                        <span className="mx-auto mb-3 grid size-11 place-items-center rounded-2xl bg-muted/70">
                          <ScanFaceIcon aria-hidden="true" className="size-5 text-muted-foreground" />
                        </span>
                        <p className="text-sm font-medium">选择你想查找人物的清晰单人照片</p>
                        <p className="mx-auto mt-1 max-w-xs text-xs leading-5 text-muted-foreground">
                          照片中应只有你想在本相册中查找的人，尽量选择正脸、清晰、无遮挡的照片。
                        </p>
                        <div className="mt-3 flex flex-wrap justify-center gap-2 max-sm:flex-col">
                          <label
                            className="inline-flex h-12 min-w-28 cursor-pointer items-center justify-center gap-2 rounded-xl border bg-background px-4 text-sm font-medium shadow-xs transition-[transform,background-color] duration-150 hover:bg-muted/55 active:scale-[0.98] sm:h-11 motion-reduce:transform-none motion-reduce:transition-none"
                            htmlFor="face-reference-file"
                          >
                            选择照片
                            <Input
                              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
                              className="sr-only"
                              id="face-reference-file"
                              onChange={(event) => void chooseFace(event.currentTarget.files?.[0])}
                              type="file"
                            />
                          </label>
                          <label
                            className="inline-flex h-12 min-w-28 cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs transition-[transform,opacity] duration-150 hover:opacity-90 active:scale-[0.98] sm:h-11 motion-reduce:transform-none motion-reduce:transition-none"
                            htmlFor="face-reference-camera"
                          >
                            <CameraIcon aria-hidden="true" className="size-4" />
                            拍照
                            <Input
                              accept="image/*"
                              capture="environment"
                              className="sr-only"
                              id="face-reference-camera"
                              onChange={(event) => void chooseFace(event.currentTarget.files?.[0])}
                              type="file"
                            />
                          </label>
                        </div>
                      </div>
                    ) : null}

                    {faceWorking ? (
                      <div className="flex flex-col gap-3 rounded-2xl border bg-muted/15 p-4 animate-in fade-in-0 slide-in-from-bottom-1 duration-200 motion-reduce:animate-none">
                        <Progress value={faceProgress(faceStage, faceView)}>
                          <ProgressLabel>
                            {faceStage === "preparing"
                              ? "正在处理参考照片"
                              : faceStage === "uploading"
                                ? "正在提交参考照片"
                                : faceItems.length > 0
                                  ? `已找到 ${faceItems.length} 张候选，正在继续查找`
                                  : "正在查找照片"}
                          </ProgressLabel>
                          <ProgressValue />
                        </Progress>
                        <p aria-live="polite" className="text-xs leading-5 text-muted-foreground">
                          {faceItems.length === 0
                            ? "当前还没有返回候选，请等待查找完成后再判断结果。"
                            : "结果仍在更新，查找完成前数量可能变化。"}
                        </p>
                        {faceItems.length === 0 ? null : (
                          <div className="max-h-52 overflow-y-auto rounded-xl overscroll-contain">
                            <MediaGrid items={faceItems} slug={slug} />
                          </div>
                        )}
                      </div>
                    ) : null}

                    {faceStage === "failed" ? (
                      <Alert
                        className="rounded-2xl animate-in fade-in-0 slide-in-from-bottom-1 duration-200 motion-reduce:animate-none"
                        variant="destructive"
                      >
                        <AlertTitle>本次检索未完整完成</AlertTitle>
                        <AlertDescription>
                          当前结果不完整，请重新尝试；未完成的任务不会显示为“没有找到”。
                        </AlertDescription>
                      </Alert>
                    ) : null}

                    {faceCloseWarning ? (
                      <Alert className="rounded-2xl animate-in fade-in-0 slide-in-from-bottom-1 duration-200 motion-reduce:animate-none">
                        <AlertTitle>查找仍在进行</AlertTitle>
                        <AlertDescription>
                          建议等待查找完成；如果不再需要，可以取消本次搜索。
                        </AlertDescription>
                      </Alert>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <DialogFooter className="shrink-0 border-t bg-background/95 px-6 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] backdrop-blur-xl sm:px-5 sm:py-3">
            {mode === "face" && faceSearch !== undefined ? (
              <>
                {faceWorking ? (
                  <Button
                    className="max-sm:h-12 max-sm:w-full"
                    disabled={facePending}
                    onClick={() => void cancelFaceSearch()}
                    type="button"
                    variant="ghost"
                  >
                    取消本次搜索
                  </Button>
                ) : null}
                {faceStage === "consent" ? (
                  <Button
                    className="h-12 rounded-xl max-sm:w-full"
                    disabled={!acknowledged}
                    onClick={() => setFaceStage("choose")}
                    type="button"
                  >
                    同意并继续
                  </Button>
                ) : null}
                {faceStage === "failed" ? (
                  <Button
                    className="h-12 rounded-xl max-sm:w-full"
                    disabled={facePending}
                    onClick={() => {
                      setFaceView(null);
                      setFaceSearchId(null);
                      setFaceStage("choose");
                    }}
                    type="button"
                  >
                    重新选择照片
                  </Button>
                ) : null}
              </>
            ) : (
              <Button
                className="h-12 rounded-xl text-base font-medium max-sm:w-full sm:min-w-36"
                disabled={
                  pending || (mode === "number" ? number.length === 0 : gradeOptionId === null)
                }
                onClick={() => void search()}
                type="button"
              >
                <ScanSearchIcon data-icon="inline-start" />
                {pending ? "查找中…" : "查找"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ErrorDialog message={error} onClose={() => setError(null)} title="找照片失败" />
    </div>
  );
}
