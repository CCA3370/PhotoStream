"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { clientMutation } from "@/lib/client-api";

export function PublishMediaButton({ mediaId }: Readonly<{ mediaId: string }>) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const pending = submitting || refreshing;

  async function publish(): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await clientMutation(`/api/v1/media/${mediaId}/publish`, {
        idempotencyKey: crypto.randomUUID(),
      });
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "发布失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button disabled={pending} onClick={() => void publish()} type="button">
        {pending ? "正在发布…" : "发布"}
      </Button>
      <ErrorDialog message={error} onClose={() => setError(null)} title="发布失败" />
    </>
  );
}
