"use client";

import type { MediaEditContextView } from "@photostream/contracts";
import { RotateCcwIcon, SparklesIcon } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { toast } from "@/components/ui/toast";
import { getLocalReviewPhoto } from "@/lib/local-review-queue";
import {
  type PhotoEditAiPhase,
  photoEditAiAvailable,
  restoreMediaEditPreview,
} from "@/lib/photo-edit/ai-runtime";
import { automaticPhotoEditRecipe } from "@/lib/photo-edit/analysis";
import { syncLocalPhotoEditDraft } from "@/lib/photo-edit/local-draft-sync";
import {
  getLocalPhotoEditDraft,
  photoEditSourceFingerprint,
  putAppliedLocalPhotoEditDraft,
} from "@/lib/photo-edit/local-drafts";
import {
  defaultPhotoEditRecipe,
  normalizePhotoEditRecipe,
  type PhotoEditRecipe,
  photoEditRecipeFromUnknown,
} from "@/lib/photo-edit/recipe";
import {
  applyMediaEditRecipe,
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
  }).format(date);
}

function sourceLabel(origin: MediaEditSourceOrigin | null): string {
  if (origin === "local-original") return "本机原图";
  if (origin === "remote-original") return "远端原图";
  return "正在解析";
}

export function PhotoEditorDialog({
  mediaId,
  localPhotoId = null,
  open,
  onOpenChange,
  onApplied,
}: Readonly<{
  mediaId: string | null;
  localPhotoId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied: () => void | Promise<void>;
}>) {
  const [context, setContext] = useState<MediaEditContextView | null>(null);
  const [source, setSource] = useState<Blob | null>(null);
  const [sourceOrigin, setSourceOrigin] = useState<MediaEditSourceOrigin | null>(null);
  const [recipe, setRecipe] = useState<PhotoEditRecipe>(defaultPhotoEditRecipe);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showBefore, setShowBefore] = useState(false);
  const [stage, setStage] = useState<EditorStage>("loading");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [aiPreviewSource, setAiPreviewSource] = useState<Blob | null>(null);
  const [aiPreviewLoading, setAiPreviewLoading] = useState(false);
  const [aiPreviewPhase, setAiPreviewPhase] = useState<PhotoEditAiPhase | null>(null);
  const previewSequence = useRef(0);
  const aiPreviewSequence = useRef(0);
  const applyController = useRef<AbortController | null>(null);

  const busy = stage === "loading" || stage === "analyzing" || stage === "applying";
  const pendingElsewhere = context?.state.pendingRevisionId != null;
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

  useEffect(() => {
    if (!open || (mediaId === null && localPhotoId === null)) return;
    const controller = new AbortController();
    let disposed = false;

    setContext(null);
    setSource(null);
    setSourceOrigin(null);
    setRecipe(defaultPhotoEditRecipe);
    setOriginalUrl(null);
    setPreviewUrl(null);
    setShowBefore(false);
    setStage("loading");
    setError(null);
    setProgress(0);
    setAiPreviewSource(null);
    setAiPreviewLoading(false);
    setAiPreviewPhase(null);

    const load = async () => {
      if (localPhotoId !== null) {
        const photo = await getLocalReviewPhoto(localPhotoId);
        if (photo === null) throw new Error("本地照片已不存在");
        const draft = await getLocalPhotoEditDraft(localPhotoId);
        const nextContext =
          photo.mediaId === null
            ? null
            : await getMediaEditContext(photo.mediaId, controller.signal);
        return {
          context: nextContext,
          blob: photo.originalBlob,
          sourceOrigin: "local-original" as const,
          recipe:
            draft?.recipe ??
            (nextContext?.activeRevision === null || nextContext?.activeRevision === undefined
              ? defaultPhotoEditRecipe
              : photoEditRecipeFromUnknown(nextContext.activeRevision.recipeJson)),
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
        setRecipe(loaded.recipe);
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
  }, [localPhotoId, mediaId, open]);

  useEffect(() => {
    if (!open || source === null) return;
    if (!aiEnabled) {
      setAiPreviewSource(null);
      setAiPreviewLoading(false);
      setAiPreviewPhase(null);
      return;
    }
    if (!aiAvailable) {
      setAiPreviewSource(null);
      setAiPreviewLoading(false);
      setAiPreviewPhase(null);
      return;
    }

    const sequence = aiPreviewSequence.current + 1;
    aiPreviewSequence.current = sequence;
    const controller = new AbortController();
    setAiPreviewSource(null);
    setAiPreviewLoading(true);
    setAiPreviewPhase("loading-model");

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
        onProgress: ({ phase }) => setAiPreviewPhase(phase),
      });
    };

    void run()
      .then((blob) => {
        if (controller.signal.aborted || aiPreviewSequence.current !== sequence) return;
        setAiPreviewSource(blob);
        setAiPreviewPhase(null);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(userFacingErrorMessage(cause, "本地 AI 预览失败。"));
        setAiPreviewPhase(null);
      })
      .finally(() => {
        if (!controller.signal.aborted && aiPreviewSequence.current === sequence) {
          setAiPreviewLoading(false);
        }
      });

    return () => controller.abort();
  }, [aiAvailable, aiEnabled, aiPreExposure, open, deblurStrength, denoiseStrength, source]);

  useEffect(() => {
    if (!open || source === null || stage === "loading" || stage === "error") return;
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
  }, [aiEnabled, aiPreExposure, aiPreviewSource, open, recipe, source, stage]);

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

  const activeUrl = showBefore ? originalUrl : (previewUrl ?? originalUrl);
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
      setContext(switched);
      setRecipe(
        switched.activeRevision === null
          ? defaultPhotoEditRecipe
          : photoEditRecipeFromUnknown(switched.activeRevision.recipeJson),
      );
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
          onOpenChange(false);
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
        onOpenChange(false);
        return;
      }

      if (mediaId === null || context === null) return;
      const applied = await applyMediaEditRecipe({
        mediaId,
        recipe,
        source,
        basedOnGeneration: context.state.generation,
        basedOnRevisionId: context.state.activeRevisionId,
        signal: controller.signal,
        onProgress: (value) => setProgress(Math.round(value * 100)),
      });
      setContext(applied);
      setProgress(100);
      toast.add({ title: "修图版本已应用", type: "success" });
      await onApplied();
      onOpenChange(false);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") {
        toast.add({ title: "已取消修图处理", type: "info" });
      } else {
        setError(userFacingErrorMessage(cause, "应用修图失败。"));
      }
      setStage("ready");
    } finally {
      if (applyController.current === controller) applyController.current = null;
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !busy && onOpenChange(nextOpen)}>
      <DialogContent className="flex max-h-[92dvh] w-[min(96vw,72rem)] max-w-none flex-col overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="border-b px-5 py-4 pr-12">
          <DialogTitle>照片处理</DialogTitle>
          <DialogDescription>
            本机处理 · 图片不会发送至 AI 服务 · {sourceLabel(sourceOrigin)}
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="relative flex min-h-[18rem] items-center justify-center overflow-hidden bg-black/95 p-3 md:min-h-[32rem]">
            {activeUrl !== null ? (
              <Image
                alt={showBefore ? "原始照片" : "修图预览"}
                className="object-contain"
                draggable={false}
                fill
                sizes="(max-width: 767px) 100vw, 70vw"
                src={activeUrl}
                unoptimized
              />
            ) : (
              <div className="text-sm text-white/60">正在准备照片…</div>
            )}
            {stage === "loading" ? (
              <div className="absolute inset-0 grid place-items-center bg-black/40 text-sm text-white">
                正在读取原图…
              </div>
            ) : null}
          </div>

          <div className="min-h-0 overflow-y-auto border-l bg-card p-4">
            <div className="flex flex-col gap-5">
              {context?.state.pendingRevisionId !== null &&
              context?.state.pendingRevisionId !== undefined ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-5">
                  另一项修图版本正在处理中。当前参数可以查看，但在该版本完成或取消前不能应用新的版本。
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
                        variant={
                          context.state.activeRevisionId === revision.id ? "default" : "outline"
                        }
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
                {aiPreviewLoading ? (
                  <p className="text-[11px] leading-4 text-muted-foreground">
                    {aiPreviewPhase === "loading-model"
                      ? "正在加载本地 AI 模型…"
                      : "正在生成 AI 预览…"}
                  </p>
                ) : null}
              </section>

              <Button
                disabled={stage === "loading" || originalUrl === null}
                onPointerDown={() => setShowBefore(true)}
                onPointerLeave={() => setShowBefore(false)}
                onPointerUp={() => setShowBefore(false)}
                type="button"
                variant="outline"
              >
                按住查看原始照片
              </Button>

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
        </div>

        <DialogFooter className="px-5 py-4">
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
            <Button
              onClick={() => applyController.current?.abort()}
              type="button"
              variant="outline"
            >
              取消处理
            </Button>
          ) : (
            <Button
              disabled={busy}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              取消
            </Button>
          )}
          <Button disabled={!canApply || !recipeChanged} onClick={() => void apply()} type="button">
            应用修图
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
