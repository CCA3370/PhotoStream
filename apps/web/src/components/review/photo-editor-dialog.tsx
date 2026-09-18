"use client";

import type { MediaEditContextView } from "@photostream/contracts";
import { RotateCcwIcon, SparklesIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { toast } from "@/components/ui/toast";
import { getLocalReviewPhoto } from "@/lib/local-review-queue";
import {
  type PhotoEditAiProgress,
  photoEditAiAvailable,
  restoreMediaEditPreview,
} from "@/lib/photo-edit/ai-runtime";
import { automaticPhotoEditRecipe } from "@/lib/photo-edit/analysis";
import { syncLocalPhotoEditDraft } from "@/lib/photo-edit/local-draft-sync";
import {
  getLocalPhotoEditDraft,
  patchLocalPhotoEditDraft,
  photoEditSourceFingerprint,
  putAppliedLocalPhotoEditDraft,
  putLocalPhotoEditDraft,
} from "@/lib/photo-edit/local-drafts";
import {
  defaultPhotoEditRecipe,
  normalizePhotoEditRecipe,
  type PhotoEditRecipe,
  photoEditRecipeFromUnknown,
} from "@/lib/photo-edit/recipe";
import {
  applyMediaEditRecipe,
  cancelPendingMediaEditRevision,
  getMediaEditContext,
  switchMediaEditRevision,
} from "@/lib/photo-edit/revision-client";
import { analyzeMediaEditSource, renderMediaEditPreview } from "@/lib/photo-edit/runtime";
import {
  type MediaEditSourceOrigin,
  resolveMediaEditSource,
} from "@/lib/photo-edit/source-resolver";
import { userFacingErrorMessage } from "@/lib/user-facing-error";

type EditorStage = "loading" | "ready" | "analyzing" | "applying" | "error";

interface RangeControlProps {
  readonly label: string;
  readonly value: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly step: number;
  readonly disabled: boolean;
  readonly format?: (value: number) => string;
  readonly onChange: (value: number) => void;
}

function RangeControl({
  label,
  value,
  minimum,
  maximum,
  step,
  disabled,
  format = (number) => String(number),
  onChange,
}: RangeControlProps) {
  return (
    <label className="grid grid-cols-[5.5rem_minmax(0,1fr)_3.75rem] items-center gap-3 text-xs">
      <span className="font-medium">{label}</span>
      <input
        aria-label={label}
        className="h-1.5 w-full cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        max={maximum}
        min={minimum}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        step={step}
        type="range"
        value={value}
      />
      <span className="text-right tabular-nums text-muted-foreground">{format(value)}</span>
    </label>
  );
}

function revisionTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "历史版本";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Shanghai",
  }).format(date);
}

function sourceLabel(origin: MediaEditSourceOrigin | null): string {
  if (origin === "local-original") return "本机原图";
  if (origin === "remote-original") return "远端原图";
  return "正在解析";
}

function formatModelBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function aiOperationLabel(operation: PhotoEditAiProgress["operation"]): string {
  if (operation === "denoise") return "AI 降噪";
  if (operation === "deblur") return "AI 清晰化";
  return "AI 模型";
}

export interface PhotoEditorPreviewState {
  readonly beforeUrl: string | null;
  readonly afterUrl: string | null;
  readonly loading: boolean;
}

export function PhotoEditorPanel({
  mediaId,
  localPhotoId = null,
  onApplied,
  onClose,
  onPreviewChange,
}: Readonly<{
  mediaId: string | null;
  localPhotoId?: string | null;
  onApplied: () => void | Promise<void>;
  onClose: () => void;
  onPreviewChange: (preview: PhotoEditorPreviewState) => void;
}>) {
  const [context, setContext] = useState<MediaEditContextView | null>(null);
  const [source, setSource] = useState<Blob | null>(null);
  const [sourceOrigin, setSourceOrigin] = useState<MediaEditSourceOrigin | null>(null);
  const [recipe, setRecipe] = useState<PhotoEditRecipe>(defaultPhotoEditRecipe);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [stage, setStage] = useState<EditorStage>("loading");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [aiPreviewSource, setAiPreviewSource] = useState<Blob | null>(null);
  const [aiPreviewLoading, setAiPreviewLoading] = useState(false);
  const [aiPreviewProgress, setAiPreviewProgress] = useState<PhotoEditAiProgress | null>(null);
  const [ownedPendingRevisionId, setOwnedPendingRevisionId] = useState<string | null>(null);
  const [localSourceFingerprint, setLocalSourceFingerprint] = useState<string | null>(null);
  const persistedRecipeKey = useRef<string | null>(null);
  const previewSequence = useRef(0);
  const aiPreviewSequence = useRef(0);
  const applyController = useRef<AbortController | null>(null);
  const applyReservedRevisionId = useRef<string | null>(null);

  const busy = stage === "loading" || stage === "analyzing" || stage === "applying";
  const pendingRevisionId = context?.state.pendingRevisionId ?? null;
  const pendingElsewhere =
    pendingRevisionId !== null && pendingRevisionId !== ownedPendingRevisionId;
  const aiAvailable = photoEditAiAvailable();
  const denoiseStrength = recipe.denoiseStrength;
  const deblurStrength = recipe.deblurStrength;
  const aiEnabled = denoiseStrength > 0 || deblurStrength > 0;
  const aiPreExposure =
    denoiseStrength > 0 && recipe.exposureEv >= 0.75 ? Math.min(0.75, recipe.exposureEv * 0.5) : 0;
  const canApply =
    stage === "ready" &&
    source !== null &&
    !pendingElsewhere &&
    !aiPreviewLoading &&
    (context !== null || localPhotoId !== null);
  const draftBasedOnGeneration = context?.state.generation ?? null;
  const draftBasedOnRevisionId = context?.state.activeRevisionId ?? null;

  useEffect(() => {
    if (mediaId === null && localPhotoId === null) return;
    const controller = new AbortController();
    let disposed = false;

    setContext(null);
    setSource(null);
    setSourceOrigin(null);
    setRecipe(defaultPhotoEditRecipe);
    setOriginalUrl(null);
    setPreviewUrl(null);
    setStage("loading");
    setError(null);
    setProgress(0);
    setAiPreviewSource(null);
    setAiPreviewLoading(false);
    setAiPreviewProgress(null);
    setOwnedPendingRevisionId(null);
    setLocalSourceFingerprint(null);
    persistedRecipeKey.current = null;

    const load = async () => {
      if (localPhotoId !== null) {
        const photo = await getLocalReviewPhoto(localPhotoId);
        if (photo === null) throw new Error("本地照片已不存在");
        const draft = await getLocalPhotoEditDraft(localPhotoId);
        const nextContext =
          photo.mediaId === null
            ? null
            : await getMediaEditContext(photo.mediaId, controller.signal);
        const remoteRecipe =
          nextContext?.activeRevision === null || nextContext?.activeRevision === undefined
            ? defaultPhotoEditRecipe
            : photoEditRecipeFromUnknown(nextContext.activeRevision.recipeJson);
        const draftOwnsCurrentRemoteState =
          draft !== null &&
          (photo.mediaId === null ||
            draft.editState !== "synced" ||
            draft.remoteRevisionId === nextContext?.state.activeRevisionId);
        const sourceFingerprint = photoEditSourceFingerprint({
          bytes: photo.totalBytes,
          width: photo.width,
          height: photo.height,
          contentType: photo.originalContentType,
        });
        return {
          context: nextContext,
          blob: photo.originalBlob,
          sourceOrigin: "local-original" as const,
          ownedPendingRevisionId: draft?.remoteRevisionId ?? null,
          localSourceFingerprint: sourceFingerprint,
          recipe: draftOwnsCurrentRemoteState ? draft.recipe : remoteRecipe,
        };
      }

      if (mediaId === null) throw new Error("缺少媒体标识");
      const [nextContext, resolved] = await Promise.all([
        getMediaEditContext(mediaId, controller.signal),
        resolveMediaEditSource(mediaId),
      ]);
      return {
        context: nextContext,
        blob: resolved.blob,
        sourceOrigin: resolved.sourceOrigin,
        ownedPendingRevisionId: null,
        localSourceFingerprint: null,
        recipe:
          nextContext.activeRevision === null
            ? defaultPhotoEditRecipe
            : photoEditRecipeFromUnknown(nextContext.activeRevision.recipeJson),
      };
    };

    void load()
      .then((loaded) => {
        if (disposed) return;
        const url = URL.createObjectURL(loaded.blob);
        setContext(loaded.context);
        setSource(loaded.blob);
        setSourceOrigin(loaded.sourceOrigin);
        persistedRecipeKey.current = JSON.stringify(loaded.recipe);
        setRecipe(loaded.recipe);
        setOwnedPendingRevisionId(loaded.ownedPendingRevisionId);
        setLocalSourceFingerprint(loaded.localSourceFingerprint);
        setOriginalUrl(url);
        setStage("ready");
      })
      .catch((cause) => {
        if (disposed || controller.signal.aborted) return;
        setError(userFacingErrorMessage(cause, "无法准备修图源。"));
        setStage("error");
      });

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [localPhotoId, mediaId]);

  useEffect(() => {
    if (localPhotoId === null || localSourceFingerprint === null || stage !== "ready") {
      return;
    }
    const recipeKey = JSON.stringify(recipe);
    if (recipeKey === persistedRecipeKey.current) return;
    const timer = window.setTimeout(() => {
      void getLocalReviewPhoto(localPhotoId)
        .then((photo) => {
          if (photo === null) return;
          return putLocalPhotoEditDraft({
            localPhotoId,
            mediaId: photo.mediaId,
            recipe,
            sourceFingerprint: localSourceFingerprint,
            basedOnGeneration: draftBasedOnGeneration,
            basedOnRevisionId: draftBasedOnRevisionId,
            editState: "draft",
          });
        })
        .then(() => {
          persistedRecipeKey.current = recipeKey;
        })
        .catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    draftBasedOnGeneration,
    draftBasedOnRevisionId,
    localPhotoId,
    localSourceFingerprint,
    recipe,
    stage,
  ]);

  useEffect(() => {
    if (source === null) return;
    if (!aiEnabled) {
      setAiPreviewSource(null);
      setAiPreviewLoading(false);
      setAiPreviewProgress(null);
      return;
    }
    if (!aiAvailable) {
      setAiPreviewSource(null);
      setAiPreviewLoading(false);
      setAiPreviewProgress(null);
      return;
    }

    const sequence = aiPreviewSequence.current + 1;
    aiPreviewSequence.current = sequence;
    const controller = new AbortController();
    setAiPreviewSource(null);
    setAiPreviewLoading(true);
    setAiPreviewProgress({
      phase: "downloading-model",
      progress: 0,
    });

    const run = async () => {
      let aiInput = source;
      if (aiPreExposure > 0) {
        aiInput = await renderMediaEditPreview(
          source,
          normalizePhotoEditRecipe({
            ...defaultPhotoEditRecipe,
            exposureEv: aiPreExposure,
          }),
          { signal: controller.signal },
        );
      }
      const aiRecipe = normalizePhotoEditRecipe({
        ...defaultPhotoEditRecipe,
        denoiseStrength,
        deblurStrength,
      });
      return restoreMediaEditPreview(aiInput, aiRecipe, {
        signal: controller.signal,
        onProgress: (nextProgress) => setAiPreviewProgress(nextProgress),
      });
    };

    void run()
      .then((blob) => {
        if (controller.signal.aborted || aiPreviewSequence.current !== sequence) return;
        setAiPreviewSource(blob);
        setAiPreviewProgress(null);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(userFacingErrorMessage(cause, "本地 AI 预览失败。"));
        setAiPreviewProgress(null);
      })
      .finally(() => {
        if (!controller.signal.aborted && aiPreviewSequence.current === sequence) {
          setAiPreviewLoading(false);
        }
      });

    return () => controller.abort();
  }, [aiAvailable, aiEnabled, aiPreExposure, deblurStrength, denoiseStrength, source]);

  useEffect(() => {
    if (source === null || stage === "loading" || stage === "error") return;
    if (aiEnabled && aiPreviewSource === null) return;

    const previewSource = aiPreviewSource ?? source;
    const previewRecipe = normalizePhotoEditRecipe({
      ...recipe,
      exposureEv: recipe.exposureEv - aiPreExposure,
      denoiseStrength: 0,
      deblurStrength: 0,
    });
    const sequence = previewSequence.current + 1;
    previewSequence.current = sequence;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void renderMediaEditPreview(previewSource, previewRecipe, { signal: controller.signal })
        .then((blob) => {
          if (controller.signal.aborted || previewSequence.current !== sequence) return;
          const url = URL.createObjectURL(blob);
          setPreviewUrl((current) => {
            if (current !== null) URL.revokeObjectURL(current);
            return url;
          });
        })
        .catch((cause) => {
          if (controller.signal.aborted) return;
          setError(userFacingErrorMessage(cause, "预览处理失败。"));
        });
    }, 120);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [aiEnabled, aiPreExposure, aiPreviewSource, recipe, source, stage]);

  useEffect(
    () => () => {
      if (originalUrl !== null) URL.revokeObjectURL(originalUrl);
    },
    [originalUrl],
  );

  useEffect(
    () => () => {
      if (previewUrl !== null) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  useEffect(() => {
    onPreviewChange({
      beforeUrl: originalUrl,
      afterUrl: previewUrl,
      loading: stage === "loading",
    });
  }, [onPreviewChange, originalUrl, previewUrl, stage]);

  const recipeChanged = useMemo(
    () =>
      JSON.stringify(recipe) !==
      JSON.stringify(
        context?.activeRevision === null || context?.activeRevision === undefined
          ? defaultPhotoEditRecipe
          : photoEditRecipeFromUnknown(context.activeRevision.recipeJson),
      ),
    [context, recipe],
  );

  function patchRecipe(change: Partial<Omit<PhotoEditRecipe, "version">>): void {
    setRecipe((current) => normalizePhotoEditRecipe({ ...current, ...change }));
  }

  async function smartOptimize(): Promise<void> {
    if (source === null || busy) return;
    setStage("analyzing");
    setError(null);
    try {
      const analysis = await analyzeMediaEditSource(source);
      const automatic = automaticPhotoEditRecipe(analysis);
      setRecipe((current) =>
        normalizePhotoEditRecipe({
          ...automatic,
          denoiseStrength: current.denoiseStrength,
          deblurStrength: current.deblurStrength,
        }),
      );
      setStage("ready");
    } catch (cause) {
      setError(userFacingErrorMessage(cause, "智能优化分析失败。"));
      setStage("ready");
    }
  }

  async function switchRevision(targetRevisionId: string | null): Promise<void> {
    if (
      context === null ||
      busy ||
      context.state.pendingRevisionId !== null ||
      context.state.activeRevisionId === targetRevisionId
    ) {
      return;
    }
    setStage("applying");
    setError(null);
    setProgress(15);
    try {
      const switched = await switchMediaEditRevision({
        mediaId: context.mediaId,
        expectedGeneration: context.state.generation,
        expectedActiveRevisionId: context.state.activeRevisionId,
        targetRevisionId,
      });
      const switchedRecipe =
        switched.activeRevision === null
          ? defaultPhotoEditRecipe
          : photoEditRecipeFromUnknown(switched.activeRevision.recipeJson);
      persistedRecipeKey.current = JSON.stringify(switchedRecipe);
      setContext(switched);
      setRecipe(switchedRecipe);
      setProgress(100);
      toast.add({
        title: targetRevisionId === null ? "已恢复原始版本" : "已切换修图版本",
        type: "success",
      });
      await onApplied();
      setStage("ready");
    } catch (cause) {
      setError(userFacingErrorMessage(cause, "切换照片版本失败。"));
      setStage("ready");
    }
  }

  async function cancelPendingEdit(): Promise<void> {
    if (context === null || context.state.pendingRevisionId === null || busy) return;
    setStage("applying");
    setError(null);
    try {
      const cancelled = await cancelPendingMediaEditRevision({
        mediaId: context.mediaId,
        revisionId: context.state.pendingRevisionId,
      });
      setContext(cancelled);
      setOwnedPendingRevisionId(null);
      if (localPhotoId !== null) {
        await patchLocalPhotoEditDraft(localPhotoId, {
          editState: "draft",
          remoteRevisionId: null,
          error: null,
        });
      }
      toast.add({ title: "已取消待处理修图", type: "success" });
      await onApplied();
    } catch (cause) {
      setError(userFacingErrorMessage(cause, "取消待处理修图失败。"));
    } finally {
      setStage("ready");
    }
  }

  async function apply(): Promise<void> {
    if (!canApply || source === null) return;
    const controller = new AbortController();
    applyController.current = controller;
    setStage("applying");
    setError(null);
    setProgress(0);
    try {
      if (localPhotoId !== null) {
        const photo = await getLocalReviewPhoto(localPhotoId);
        if (photo === null) throw new Error("本地照片已不存在");
        await putAppliedLocalPhotoEditDraft({
          localPhotoId,
          mediaId: photo.mediaId,
          recipe,
          basedOnGeneration: context?.state.generation ?? 0,
          basedOnRevisionId: context?.state.activeRevisionId ?? null,
          sourceFingerprint: photoEditSourceFingerprint({
            bytes: photo.totalBytes,
            width: photo.width,
            height: photo.height,
            contentType: photo.originalContentType,
          }),
        });
        setProgress(photo.mediaId === null ? 100 : 5);

        if (photo.mediaId === null) {
          toast.add({
            title: "修图已应用到本机",
            description: "远端媒体建立后会自动同步此修图版本，基础原图上传不受影响。",
            type: "success",
          });
          await onApplied();
          return;
        }

        await syncLocalPhotoEditDraft(localPhotoId, controller.signal);
        const draft = await getLocalPhotoEditDraft(localPhotoId);
        if (draft?.editState === "failed") {
          throw new Error(draft.error ?? "修图版本同步失败");
        }
        const applied = await getMediaEditContext(photo.mediaId, controller.signal);
        setContext(applied);
        setProgress(100);
        toast.add({ title: "修图版本已同步并应用", type: "success" });
        await onApplied();
        return;
      }

      if (mediaId === null || context === null) return;
      let applyContext = context;
      if (
        ownedPendingRevisionId !== null &&
        context.state.pendingRevisionId === ownedPendingRevisionId
      ) {
        applyContext = await cancelPendingMediaEditRevision({
          mediaId,
          revisionId: ownedPendingRevisionId,
          signal: controller.signal,
        });
        setContext(applyContext);
        setOwnedPendingRevisionId(null);
      }

      applyReservedRevisionId.current = null;
      const preservePendingOnFailure = applyContext.publicationStatus !== "published";
      const applied = await applyMediaEditRecipe({
        mediaId,
        recipe,
        source,
        basedOnGeneration: applyContext.state.generation,
        basedOnRevisionId: applyContext.state.activeRevisionId,
        signal: controller.signal,
        preservePendingOnFailure,
        onReserved: (revisionId) => {
          applyReservedRevisionId.current = revisionId;
          setOwnedPendingRevisionId(revisionId);
        },
        onProgress: (value) => setProgress(Math.round(value * 100)),
      });
      setOwnedPendingRevisionId(null);
      setContext(applied);
      setProgress(100);
      toast.add({ title: "修图版本已应用", type: "success" });
      await onApplied();
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") {
        setOwnedPendingRevisionId(null);
        toast.add({ title: "已取消修图处理", type: "info" });
      } else {
        if (localPhotoId === null && mediaId !== null && applyReservedRevisionId.current !== null) {
          const latest = await getMediaEditContext(mediaId).catch(() => null);
          if (latest !== null) setContext(latest);
        }
        setError(userFacingErrorMessage(cause, "应用修图失败。"));
      }
      setStage("ready");
    } finally {
      applyReservedRevisionId.current = null;
      if (applyController.current === controller) applyController.current = null;
    }
  }

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-2xl">
      <div className="flex items-start gap-3 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">修图</h2>
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
            本机处理 · 图片不会发送至 AI 服务 · {sourceLabel(sourceOrigin)}
          </p>
        </div>
        <Button
          aria-label="退出修图"
          disabled={busy}
          onClick={onClose}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <XIcon />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="flex flex-col gap-5">
          {context?.state.pendingRevisionId !== null &&
          context?.state.pendingRevisionId !== undefined ? (
            <div className="flex flex-col gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-5">
              <p>
                {context.state.pendingStatus === "failed"
                  ? "待处理修图已失败。当前照片仍保留发布门禁；重试或显式取消前不会退回基础版本公开。"
                  : pendingElsewhere
                    ? "另一项修图版本正在处理中。完成或取消前不能应用新的版本。"
                    : "当前修图版本仍待完成；再次应用会重试此修图。"}
              </p>
              <Button
                disabled={busy}
                onClick={() => void cancelPendingEdit()}
                size="sm"
                type="button"
                variant="outline"
              >
                取消待处理修图
              </Button>
            </div>
          ) : null}

          {context !== null && context.history.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold text-muted-foreground">版本</h3>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  disabled={busy || context.state.pendingRevisionId !== null}
                  onClick={() => void switchRevision(null)}
                  size="sm"
                  type="button"
                  variant={context.state.activeRevisionId === null ? "default" : "outline"}
                >
                  原始版本
                </Button>
                {context.history.map((revision, index) => (
                  <Button
                    disabled={busy || context.state.pendingRevisionId !== null}
                    key={revision.id}
                    onClick={() => void switchRevision(revision.id)}
                    size="sm"
                    type="button"
                    variant={context.state.activeRevisionId === revision.id ? "default" : "outline"}
                  >
                    {context.state.activeRevisionId === revision.id
                      ? "当前修图"
                      : `版本 ${context.history.length - index}`}
                    <span className="ml-1 text-[10px] opacity-70">
                      {revisionTime(revision.createdAt)}
                    </span>
                  </Button>
                ))}
              </div>
            </section>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <Button
              disabled={busy || source === null}
              onClick={() => void smartOptimize()}
              type="button"
            >
              <SparklesIcon data-icon="inline-start" />
              智能优化
            </Button>
            <Button
              disabled={busy}
              onClick={() => setRecipe(defaultPhotoEditRecipe)}
              type="button"
              variant="outline"
            >
              <RotateCcwIcon data-icon="inline-start" />
              重置
            </Button>
          </div>

          <div className="flex flex-col gap-3">
            <RangeControl
              disabled={busy}
              format={(value) => `${value >= 0 ? "+" : ""}${value.toFixed(2)} EV`}
              label="曝光"
              maximum={2}
              minimum={-2}
              onChange={(value) => patchRecipe({ exposureEv: value })}
              step={0.05}
              value={recipe.exposureEv}
            />
            <RangeControl
              disabled={busy}
              label="色温"
              maximum={1}
              minimum={-1}
              onChange={(value) => patchRecipe({ temperature: value })}
              step={0.02}
              value={recipe.temperature}
            />
            <RangeControl
              disabled={busy}
              label="色调"
              maximum={1}
              minimum={-1}
              onChange={(value) => patchRecipe({ tint: value })}
              step={0.02}
              value={recipe.tint}
            />
            <RangeControl
              disabled={busy}
              label="高光"
              maximum={100}
              minimum={-100}
              onChange={(value) => patchRecipe({ highlights: value })}
              step={1}
              value={recipe.highlights}
            />
            <RangeControl
              disabled={busy}
              label="阴影"
              maximum={100}
              minimum={-100}
              onChange={(value) => patchRecipe({ shadows: value })}
              step={1}
              value={recipe.shadows}
            />
            <RangeControl
              disabled={busy}
              label="对比度"
              maximum={100}
              minimum={-100}
              onChange={(value) => patchRecipe({ contrast: value })}
              step={1}
              value={recipe.contrast}
            />
            <RangeControl
              disabled={busy}
              label="自然饱和度"
              maximum={100}
              minimum={-100}
              onChange={(value) => patchRecipe({ vibrance: value })}
              step={1}
              value={recipe.vibrance}
            />
            <RangeControl
              disabled={busy}
              label="饱和度"
              maximum={100}
              minimum={-100}
              onChange={(value) => patchRecipe({ saturation: value })}
              step={1}
              value={recipe.saturation}
            />
            <RangeControl
              disabled={busy}
              label="锐化"
              maximum={100}
              minimum={0}
              onChange={(value) => patchRecipe({ sharpen: value })}
              step={1}
              value={recipe.sharpen}
            />
          </div>

          <section className="flex flex-col gap-3 border-t pt-4">
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground">AI 修复</h3>
              <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                WebGPU 本机推理，不上传至 AI 服务。模型首次使用时从本站加载并长期缓存。
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                disabled={busy || !aiAvailable}
                onClick={() =>
                  patchRecipe({
                    denoiseStrength: recipe.denoiseStrength > 0 ? 0 : 0.55,
                  })
                }
                type="button"
                variant={recipe.denoiseStrength > 0 ? "default" : "outline"}
              >
                AI 降噪
              </Button>
              <Button
                disabled={busy || !aiAvailable}
                onClick={() =>
                  patchRecipe({
                    deblurStrength: recipe.deblurStrength > 0 ? 0 : 0.28,
                  })
                }
                type="button"
                variant={recipe.deblurStrength > 0 ? "default" : "outline"}
              >
                AI 清晰化
              </Button>
            </div>
            {!aiAvailable ? (
              <p className="text-[11px] leading-4 text-muted-foreground">
                当前浏览器或设备未提供 WebGPU，确定性调色仍可正常使用。
              </p>
            ) : null}
            {recipe.denoiseStrength > 0 ? (
              <RangeControl
                disabled={busy}
                format={(value) => `${Math.round(value * 100)}%`}
                label="降噪强度"
                maximum={1}
                minimum={0}
                onChange={(value) => patchRecipe({ denoiseStrength: value })}
                step={0.05}
                value={recipe.denoiseStrength}
              />
            ) : null}
            {recipe.deblurStrength > 0 ? (
              <RangeControl
                disabled={busy}
                format={(value) => `${Math.round(value * 100)}%`}
                label="清晰强度"
                maximum={0.6}
                minimum={0}
                onChange={(value) => patchRecipe({ deblurStrength: value })}
                step={0.04}
                value={recipe.deblurStrength}
              />
            ) : null}
            {aiPreviewLoading && aiPreviewProgress !== null ? (
              aiPreviewProgress.phase === "downloading-model" ? (
                <Progress value={Math.round(aiPreviewProgress.progress * 100)}>
                  <ProgressLabel>
                    正在下载{aiOperationLabel(aiPreviewProgress.operation)}模型
                  </ProgressLabel>
                  <span className="ml-auto text-sm tabular-nums text-muted-foreground">
                    {aiPreviewProgress.loadedBytes !== undefined &&
                    aiPreviewProgress.totalBytes !== undefined
                      ? `${formatModelBytes(aiPreviewProgress.loadedBytes)} / ${formatModelBytes(aiPreviewProgress.totalBytes)}`
                      : `${Math.round(aiPreviewProgress.progress * 100)}%`}
                  </span>
                </Progress>
              ) : (
                <p className="text-[11px] leading-4 text-muted-foreground">
                  {aiPreviewProgress.phase === "initializing-model"
                    ? `正在初始化${aiOperationLabel(aiPreviewProgress.operation)}模型…`
                    : "正在生成 AI 预览…"}
                </p>
              )
            ) : null}
          </section>

          {error !== null ? (
            <div className="rounded-lg border border-destructive/25 bg-destructive/10 p-3 text-xs text-destructive">
              {error}
            </div>
          ) : null}

          {stage === "applying" ? (
            <Progress value={progress}>
              <ProgressLabel>正在生成并同步修图版本</ProgressLabel>
              <ProgressValue />
            </Progress>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t px-4 py-3">
        {context?.state.activeRevisionId !== null &&
        context?.state.activeRevisionId !== undefined ? (
          <Button
            disabled={busy || context.state.pendingRevisionId !== null}
            onClick={() => void switchRevision(null)}
            type="button"
            variant="outline"
          >
            恢复原图
          </Button>
        ) : null}
        {stage === "applying" ? (
          <Button onClick={() => applyController.current?.abort()} type="button" variant="outline">
            取消处理
          </Button>
        ) : (
          <Button disabled={busy} onClick={onClose} type="button" variant="outline">
            退出修图
          </Button>
        )}
        <Button disabled={!canApply || !recipeChanged} onClick={() => void apply()} type="button">
          {ownedPendingRevisionId !== null && pendingRevisionId === ownedPendingRevisionId
            ? "重试修图"
            : "应用修图"}
        </Button>
      </div>
    </aside>
  );
}
