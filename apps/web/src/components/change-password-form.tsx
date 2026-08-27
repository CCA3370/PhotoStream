"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  type ApiError,
  type AuthSession,
  changePasswordRequestSchema,
  passwordSchema,
} from "@photostream/contracts";
import { KeyRoundIcon, LockKeyholeIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";

const changePasswordFormSchema = changePasswordRequestSchema
  .safeExtend({ confirmPassword: passwordSchema })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: "两次输入的新密码不一致",
    path: ["confirmPassword"],
  });

type ChangePasswordFormValues = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

export function ChangePasswordForm() {
  const router = useRouter();
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const form = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(changePasswordFormSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/auth/session", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          router.replace("/login");
          return;
        }
        const session = (await response.json()) as AuthSession;
        setCsrfToken(session.csrfToken);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setPageError("无法读取登录状态，请刷新页面重试");
      });
    return () => controller.abort();
  }, [router]);

  async function onSubmit(values: ChangePasswordFormValues): Promise<void> {
    if (csrfToken === null) {
      setPageError("安全校验尚未就绪，请稍后重试");
      return;
    }
    setPageError(null);
    try {
      const response = await fetch("/api/v1/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({
          currentPassword: values.currentPassword,
          newPassword: values.newPassword,
        }),
      });
      if (!response.ok) {
        const error = (await response.json()) as ApiError;
        setPageError(error.message);
        return;
      }
      startTransition(() => {
        router.replace("/studio");
        router.refresh();
      });
    } catch {
      setPageError("当前无法连接服务，请检查网络后重试");
    }
  }

  return (
    <form className="flex flex-col gap-5" noValidate onSubmit={form.handleSubmit(onSubmit)}>
      {pageError === null ? null : (
        <p
          className="rounded-lg border border-destructive p-3 text-sm text-destructive"
          role="alert"
        >
          {pageError}
        </p>
      )}
      <FieldGroup>
        <Field data-invalid={form.formState.errors.currentPassword ? true : undefined}>
          <FieldLabel htmlFor="current-password">当前临时密码</FieldLabel>
          <InputGroup className="min-h-11">
            <InputGroupAddon aria-hidden="true">
              <KeyRoundIcon />
            </InputGroupAddon>
            <InputGroupInput
              aria-invalid={form.formState.errors.currentPassword ? true : undefined}
              autoComplete="current-password"
              id="current-password"
              type="password"
              {...form.register("currentPassword")}
            />
          </InputGroup>
          <FieldError errors={[form.formState.errors.currentPassword]} />
        </Field>
        <Field data-invalid={form.formState.errors.newPassword ? true : undefined}>
          <FieldLabel htmlFor="new-password">新密码</FieldLabel>
          <InputGroup className="min-h-11">
            <InputGroupAddon aria-hidden="true">
              <LockKeyholeIcon />
            </InputGroupAddon>
            <InputGroupInput
              aria-invalid={form.formState.errors.newPassword ? true : undefined}
              autoComplete="new-password"
              id="new-password"
              type="password"
              {...form.register("newPassword")}
            />
          </InputGroup>
          <FieldDescription>至少 12 位，不能与用户名相同或使用常见弱密码。</FieldDescription>
          <FieldError errors={[form.formState.errors.newPassword]} />
        </Field>
        <Field data-invalid={form.formState.errors.confirmPassword ? true : undefined}>
          <FieldLabel htmlFor="confirm-password">再次输入新密码</FieldLabel>
          <InputGroup className="min-h-11">
            <InputGroupAddon aria-hidden="true">
              <LockKeyholeIcon />
            </InputGroupAddon>
            <InputGroupInput
              aria-invalid={form.formState.errors.confirmPassword ? true : undefined}
              autoComplete="new-password"
              id="confirm-password"
              type="password"
              {...form.register("confirmPassword")}
            />
          </InputGroup>
          <FieldError errors={[form.formState.errors.confirmPassword]} />
        </Field>
      </FieldGroup>
      <Button
        className="min-h-11"
        disabled={csrfToken === null || form.formState.isSubmitting || isPending}
        type="submit"
      >
        {csrfToken === null
          ? "正在验证会话…"
          : form.formState.isSubmitting || isPending
            ? "正在保存…"
            : "保存新密码"}
      </Button>
    </form>
  );
}
