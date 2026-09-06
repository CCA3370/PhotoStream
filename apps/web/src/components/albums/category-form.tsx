"use client";

import { LoaderCircleIcon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { Input } from "@/components/ui/input";
import { clientMutation } from "@/lib/client-api";

export function CategoryForm({ albumId }: Readonly<{ albumId: string }>) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const pending = submitting || refreshing;

  async function submit(formData: FormData): Promise<void> {
    if (submitting) return;
    const name = String(formData.get("name") ?? "").trim();
    if (name.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await clientMutation(`/api/v1/albums/${albumId}/categories`, {
        idempotencyKey: crypto.randomUUID(),
        body: { name, sortOrder: 0 },
      });
      formRef.current?.reset();
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建分类失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <form action={submit} className="flex max-w-md items-center gap-2" ref={formRef}>
        <Input
          aria-label="新分类名称"
          className="h-8"
          maxLength={60}
          name="name"
          placeholder="新增分类"
          required
        />
        <Button disabled={pending} size="sm" type="submit" variant="outline">
          {pending ? (
            <LoaderCircleIcon aria-hidden="true" className="animate-spin" data-icon="inline-start" />
          ) : (
            <PlusIcon aria-hidden="true" data-icon="inline-start" />
          )}
          添加
        </Button>
      </form>
      <ErrorDialog message={error} onClose={() => setError(null)} title="创建分类失败" />
    </>
  );
}
