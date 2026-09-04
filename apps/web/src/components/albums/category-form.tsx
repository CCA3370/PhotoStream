"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { clientMutation } from "@/lib/client-api";

export function CategoryForm({ albumId }: Readonly<{ albumId: string }>) {
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
      await clientMutation(`/api/v1/albums/${albumId}/categories`, {
        idempotencyKey: crypto.randomUUID(),
        body: { name: String(formData.get("name") ?? ""), sortOrder: 0 },
      });
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建分类失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <form action={submit} className="flex max-w-md items-end gap-2">
        <Field data-invalid={error === null ? undefined : true}>
          <FieldLabel htmlFor="category-name">新增一级分类</FieldLabel>
          <Input aria-invalid={error === null ? undefined : true} id="category-name" name="name" />
        </Field>
        <Button disabled={pending} type="submit" variant="outline">
          {pending ? "添加中…" : "添加"}
        </Button>
      </form>
      <ErrorDialog message={error} onClose={() => setError(null)} title="创建分类失败" />
    </>
  );
}
