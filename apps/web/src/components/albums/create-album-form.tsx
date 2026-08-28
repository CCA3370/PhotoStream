"use client";

import type { CreateAlbumRequest } from "@photostream/contracts";
import { KeyRoundIcon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
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
          title: String(formData.get("title") ?? ""),
          description: String(formData.get("description") ?? ""),
          publishMode: mode,
        },
      });
      setResult(created);
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建相册失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          setError(null);
          setResult(null);
        }
      }}
    >
      <DialogTrigger render={<Button />}>
        <PlusIcon data-icon="inline-start" />
        创建活动
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>创建活动相册</DialogTitle>
          <DialogDescription>默认使用随机口令，三类下载和号码搜索全部关闭。</DialogDescription>
        </DialogHeader>
        {result === null ? (
          <form action={submit} className="flex flex-col gap-5">
            {error === null ? null : (
              <Alert variant="destructive">
                <AlertTitle>创建失败</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="album-title">活动名称</FieldLabel>
                <Input id="album-title" name="title" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="album-description">活动说明</FieldLabel>
                <Textarea id="album-description" name="description" />
              </Field>
              <Field>
                <FieldLabel id="publish-mode-label">发布方式</FieldLabel>
                <ToggleGroup
                  aria-labelledby="publish-mode-label"
                  value={[mode]}
                  onValueChange={(value) => {
                    const next = value[0];
                    if (next === "review" || next === "auto") setMode(next);
                  }}
                  variant="outline"
                >
                  <ToggleGroupItem className="min-h-11" value="review">
                    先审核
                  </ToggleGroupItem>
                  <ToggleGroupItem className="min-h-11" value="auto">
                    自动发布
                  </ToggleGroupItem>
                </ToggleGroup>
                <FieldDescription>
                  学校场景默认先审核；测试活动可明确选择自动发布。
                </FieldDescription>
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button disabled={pending} type="submit">
                {pending ? "正在创建…" : "创建相册"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            <Alert>
              <KeyRoundIcon aria-hidden="true" />
              <AlertTitle>请立即安全保存相册口令</AlertTitle>
              <AlertDescription>
                <p className="font-mono text-base text-foreground">{result.generatedPassword}</p>
                <p>该口令只在当前结果中展示；不得粘贴到日志、工单或公开页面。</p>
              </AlertDescription>
            </Alert>
            <DialogFooter>
              <Button onClick={() => setOpen(false)} type="button">
                已安全保存
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
