"use client";

import type { BibMediaState, BibTagView } from "@photostream/contracts";
import { normalizeBibNumber } from "@photostream/contracts";
import {
  BadgeCheckIcon,
  CheckIcon,
  HashIcon,
  LoaderCircleIcon,
  ScanTextIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { clientGet, clientMutation } from "@/lib/client-api";
import { cn } from "@/lib/utils";

export function isBibReviewConfirmed(state: BibMediaState | null | undefined): boolean {
  return (
    state?.review.decision === "numbers_confirmed" ||
    state?.review.decision === "no_number_confirmed"
  );
}

function tagPriority(tag: BibTagView): number {
  if (tag.status === "confirmed") return 0;
  if (tag.status === "needs_review") return 1;
  if (tag.status === "suggested") return 2;
  return 3;
}

function ocrLabel(state: BibMediaState): string {
  if (state.review.ocrStatus === "processing") return "号码识别中";
  if (state.review.ocrStatus === "completed") return "识别已完成";
  if (state.review.ocrStatus === "failed") return "号码识别失败";
  if (state.review.ocrStatus === "unsupported") return "当前图片无法自动识别";
  return "尚无自动识别结果";
}

function tagStatusLabel(tag: BibTagView): string {
  if (tag.status === "confirmed") return "已确认";
  if (tag.status === "needs_review") return "需复核";
  return "识别候选";
}

function tagStatusVariant(tag: BibTagView): "default" | "outline" | "secondary" {
  if (tag.status === "confirmed") return "default";
  if (tag.status === "needs_review") return "secondary";
  return "outline";
}

interface BibReviewEditorProps {
  readonly mediaId: string | null;
  readonly state: BibMediaState | null;
  readonly onChange: (state: BibMediaState) => void;
  readonly onError: (message: string) => void;
  readonly tone?: "default" | "dark";
  readonly compact?: boolean;
}

export function BibReviewEditor({
  mediaId,
  state,
  onChange,
  onError,
  tone = "default",
  compact = false,
}: BibReviewEditorProps) {
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [number, setNumber] = useState("");
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const activeTags = useMemo(
    () =>
      (state?.tags ?? [])
        .filter((tag) => tag.status !== "rejected")
        .toSorted(
          (left, right) =>
            tagPriority(left) - tagPriority(right) ||
            (right.confidence ?? -1) - (left.confidence ?? -1) ||
            left.number.localeCompare(right.number),
        ),
    [state],
  );

  useEffect(() => {
    if (state?.review.decision === "no_number_confirmed") {
      setSelectedTagId(null);
      setNumber("");
      return;
    }
    const current = activeTags.find((tag) => tag.id === selectedTagId);
    const preferred = current ?? activeTags[0];
    setSelectedTagId(preferred?.id ?? null);
    setNumber(preferred?.number ?? "");
  }, [activeTags, selectedTagId, state?.review.decision]);

  useEffect(() => {
    if (mediaId === null || state !== null) return;
    let active = true;
    setLoading(true);
    void clientGet<BibMediaState>(`/api/v1/media/${mediaId}/bib`)
      .then((result) => {
        if (active) onChange(result);
      })
      .catch((cause) => {
        if (active) onError(cause instanceof Error ? cause.message : "号码状态加载失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mediaId, onChange, onError, state]);

  async function confirmNumber(): Promise<void> {
    if (mediaId === null || busy) return;
    const normalized = normalizeBibNumber(number);
    if (normalized === null) {
      setValidationError("请输入 1–12 位数字号码");
      return;
    }
    setBusy(true);
    setValidationError(null);
    try {
      let current = state;
      if (current?.review.decision === "no_number_confirmed") {
        current = await clientMutation<BibMediaState>(`/api/v1/media/${mediaId}/bib-review/reset`, {
          idempotencyKey: `bib-review-reset-${crypto.randomUUID()}`,
        });
        onChange(current);
      }
      const selected = current?.tags.find(
        (tag) => tag.id === selectedTagId && tag.status !== "rejected",
      );
      const result =
        selected === undefined
          ? await clientMutation<BibMediaState>(`/api/v1/media/${mediaId}/bib-tags`, {
              body: { number: normalized },
              idempotencyKey: `bib-manual-${crypto.randomUUID()}`,
            })
          : await clientMutation<BibMediaState>(
              `/api/v1/media/${mediaId}/bib-tags/${selected.id}/confirm`,
              {
                body: selected.number === normalized ? {} : { number: normalized },
                idempotencyKey: `bib-confirm-${crypto.randomUUID()}`,
              },
            );
      onChange(result);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "号码确认失败");
    } finally {
      setBusy(false);
    }
  }

  async function confirmNoNumber(): Promise<void> {
    if (mediaId === null || busy) return;
    setBusy(true);
    setValidationError(null);
    try {
      const result = await clientMutation<BibMediaState>(
        `/api/v1/media/${mediaId}/bib-review/no-number`,
        { idempotencyKey: `bib-no-number-${crypto.randomUUID()}` },
      );
      onChange(result);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "无号码确认失败");
    } finally {
      setBusy(false);
    }
  }

  const dark = tone === "dark";
  const confirmed = isBibReviewConfirmed(state);
  const noNumber = state?.review.decision === "no_number_confirmed";

  if (mediaId === null) {
    return (
      <div
        className={cn(
          "rounded-lg border px-3 py-3 text-sm",
          dark ? "border-white/10 bg-black/35 text-white/75" : "bg-muted/30 text-muted-foreground",
        )}
      >
        <div className="flex items-center gap-2 font-medium">
          <HashIcon className="size-4" />
          等待照片上传
        </div>
        <p className={cn("mt-1 text-xs", dark ? "text-white/55" : "text-muted-foreground")}>
          照片发布到服务器后即可读取识别结果并确认号码。
        </p>
      </div>
    );
  }

  if (state === null || loading) {
    return (
      <div
        className={cn(
          "flex min-h-24 items-center justify-center gap-2 rounded-lg border text-sm",
          dark ? "border-white/10 bg-black/35 text-white/65" : "bg-muted/20 text-muted-foreground",
        )}
      >
        <LoaderCircleIcon className="size-4 animate-spin" />
        加载号码状态…
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col", compact ? "gap-2.5" : "gap-3.5")}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          className={cn(
            dark && "border-white/15 bg-white/10 text-white",
            confirmed && !dark && "border-emerald-200 bg-emerald-50 text-emerald-700",
            !confirmed && !dark && "border-violet-200 bg-violet-50 text-violet-700",
          )}
          variant="outline"
        >
          {confirmed ? <BadgeCheckIcon data-icon="inline-start" /> : <ScanTextIcon data-icon="inline-start" />}
          {noNumber ? "已确认无号码" : confirmed ? "号码已确认" : "待确认号码"}
        </Badge>
        <span className={cn("text-xs", dark ? "text-white/55" : "text-muted-foreground")}>
          {ocrLabel(state)}
        </span>
      </div>

      <div>
        <p className={cn("mb-1.5 text-xs font-medium", dark && "text-white/75")}>识别结果</p>
        {activeTags.length === 0 ? (
          <div
            className={cn(
              "rounded-lg border border-dashed px-3 py-2.5 text-xs",
              dark ? "border-white/10 text-white/50" : "text-muted-foreground",
            )}
          >
            {noNumber ? "已人工确认此照片没有号码" : "暂未识别到可用号码，可直接手动输入。"}
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {activeTags.map((tag) => {
              const selected = tag.id === selectedTagId;
              return (
                <button
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors",
                    dark
                      ? selected
                        ? "border-violet-400/60 bg-violet-500/20 text-white"
                        : "border-white/10 bg-white/[0.05] text-white/75 hover:bg-white/10"
                      : selected
                        ? "border-violet-300 bg-violet-50 text-violet-800"
                        : "hover:bg-muted/50",
                  )}
                  key={tag.id}
                  onClick={() => {
                    setSelectedTagId(tag.id);
                    setNumber(tag.number);
                    setValidationError(null);
                  }}
                  type="button"
                >
                  <span className="font-mono font-semibold">{tag.number}</span>
                  {tag.confidence === null ? null : (
                    <span className={cn(dark ? "text-white/45" : "text-muted-foreground")}>
                      {Math.round(tag.confidence * 100)}%
                    </span>
                  )}
                  <Badge
                    className={cn("h-4 px-1 text-[10px]", dark && "border-white/10 bg-white/10 text-white")}
                    variant={tagStatusVariant(tag)}
                  >
                    {tagStatusLabel(tag)}
                  </Badge>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void confirmNumber();
        }}
      >
        <div className="flex gap-2">
          <Input
            aria-label="确认号码"
            className={cn(
              "h-9 min-w-0 flex-1 font-mono",
              dark &&
                "border-white/15 bg-white/[0.07] text-white placeholder:text-white/35 focus-visible:border-violet-400",
            )}
            disabled={busy}
            inputMode="numeric"
            maxLength={12}
            onChange={(event) => {
              setNumber(event.currentTarget.value);
              setValidationError(null);
            }}
            placeholder={noNumber ? "输入号码以修改确认结果" : "输入或修正号码"}
            value={number}
          />
          <Button
            className={cn(
              "shrink-0",
              dark && "border-emerald-400/25 bg-emerald-500/25 text-emerald-50 hover:bg-emerald-500/35",
            )}
            disabled={busy || number.trim().length === 0}
            size="sm"
            type="submit"
            variant={dark ? "outline" : "default"}
          >
            {busy ? (
              <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
            ) : (
              <CheckIcon data-icon="inline-start" />
            )}
            确认
          </Button>
        </div>
        {validationError === null ? null : (
          <p className={cn("text-xs", dark ? "text-red-300" : "text-destructive")}>
            {validationError}
          </p>
        )}
      </form>

      <div className="flex items-center justify-between gap-2">
        <p className={cn("text-[11px]", dark ? "text-white/45" : "text-muted-foreground")}>
          可直接修改识别结果；确认后号码将用于访客搜索。
        </p>
        <Button
          className={cn(
            "shrink-0",
            dark && "border-white/15 bg-white/[0.05] text-white/75 hover:bg-white/10 hover:text-white",
          )}
          disabled={busy || noNumber}
          onClick={() => void confirmNoNumber()}
          size="sm"
          type="button"
          variant="outline"
        >
          设为无号码
        </Button>
      </div>
    </div>
  );
}

export function BibReviewDialog({
  open,
  onOpenChange,
  mediaId,
  state,
  onChange,
  onError,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mediaId: string | null;
  state: BibMediaState | null;
  onChange: (state: BibMediaState) => void;
  onError: (message: string) => void;
}>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>号码确认</DialogTitle>
          <DialogDescription>核对自动识别结果，也可以直接修正号码或确认此照片没有号码。</DialogDescription>
        </DialogHeader>
        <BibReviewEditor
          mediaId={mediaId}
          onChange={onChange}
          onError={onError}
          state={state}
        />
      </DialogContent>
    </Dialog>
  );
}
