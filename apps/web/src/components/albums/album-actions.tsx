"use client";

import type { AlbumView } from "@photostream/contracts";
import { ArchiveIcon, RadioTowerIcon, StopCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { clientMutation } from "@/lib/client-api";

export function AlbumActions({ album }: Readonly<{ album: AlbumView }>) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const pending = submitting || refreshing;

  async function mutate(action: "archive" | "end" | "restore" | "start"): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await clientMutation(`/api/v1/albums/${album.id}/${action}`);
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "活动状态更新失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {album.state === "draft" ? (
          <Button disabled={pending} onClick={() => void mutate("start")} size="sm">
            <RadioTowerIcon data-icon="inline-start" />
            {pending ? "正在开始…" : "开始直播"}
          </Button>
        ) : null}
        {album.state === "live" ? (
          <Button
            disabled={pending}
            onClick={() => void mutate("end")}
            size="sm"
            variant="outline"
          >
            <StopCircleIcon data-icon="inline-start" />
            {pending ? "正在结束…" : "结束直播"}
          </Button>
        ) : null}
        {album.state === "ended" ? (
          <>
            <Button disabled={pending} onClick={() => void mutate("start")} size="sm">
              <RadioTowerIcon data-icon="inline-start" />
              恢复直播
            </Button>
            <Button
              disabled={pending}
              onClick={() => void mutate("archive")}
              size="sm"
              variant="outline"
            >
              <ArchiveIcon data-icon="inline-start" />
              归档
            </Button>
          </>
        ) : null}
        {album.state === "archived" ? (
          <Button
            disabled={pending}
            onClick={() => void mutate("restore")}
            size="sm"
            variant="outline"
          >
            <ArchiveIcon data-icon="inline-start" />
            {pending ? "正在恢复…" : "恢复活动"}
          </Button>
        ) : null}
      </div>
      <ErrorDialog message={error} onClose={() => setError(null)} title="操作失败" />
    </>
  );
}
