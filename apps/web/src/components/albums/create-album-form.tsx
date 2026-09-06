"use client";

import type { CreateAlbumRequest } from "@photostream/contracts";
import {
  ArrowRightIcon,
  CheckIcon,
  CopyIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  PlusIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { clientMutation } from "@/lib/client-api";

interface CreatedAlbumResponse {
  readonly album: { readonly id: string; readonly title: string };
  readonly generatedPassword: string;
}

export function CreateAlbumForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<CreateAlbumRequest["publishMode"]>("review");
  const [result, setResult] = useState<CreatedAlbumResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const pending = submitting || refreshing;

  async function submit(formData: FormData): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await clientMutation<CreatedAlbumResponse>("/api/v1/albums", {
        idempotencyKey: crypto.randomUUID(),
        body: {
          title: String(formData.get("title") ?? "").trim(),
          description: String(formData.get("description") ?? "").trim(),
          publishMode: mode,
        },
      });
      setResult(created);
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建活动失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyPassword(): Promise<void> {
    if (result === null) return;
    try {
      await navigator.clipboard.writeText(result.generatedPassword);
      setCopied(true);
    } catch {
      setError("无法复制口令，请手动复制");
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            setError(null);
            setResult(null);
            setCopied(false);
            setMode("review");
          }
        }}
      >
        <DialogTrigger render={<Button size="sm" />}>
          <PlusIcon data-icon="inline-start" />
          创建活动
        </DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{result === null ? "创建活动" : "活动已创建"}</DialogTitle>
            <DialogDescription>
              {result === null ? "填写活动信息并选择照片发布方式。" : result.album.title}
            </DialogDescription>
          </DialogHeader>
          {result === null ? (
            <form action={submit} className="flex flex-col gap-4">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="album-title">活动名称</FieldLabel>
                  <Input autoFocus id="album-title" maxLength={120} name="title" required />
                </Field>
                <Field>
                  <FieldLabel htmlFor="album-description">说明</FieldLabel>
                  <Textarea id="album-description" maxLength={1000} name="description" rows={3} />
                </Field>
                <Field>
                  <FieldLabel id="publish-mode-label">发布方式</FieldLabel>
                  <ToggleGroup
                    aria-labelledby="publish-mode-label"
                    className="w-full"
                    value={[mode]}
                    onValueChange={(value) => {
                      const next = value[0];
                      if (next === "review" || next === "auto") setMode(next);
                    }}
                    variant="outline"
                  >
                    <ToggleGroupItem className="min-h-10 flex-1" value="review">
                      审核后发布
                    </ToggleGroupItem>
                    <ToggleGroupItem className="min-h-10 flex-1" value="auto">
                      自动发布
                    </ToggleGroupItem>
                  </ToggleGroup>
                </Field>
              </FieldGroup>
              <DialogFooter>
                <Button disabled={pending} type="submit">
                  {submitting ? (
                    <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
                  ) : null}
                  {submitting ? "正在创建…" : "创建活动"}
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="rounded-xl border bg-muted/30 p-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <KeyRoundIcon aria-hidden="true" className="size-4" />
                  访问口令
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <code className="min-w-0 flex-1 select-all truncate rounded-lg border bg-background px-3 py-2 font-mono text-base">
                    {result.generatedPassword}
                  </code>
                  <Button
                    onClick={() => void copyPassword()}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {copied ? (
                      <CheckIcon data-icon="inline-start" />
                    ) : (
                      <CopyIcon data-icon="inline-start" />
                    )}
                    {copied ? "已复制" : "复制"}
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">关闭后不再显示此口令。</p>
              </div>
              <DialogFooter>
                <Button
                  onClick={() => {
                    setOpen(false);
                    router.push(`/studio/albums/${result.album.id}`);
                  }}
                  type="button"
                >
                  进入活动
                  <ArrowRightIcon data-icon="inline-end" />
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <ErrorDialog message={error} onClose={() => setError(null)} title="创建活动失败" />
    </>
  );
}
