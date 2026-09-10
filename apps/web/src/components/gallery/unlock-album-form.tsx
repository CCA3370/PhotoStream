"use client";

import type { ApiError } from "@photostream/contracts";
import {
  ArrowRightIcon,
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
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
    <form action={submit} className="mx-auto w-full max-w-md py-1 sm:py-4">
      <Card className="overflow-hidden rounded-[1.75rem] border-border/60 bg-card/96 shadow-lg shadow-foreground/5">
        <CardHeader className="items-center gap-4 px-5 pt-7 pb-5 text-center sm:px-7 sm:pt-8">
          <div className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/10">
            <LockKeyholeIcon aria-hidden="true" className="size-6" />
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium tracking-wide text-muted-foreground">访问受限</p>
            <CardTitle className="text-xl tracking-tight sm:text-2xl">输入口令进入相册</CardTitle>
            <CardDescription className="mx-auto max-w-sm text-sm leading-6">
              此相册仅向持有活动口令的访客开放，请输入活动组织方提供的访问口令。
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 px-5 pb-5 sm:px-7 sm:pb-7">
          <Field data-invalid={error === null ? undefined : true}>
            <FieldLabel className="text-sm" htmlFor="album-password">
              相册口令
            </FieldLabel>
            <InputGroup className="min-h-14 rounded-2xl bg-background shadow-xs">
              <InputGroupAddon aria-hidden="true" className="pl-4 text-muted-foreground">
                <KeyRoundIcon className="size-4.5" />
              </InputGroupAddon>
              <InputGroupInput
                aria-describedby="album-password-hint"
                aria-invalid={error === null ? undefined : true}
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect="off"
                className="text-base"
                disabled={pending}
                enterKeyHint="go"
                id="album-password"
                name="password"
                placeholder="请输入相册口令"
                spellCheck={false}
                style={{ boxShadow: "none", outline: "none" }}
                type={showPassword ? "text" : "password"}
              />
              <InputGroupAddon align="inline-end" className="pr-2">
                <InputGroupButton
                  aria-label={showPassword ? "隐藏口令" : "显示口令"}
                  disabled={pending}
                  onClick={() => setShowPassword((visible) => !visible)}
                  size="icon-sm"
                  type="button"
                >
                  {showPassword ? (
                    <EyeOffIcon aria-hidden="true" />
                  ) : (
                    <EyeIcon aria-hidden="true" />
                  )}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            {error === null ? (
              <FieldDescription id="album-password-hint">
                不知道口令时，请向活动组织方获取。
              </FieldDescription>
            ) : (
              <FieldError id="album-password-hint">{error}</FieldError>
            )}
          </Field>

          <Button className="min-h-13 w-full rounded-2xl text-sm" disabled={pending} type="submit">
            {pending ? (
              <>
                <LoaderCircleIcon
                  aria-hidden="true"
                  className="animate-spin"
                  data-icon="inline-start"
                />
                正在验证…
              </>
            ) : (
              <>
                进入相册
                <ArrowRightIcon aria-hidden="true" data-icon="inline-end" />
              </>
            )}
          </Button>

          <div className="flex items-start gap-2.5 rounded-2xl bg-muted/45 px-3.5 py-3 text-xs leading-5 text-muted-foreground">
            <ShieldCheckIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <p>为保护相册内容，请勿将访问口令公开分享给无关人员。</p>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
