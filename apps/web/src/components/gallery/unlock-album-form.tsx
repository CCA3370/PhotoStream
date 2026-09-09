"use client";

import type { ApiError } from "@photostream/contracts";
import { LockKeyholeIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";

export function UnlockAlbumForm({ slug }: Readonly<{ slug: string }>) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
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
    <>
      <form action={submit} className="mx-auto flex max-w-sm flex-col gap-3 py-5 sm:py-8">
        <Field data-invalid={error === null ? undefined : true}>
          <FieldLabel className="sr-only" htmlFor="album-password">
            相册口令
          </FieldLabel>
          <InputGroup className="min-h-11 rounded-xl">
            <InputGroupAddon aria-hidden="true">
              <LockKeyholeIcon />
            </InputGroupAddon>
            <InputGroupInput
              aria-invalid={error === null ? undefined : true}
              autoComplete="off"
              autoFocus
              id="album-password"
              name="password"
              placeholder="输入相册口令"
              style={{ boxShadow: "none", outline: "none" }}
              type="password"
            />
          </InputGroup>
        </Field>
        <Button className="min-h-11 rounded-xl" disabled={pending} type="submit">
          {pending ? "正在验证…" : "进入相册"}
        </Button>
      </form>
      <ErrorDialog message={error} onClose={() => setError(null)} title="无法进入相册" />
    </>
  );
}
