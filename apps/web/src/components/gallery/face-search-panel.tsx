"use client";

import type {
  CreateFaceSearchResponse,
  FaceConsentDeclaration,
  FaceSearchView,
  PublicMediaView,
} from "@photostream/contracts";
import { ImagePlusIcon, ScanFaceIcon, ShieldCheckIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { FaceSearchPanelProps } from "@/components/gallery/face-search-launcher";
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
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ErrorDialog } from "@/components/ui/error-dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { clientGet, publicMutation } from "@/lib/client-api";
import { preprocessFaceReference } from "@/lib/face-reference";

type Stage = "consent" | "choose" | "preparing" | "uploading" | "searching" | "results";

const statusLabels: Record<FaceSearchView["search"]["status"], string> = {
  awaiting_upload: "等待安全上传",
  processing: "正在查找候选",
  partial: "已显示初步结果，正在补查",
  completed: "补查已完成",
  failed: "检索未完整完成",
  cancelled: "已清除",
  expired: "结果已过期",
};

function mergeItems(
  current: readonly PublicMediaView[],
  incoming: readonly PublicMediaView[],
): PublicMediaView[] {
  const incomingById = new Map(incoming.map((item) => [item.id, item]));
  const kept = current.flatMap((item) => {
    const updated = incomingById.get(item.id);
    if (updated === undefined) return [item];
    incomingById.delete(item.id);
    return [updated];
  });
  return [...kept, ...incomingById.values()];
}

function progressFor(stage: Stage, status?: FaceSearchView["search"]["status"]): number {
  if (stage === "preparing") return 15;
  if (stage === "uploading") return 55;
  if (status === "partial") return 90;
  if (status === "completed" || status === "failed") return 100;
  if (stage === "searching" || stage === "results") return 75;
  return 0;
}

export function FaceSearchPanel({
  complaintContact,
  noticeVersion,
  onClose,
  privacyNotice,
  slug,
}: Readonly<FaceSearchPanelProps>) {
  const [stage, setStage] = useState<Stage>("consent");
  const [declaration, setDeclaration] = useState<FaceConsentDeclaration>("self");
  const [acknowledged, setAcknowledged] = useState(false);
  const [view, setView] = useState<FaceSearchView | null>(null);
  const [searchId, setSearchId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(
    async (id: string, cursor?: string): Promise<FaceSearchView> => {
      const query = new URLSearchParams({ limit: "30" });
      if (cursor !== undefined) query.set("cursor", cursor);
      const next = await clientGet<FaceSearchView>(
        `/api/v1/public/albums/${slug}/face-searches/${id}?${query.toString()}`,
        abortRef.current?.signal,
      );
      setView((current) => ({
        ...next,
        items:
          current === null
            ? next.items
            : mergeItems(
                cursor === undefined && current.items.length <= 30
                  ? current.items.filter((item) =>
                      next.items.some((candidate) => candidate.id === item.id),
                    )
                  : current.items,
                next.items,
              ),
      }));
      if (next.search.failureCode === "async_search_failed") {
        setError("补查暂时失败。当前仅显示初步候选，结果可能不完整。");
      }
      setStage("results");
      return next;
    },
    [slug],
  );

  useEffect(() => {
    const status = view?.search.status;
    if (
      searchId === null ||
      (status !== "processing" && status !== "partial" && status !== "awaiting_upload")
    ) {
      return;
    }
    let cancelled = false;
    let delay = 1_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await refresh(searchId);
        if (cancelled) return;
        if (next.search.status === "processing" || next.search.status === "partial") {
          delay = Math.min(5_000, Math.round(delay * 1.6));
          timer = setTimeout(() => void poll(), delay);
        }
      } catch (caught) {
        if (cancelled || abortRef.current?.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : "查询人脸候选失败");
      }
    };
    timer = setTimeout(() => void poll(), delay);
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [refresh, searchId, view?.search.status]);

  useEffect(() => {
    const remove = (event: Event) => {
      const mediaId = (event as CustomEvent<{ mediaId?: string }>).detail?.mediaId;
      if (typeof mediaId !== "string") return;
      setView((current) =>
        current === null
          ? null
          : { ...current, items: current.items.filter((item) => item.id !== mediaId) },
      );
    };
    window.addEventListener("photostream:media-removed", remove);
    return () => window.removeEventListener("photostream:media-removed", remove);
  }, []);

  async function choose(file: File | undefined): Promise<void> {
    if (file === undefined || pending) return;
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setPending(true);
    setError(null);
    setView(null);
    setStage("preparing");
    let created: CreateFaceSearchResponse | null = null;
    try {
      const blob = await preprocessFaceReference(file);
      created = await publicMutation<CreateFaceSearchResponse>(
        `/api/v1/public/albums/${slug}/face-searches`,
        {
          body: {
            declaration,
            noticeVersion,
            reference: { contentType: "image/jpeg", bytes: blob.size },
          },
          signal: controller.signal,
        },
      );
      setSearchId(created.id);
      setStage("uploading");
      const upload = await fetch(created.upload.url, {
        method: "PUT",
        body: blob,
        cache: "no-store",
        credentials: "omit",
        headers: created.upload.headers,
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      if (!upload.ok) throw new Error("参考照直传失败，请检查网络后重试。");
      setStage("searching");
      await publicMutation(`/api/v1/public/albums/${slug}/face-searches/${created.id}/complete`, {
        signal: controller.signal,
      });
      await refresh(created.id);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : "参考照处理失败");
      setStage(created === null ? "choose" : "results");
    } finally {
      setPending(false);
    }
  }

  async function clearAndClose(): Promise<void> {
    abortRef.current?.abort();
    if (searchId !== null) {
      try {
        await publicMutation(`/api/v1/public/albums/${slug}/face-searches/${searchId}`, {
          method: "DELETE",
        });
      } catch {
        // The API keeps a persistent cleanup retry; closing must not retain client-side results.
      }
    }
    setView(null);
    onClose();
  }

  async function restart(): Promise<void> {
    if (pending) return;
    abortRef.current?.abort();
    setPending(true);
    const id = searchId;
    try {
      if (id !== null) {
        await publicMutation(`/api/v1/public/albums/${slug}/face-searches/${id}`, {
          method: "DELETE",
        });
      }
    } catch {
      // Server-side expiry and cleanup retries remain authoritative if immediate deletion fails.
    } finally {
      setError(null);
      setView(null);
      setSearchId(null);
      setStage("choose");
      setPending(false);
    }
  }

  async function loadMore(): Promise<void> {
    if (searchId === null || view?.nextCursor == null || pending) return;
    setPending(true);
    setError(null);
    try {
      await refresh(searchId, view.nextCursor);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "加载更多候选失败");
    } finally {
      setPending(false);
    }
  }

  const status = view?.search.status;
  const progress = progressFor(stage, status);
  return (
    <>
      <Dialog open onOpenChange={(open) => !open && void clearAndClose()}>
        <DialogContent className="public-theme max-h-[calc(100dvh-1rem)] overflow-y-auto bg-background sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>用人脸找照片</DialogTitle>
            <DialogDescription>
              这是候选检索，不是身份核验；相册口令和你的声明都不能证明照片中的身份。
            </DialogDescription>
          </DialogHeader>

          {stage === "consent" ? (
            <FieldGroup>
              <Alert>
                <ShieldCheckIcon aria-hidden="true" />
                <AlertTitle>单独同意与处理说明</AlertTitle>
                <AlertDescription className="flex flex-col gap-2">
                  <p>
                    学校作为处理者，将参考照直传至北京临时私有 OSS，并由阿里云 IMM
                    检测一张人脸、匹配本相册候选；香港 API 只接收随机任务和短期媒体结果。
                  </p>
                  <p>
                    参考照任务完成后立即删除、异常最迟 1 小时删除；结果最长保留 2
                    小时。误匹配可能造成错误照片展示，请勿据此确认身份或处分任何人。
                  </p>
                  <p>{privacyNotice}</p>
                  <p>删除、撤回或投诉：{complaintContact}</p>
                </AlertDescription>
              </Alert>
              <FieldSet>
                <FieldLegend variant="label">你有权提交谁的参考照？</FieldLegend>
                <FieldDescription>
                  只可提交本人，或你作为监护人/已经获得明确授权的人。
                </FieldDescription>
                <ToggleGroup
                  aria-label="参考照授权声明"
                  onValueChange={(values) => {
                    const value = values[0];
                    if (value === "self" || value === "guardian_or_authorized") {
                      setDeclaration(value);
                    }
                  }}
                  spacing={2}
                  value={[declaration]}
                  variant="outline"
                >
                  <ToggleGroupItem value="self">本人</ToggleGroupItem>
                  <ToggleGroupItem value="guardian_or_authorized">监护人/已获授权</ToggleGroupItem>
                </ToggleGroup>
              </FieldSet>
              <Field orientation="horizontal">
                <Checkbox
                  checked={acknowledged}
                  id="face-search-consent"
                  onCheckedChange={setAcknowledged}
                />
                <FieldLabel htmlFor="face-search-consent">
                  我已阅读上述说明，理解这不是身份核验，并单独同意本次处理。
                </FieldLabel>
              </Field>
            </FieldGroup>
          ) : null}

          {stage === "choose" ? (
            <Field>
              <FieldLabel htmlFor="face-reference-file">选择一张只有一张清晰人脸的照片</FieldLabel>
              <Input
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
                id="face-reference-file"
                onChange={(event) => void choose(event.currentTarget.files?.[0])}
                type="file"
              />
              <FieldDescription>
                浏览器会纠正方向、移除 EXIF/GPS，并转为最长边 1920、最大 3 MiB 的 JPEG；若设备无法解码
                HEIC/HEIF，请改选 JPEG、PNG 或 WebP。
              </FieldDescription>
            </Field>
          ) : null}

          {stage === "preparing" || stage === "uploading" || stage === "searching" ? (
            <Progress value={progress}>
              <ProgressLabel>
                {stage === "preparing"
                  ? "正在设备上安全处理参考照"
                  : stage === "uploading"
                    ? "正在直传临时私有存储"
                    : "正在查找候选"}
              </ProgressLabel>
              <ProgressValue />
            </Progress>
          ) : null}

          {stage === "results" && view !== null ? (
            <section aria-labelledby="face-results-title" className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <h3 className="font-heading text-base font-medium" id="face-results-title">
                  可能包含此人的照片
                </h3>
                <p aria-live="polite" className="text-sm text-muted-foreground">
                  {statusLabels[view.search.status]} · 已加载 {view.items.length} 张候选
                </p>
              </div>
              {view.items.length === 0 &&
              (view.search.status === "completed" || view.search.status === "failed") ? (
                <Empty className="min-h-48 border">
                  <EmptyHeader>
                    <EmptyTitle>没有可安全展示的候选</EmptyTitle>
                    <EmptyDescription>无匹配和被发布/排除状态过滤使用相同空结果。</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <MediaGrid items={view.items} slug={slug} />
              )}
              {view.nextCursor === null ? null : (
                <Button
                  disabled={pending}
                  onClick={() => void loadMore()}
                  type="button"
                  variant="outline"
                >
                  加载更多候选
                </Button>
              )}
            </section>
          ) : null}

          <DialogFooter>
            <Button onClick={() => void clearAndClose()} type="button" variant="ghost">
              <Trash2Icon data-icon="inline-start" />
              清除并关闭
            </Button>
            {stage === "consent" ? (
              <Button disabled={!acknowledged} onClick={() => setStage("choose")} type="button">
                <ImagePlusIcon data-icon="inline-start" />
                同意并选择照片
              </Button>
            ) : null}
            {stage === "results" ? (
              <Button
                disabled={pending}
                onClick={() => void restart()}
                type="button"
                variant="outline"
              >
                <ScanFaceIcon data-icon="inline-start" />
                换一张照片
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ErrorDialog message={error} onClose={() => setError(null)} title="人脸找图失败" />
    </>
  );
}
