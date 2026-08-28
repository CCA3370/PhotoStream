"use client";

import type { AlbumView } from "@photostream/contracts";
import { RadioTowerIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { clientMutation } from "@/lib/client-api";

export function AlbumActions({ album }: Readonly<{ album: AlbumView }>) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const pending = submitting || refreshing;

  async function start(): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await clientMutation(`/api/v1/albums/${album.id}/start`);
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "开始直播失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error === null ? null : (
        <Alert variant="destructive">
          <AlertTitle>操作失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {album.state === "draft" ? (
        <Button disabled={pending} onClick={() => void start()}>
          <RadioTowerIcon data-icon="inline-start" />
          {pending ? "正在开始…" : "开始直播"}
        </Button>
      ) : null}
    </div>
  );
}
