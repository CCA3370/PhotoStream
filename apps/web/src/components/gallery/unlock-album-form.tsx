"use client";

import type { ApiError } from "@photostream/contracts";
import {
  ArrowRightIcon,
  EyeIcon,
  EyeOffIcon,
  LoaderCircleIcon,
  LockKeyholeIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";

export function UnlockAlbumForm({ slug }: Readonly<{ slug: string }>) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const pending = submitting || refreshing;

  async function submit(formData: FormData): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/public/albums/${slug}/unlock`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: String(formData.get("password") ?? "") }),
      });
      if (!response.ok) {
        const result = (await response.json()) as ApiError;
        setError(result.message);
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setError("网络不可用，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form action={submit} className="mx-auto w-full max-w-md py-2 sm:py-4">
      <Card className="overflow-hidden rounded-2xl border-border/70 bg-card/95 shadow-sm">
        <CardHeader className="gap-0 pb-3">
          <div className="flex items-start gap-3.5">
            <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <LockKeyholeIcon aria-hidden="true" className="size-5" />
            </div>
            <div className="min-w-0 space-y-1">
              <CardTitle className="text-base sm:text-lg">此相册需要访问口令</CardTitle>
              <CardDescription className="text-sm leading-5">
                输入活动组织方提供的相册口令后即可继续浏览照片。
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <Field data-invalid={error === null ? undefined : true}>
            <FieldLabel htmlFor="album-password">相册口令</FieldLabel>
            <InputGroup className="min-h-12 rounded-xl bg-background">
              <InputGroupAddon aria-hidden="true">
                <LockKeyholeIcon />
              </InputGroupAddon>
              <InputGroupInput
                aria-describedby="album-password-hint"
                aria-invalid={error === null ? undefined : true}
                autoComplete="off"
                autoFocus
                disabled={pending}
                enterKeyHint="go"
                id="album-password"
                name="password"
                placeholder="请输入相册口令"
                style={{ boxShadow: "none", outline: "none" }}
                type={showPassword ? "text" : "password"}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  aria-label={showPassword ? "隐藏口令" : "显示口令"}
                  disabled={pending}
                  onClick={() => setShowPassword((visible) => !visible)}
                  size="icon-sm"
                  type="button"
                >
                  {showPassword ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            {error === null ? (
              <FieldDescription id="album-password-hint">
                口令仅用于验证当前相册的访问权限。
              </FieldDescription>
            ) : (
              <FieldError id="album-password-hint">{error}</FieldError>
            )}
          </Field>

          <Button className="min-h-12 w-full rounded-xl" disabled={pending} type="submit">
            {pending ? (
              <>
                <LoaderCircleIcon aria-hidden="true" className="animate-spin" data-icon="inline-start" />
                正在验证…
              </>
            ) : (
              <>
                进入相册
                <ArrowRightIcon aria-hidden="true" data-icon="inline-end" />
              </>
            )}
          </Button>

          <div className="flex items-start gap-2 border-t pt-4 text-xs leading-5 text-muted-foreground">
            <ShieldCheckIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <p>为保护相册内容，请勿将访问口令公开分享给无关人员。</p>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
