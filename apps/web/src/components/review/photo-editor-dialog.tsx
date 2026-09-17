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
import { automaticPhotoEditRecipe } from "@/lib/photo-edit/analysis";
import {
  defaultPhotoEditRecipe,
  normalizePhotoEditRecipe,
  type PhotoEditRecipe,
  photoEditRecipeFromUnknown,
} from "@/lib/photo-edit/recipe";
import { applyMediaEditRecipe, getMediaEditContext } from "@/lib/photo-edit/revision-client";
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

function sourceLabel(origin: MediaEditSourceOrigin | null): string {
  if (origin === "local-original") return "本机原图";
  if (origin === "remote-original") return "远端原图";
  return "正在解析";
}

export function PhotoEditorDialog({
  mediaId,
  open,
  onOpenChange,
  onApplied,
}: Readonly<{
  mediaId: string | null;
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
  const previewSequence = useRef(0);

  const busy = stage === "loading" || stage === "analyzing" || stage === "applying";
  const pendingElsewhere = context?.state.pendingRevisionId !== null;
  const canApply = stage === "ready" && context !== null && source !== null && !pendingElsewhere;

  useEffect(() => {
    if (!open || mediaId === null) return;
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

    void Promise.all([
      getMediaEditContext(mediaId, controller.signal),
      resolveMediaEditSource(mediaId),
    ])
      .then(([nextContext, resolved]) => {
        if (disposed) return;
        const nextRecipe =
          nextContext.activeRevision === null
            ? defaultPhotoEditRecipe
            : photoEditRecipeFromUnknown(nextContext.activeRevision.recipeJson);
        const url = URL.createObjectURL(resolved.blob);
        setContext(nextContext);
        setSource(resolved.blob);
        setSourceOrigin(resolved.sourceOrigin);
        setRecipe(nextRecipe);
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
  }, [mediaId, open]);

  useEffect(() => {
    if (!open || source === null || stage === "loading" || stage === "error") return;
    const sequence = previewSequence.current + 1;
    previewSequence.current = sequence;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void renderMediaEditPreview(source, recipe, { signal: controller.signal })
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
  }, [open, recipe, source, stage]);

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
      setRecipe(automaticPhotoEditRecipe(analysis));
      setStage("ready");
    } catch (cause) {
      setError(userFacingErrorMessage(cause, "智能优化分析失败。"));
      setStage("ready");
    }
  }

  async function apply(): Promise<void> {
    if (!canApply || mediaId === null || context === null || source === null) return;
    setStage("applying");
    setError(null);
    setProgress(0);
    try {
      const applied = await applyMediaEditRecipe({
        mediaId,
        recipe,
        source,
        basedOnGeneration: context.state.generation,
        basedOnRevisionId: context.state.activeRevisionId,
        onProgress: (value) => setProgress(Math.round(value * 100)),
      });
      setContext(applied);
      setProgress(100);
      toast.add({ title: "修图版本已应用", type: "success" });
      await onApplied();
      onOpenChange(false);
    } catch (cause) {
      setError(userFacingErrorMessage(cause, "应用修图失败。"));
      setStage("ready");
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
                  <ProgressValue>{progress}%</ProgressValue>
                </Progress>
              ) : null}
            </div>
          </div>
        </div>

        <DialogFooter className="px-5 py-4">
          <Button
            disabled={busy}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            取消
          </Button>
          <Button disabled={!canApply || !recipeChanged} onClick={() => void apply()} type="button">
            应用修图
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
