"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  type ApiError,
  type AuthSession,
  type LoginRequest,
  loginRequestSchema,
} from "@photostream/contracts";
import { KeyRoundIcon, UserRoundIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";

export function LoginForm() {
  const router = useRouter();
  const [pageError, setPageError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const form = useForm<LoginRequest>({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { username: "", password: "" },
  });

  async function onSubmit(values: LoginRequest): Promise<void> {
    setPageError(null);
    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!response.ok) {
        const error = (await response.json()) as ApiError;
        setPageError(error.message);
        return;
      }
      const session = (await response.json()) as AuthSession;
      startTransition(() => {
        router.replace(session.user.mustChangePassword ? "/change-password" : "/studio");
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
        <Field data-invalid={form.formState.errors.username ? true : undefined}>
          <FieldLabel htmlFor="username">用户名</FieldLabel>
          <InputGroup className="min-h-11">
            <InputGroupAddon aria-hidden="true">
              <UserRoundIcon />
            </InputGroupAddon>
            <InputGroupInput
              aria-invalid={form.formState.errors.username ? true : undefined}
              autoComplete="username"
              id="username"
              {...form.register("username")}
            />
          </InputGroup>
          <FieldError errors={[form.formState.errors.username]} />
        </Field>
        <Field data-invalid={form.formState.errors.password ? true : undefined}>
          <FieldLabel htmlFor="password">密码</FieldLabel>
          <InputGroup className="min-h-11">
            <InputGroupAddon aria-hidden="true">
              <KeyRoundIcon />
            </InputGroupAddon>
            <InputGroupInput
              aria-invalid={form.formState.errors.password ? true : undefined}
              autoComplete="current-password"
              id="password"
              type="password"
              {...form.register("password")}
            />
          </InputGroup>
          <FieldError errors={[form.formState.errors.password]} />
        </Field>
      </FieldGroup>
      <Button
        className="min-h-11"
        disabled={form.formState.isSubmitting || isPending}
        type="submit"
      >
        {form.formState.isSubmitting || isPending ? "正在登录…" : "登录"}
      </Button>
    </form>
  );
}
