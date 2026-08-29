"use client";

import type { BibAttributeOptionInput, BibMediaState } from "@photostream/contracts";
import { CheckIcon, RotateCcwIcon, Trash2Icon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { clientMutation } from "@/lib/client-api";

const reviewLabels: Record<BibMediaState["review"]["decision"], string> = {
  pending: "待复核",
  numbers_confirmed: "有确认号码",
  no_number_confirmed: "确认无号码",
  needs_review: "需复核",
};

const ocrLabels: Record<BibMediaState["review"]["ocrStatus"], string> = {
  not_started: "等待 OCR",
  processing: "识别中",
  completed: "OCR 已完成",
  failed: "识别失败",
  unsupported: "设备不支持 OCR",
};

const tagLabels: Record<BibMediaState["tags"][number]["status"], string> = {
  suggested: "候选待确认",
  confirmed: "已确认",
  rejected: "已拒绝",
  needs_review: "规则变化需复核",
};

export function BibReviewControls({
  initial,
  mediaId,
  options,
  onChange,
}: Readonly<{
  initial: BibMediaState;
  mediaId: string;
  options: readonly BibAttributeOptionInput[];
  onChange: (state: BibMediaState) => void;
}>) {
  const [state, setState] = useState(initial);
  const [numbers, setNumbers] = useState<Record<string, string>>(() =>
    Object.fromEntries(initial.tags.map((tag) => [tag.id, tag.number])),
  );
  const [manualNumber, setManualNumber] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setState(initial);
    setNumbers(Object.fromEntries(initial.tags.map((tag) => [tag.id, tag.number])));
  }, [initial]);

  function accept(next: BibMediaState): void {
    setState(next);
    setNumbers(Object.fromEntries(next.tags.map((tag) => [tag.id, tag.number])));
    onChange(next);
  }

  async function mutate(
    path: string,
    settings: {
      readonly body?: unknown;
      readonly idempotency?: boolean;
      readonly method?: "POST" | "DELETE";
    } = {},
  ): Promise<boolean> {
    if (pending) return false;
    setPending(true);
    setError(null);
    try {
      accept(
        await clientMutation<BibMediaState>(path, {
          ...(settings.body === undefined ? {} : { body: settings.body }),
          ...(settings.idempotency === true ? { idempotencyKey: crypto.randomUUID() } : {}),
          ...(settings.method === undefined ? {} : { method: settings.method }),
        }),
      );
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "号码操作失败");
      return false;
    } finally {
      setPending(false);
    }
  }

  const optionName = (id: string | null): string | null =>
    id === null ? null : (options.find((option) => option.id === id)?.displayName ?? null);
  const hasConfirmed = state.tags.some((tag) => tag.status === "confirmed");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Badge variant={state.review.decision === "needs_review" ? "destructive" : "secondary"}>
          {reviewLabels[state.review.decision]}
        </Badge>
        <Badge
          variant={
            state.review.ocrStatus === "failed" || state.review.ocrStatus === "unsupported"
              ? "destructive"
              : "outline"
          }
        >
          {ocrLabels[state.review.ocrStatus]}
        </Badge>
      </div>
      {error === null ? null : (
        <Alert variant="destructive">
          <AlertTitle>号码操作失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {state.tags.map((tag) => (
        <div className="flex flex-col gap-2 rounded-lg border p-2" key={tag.id}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={tag.status === "confirmed" ? "default" : "outline"}>
              {tagLabels[tag.status]}
            </Badge>
            {tag.confidence === null ? null : (
              <span className="text-xs text-muted-foreground">
                OCR 置信度 {(tag.confidence * 100).toFixed(0)}%
              </span>
            )}
            {optionName(tag.gradeOptionId) === null ? null : (
              <Badge variant="secondary">{optionName(tag.gradeOptionId)}</Badge>
            )}
            {optionName(tag.classOptionId) === null ? null : (
              <Badge variant="secondary">{optionName(tag.classOptionId)}</Badge>
            )}
          </div>
          <Field>
            <FieldLabel htmlFor={`bib-number-${tag.id}`}>号码</FieldLabel>
            <Input
              disabled={tag.status === "rejected"}
              id={`bib-number-${tag.id}`}
              inputMode="numeric"
              onChange={(event) =>
                setNumbers((current) => ({ ...current, [tag.id]: event.currentTarget.value }))
              }
              value={numbers[tag.id] ?? tag.number}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            {tag.status === "suggested" || tag.status === "needs_review" ? (
              <>
                <Button
                  disabled={pending}
                  onClick={() =>
                    void mutate(`/api/v1/media/${mediaId}/bib-tags/${tag.id}/confirm`, {
                      body: { number: numbers[tag.id] ?? tag.number },
                      idempotency: true,
                    })
                  }
                  size="sm"
                  type="button"
                >
                  <CheckIcon data-icon="inline-start" />
                  确认或修正
                </Button>
                <Button
                  disabled={pending}
                  onClick={() =>
                    void mutate(`/api/v1/media/${mediaId}/bib-tags/${tag.id}/reject`, {
                      idempotency: true,
                    })
                  }
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <XIcon data-icon="inline-start" />
                  拒绝候选
                </Button>
              </>
            ) : null}
            {tag.status === "confirmed" ? (
              <Button
                disabled={pending}
                onClick={() =>
                  void mutate(`/api/v1/media/${mediaId}/bib-tags/${tag.id}`, {
                    idempotency: true,
                    method: "DELETE",
                  })
                }
                size="sm"
                type="button"
                variant="destructive"
              >
                <Trash2Icon data-icon="inline-start" />
                删除确认号码
              </Button>
            ) : null}
          </div>
        </div>
      ))}
      <Field>
        <FieldLabel htmlFor={`manual-bib-${mediaId}`}>手工添加号码</FieldLabel>
        <Input
          id={`manual-bib-${mediaId}`}
          inputMode="numeric"
          onChange={(event) => setManualNumber(event.currentTarget.value)}
          value={manualNumber}
        />
        <FieldDescription>历史照片也只通过此人工入口补录，不自动补扫。</FieldDescription>
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={pending || manualNumber.length === 0}
          onClick={() => {
            void mutate(`/api/v1/media/${mediaId}/bib-tags`, {
              body: { number: manualNumber },
              idempotency: true,
            }).then((succeeded) => {
              if (succeeded) setManualNumber("");
            });
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          手工确认号码
        </Button>
        <Button
          disabled={pending || hasConfirmed}
          onClick={() =>
            void mutate(`/api/v1/media/${mediaId}/bib-review/no-number`, { idempotency: true })
          }
          size="sm"
          type="button"
          variant="outline"
        >
          确认无号码
        </Button>
        {state.review.decision === "no_number_confirmed" ||
        state.review.decision === "needs_review" ? (
          <Button
            disabled={pending}
            onClick={() =>
              void mutate(`/api/v1/media/${mediaId}/bib-review/reset`, { idempotency: true })
            }
            size="sm"
            type="button"
            variant="ghost"
          >
            <RotateCcwIcon data-icon="inline-start" />
            撤销结论
          </Button>
        ) : null}
      </div>
    </div>
  );
}
