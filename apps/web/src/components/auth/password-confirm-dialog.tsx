"use client";

import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function PasswordConfirmDialog({
  confirmLabel = "确认",
  description,
  onConfirm,
  onOpenChange,
  open,
  title = "确认当前密码",
  variant = "default",
}: Readonly<{
  confirmLabel?: string;
  description?: string;
  onConfirm: (password: string) => Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title?: string;
  variant?: "default" | "destructive";
}>) {
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setPassword("");
      setError(null);
      setPending(false);
    }
  }, [open]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending || password.length === 0) return;
    setPending(true);
    setError(null);
    try {
      await onConfirm(password);
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "密码确认失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description === undefined ? null : (
              <DialogDescription>{description}</DialogDescription>
            )}
          </DialogHeader>
          <Field className="my-5" data-invalid={error === null ? undefined : true}>
            <FieldLabel htmlFor="password-confirmation">当前密码</FieldLabel>
            <Input
              autoComplete="current-password"
              autoFocus
              id="password-confirmation"
              onChange={(event) => setPassword(event.currentTarget.value)}
              type="password"
              value={password}
            />
            {error === null ? null : <FieldError>{error}</FieldError>}
          </Field>
          <DialogFooter>
            <Button disabled={pending} onClick={() => onOpenChange(false)} type="button" variant="outline">
              取消
            </Button>
            <Button disabled={pending || password.length === 0} type="submit" variant={variant}>
              {pending ? "正在验证…" : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
