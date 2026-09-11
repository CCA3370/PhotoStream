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
    <form action={submit} className="mx-auto w-full max-w-sm">
      <div className="rounded-[1.6rem] border border-border/55 bg-card px-5 py-6 shadow-sm shadow-foreground/[0.035] sm:px-6 sm:py-7">
        <div className="text-center">
          <div className="mx-auto grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/10">
            <LockKeyholeIcon aria-hidden="true" className="size-5" />
          </div>
          <h2 className="mt-4 text-xl font-semibold tracking-tight">请输入访问口令</h2>
          <p className="mx-auto mt-1.5 max-w-xs text-sm leading-5 text-muted-foreground">
            该相册已设置访问保护，请输入活动组织方提供的口令。
          </p>
        </div>

        <div className="mt-6 space-y-4">
          <Field data-invalid={error === null ? undefined : true}>
            <FieldLabel className="text-xs font-medium text-foreground/85" htmlFor="album-password">
              访问口令
            </FieldLabel>
            <InputGroup className="min-h-12 rounded-xl border-border/70 bg-background shadow-none transition-[border-color,box-shadow] focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10">
              <InputGroupAddon aria-hidden="true" className="pl-3.5 text-muted-foreground">
                <KeyRoundIcon className="size-4" />
              </InputGroupAddon>
              <InputGroupInput
                aria-describedby="album-password-hint"
                aria-invalid={error === null ? undefined : true}
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect="off"
                className="text-[15px]"
                disabled={pending}
                enterKeyHint="go"
                id="album-password"
                name="password"
                placeholder="输入相册口令"
                spellCheck={false}
                style={{ boxShadow: "none", outline: "none" }}
                type={showPassword ? "text" : "password"}
              />
              <InputGroupAddon align="inline-end" className="pr-1.5">
                <InputGroupButton
                  aria-label={showPassword ? "隐藏口令" : "显示口令"}
                  className="rounded-lg text-muted-foreground hover:text-foreground"
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
              <FieldDescription className="text-xs" id="album-password-hint">
                没有口令？请向活动组织方获取。
              </FieldDescription>
            ) : (
              <FieldError id="album-password-hint">{error}</FieldError>
            )}
          </Field>

          <Button className="h-12 w-full rounded-xl text-sm font-medium" disabled={pending} type="submit">
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
        </div>

        <div className="mt-4 flex items-start justify-center gap-2 border-t border-border/45 pt-4 text-[11px] leading-4.5 text-muted-foreground">
          <ShieldCheckIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          <p>请勿将访问口令公开分享给无关人员。</p>
        </div>
      </div>
    </form>
  );
}
