"use client";

import type { AlbumView } from "@photostream/contracts";
import { ArchiveIcon, LoaderCircleIcon, RadioTowerIcon, StopCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { clientMutation } from "@/lib/client-api";

type AlbumAction = "archive" | "end" | "restore" | "start";

export function AlbumActions({ album }: Readonly<{ album: AlbumView }>) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<AlbumAction | null>(null);
  const [refreshing, startTransition] = useTransition();
  const pending = pendingAction !== null || refreshing;

  async function mutate(action: AlbumAction): Promise<void> {
    if (pendingAction !== null) return;
    setPendingAction(action);
    setError(null);
    try {
      await clientMutation(`/api/v1/albums/${album.id}/${action}`);
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "活动状态更新失败");
    } finally {
      setPendingAction(null);
    }
  }

  function icon(action: AlbumAction, fallback: ReactNode): ReactNode {
    return pendingAction === action ? (
      <LoaderCircleIcon aria-hidden="true" className="animate-spin" data-icon="inline-start" />
    ) : (
      fallback
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {album.state === "draft" ? (
          <Button disabled={pending} onClick={() => void mutate("start")} size="sm">
            {icon("start", <RadioTowerIcon data-icon="inline-start" />)}
            {pendingAction === "start" ? "正在开始…" : "开始直播"}
          </Button>
        ) : null}
        {album.state === "live" ? (
          <Button disabled={pending} onClick={() => void mutate("end")} size="sm" variant="outline">
            {icon("end", <StopCircleIcon data-icon="inline-start" />)}
            {pendingAction === "end" ? "正在结束…" : "结束直播"}
          </Button>
        ) : null}
        {album.state === "ended" ? (
          <>
            <Button disabled={pending} onClick={() => void mutate("start")} size="sm">
              {icon("start", <RadioTowerIcon data-icon="inline-start" />)}
              {pendingAction === "start" ? "正在恢复…" : "恢复直播"}
            </Button>
            <Button
              disabled={pending}
              onClick={() => void mutate("archive")}
              size="sm"
              variant="outline"
            >
              {icon("archive", <ArchiveIcon data-icon="inline-start" />)}
              {pendingAction === "archive" ? "正在归档…" : "归档"}
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
            {icon("restore", <ArchiveIcon data-icon="inline-start" />)}
            {pendingAction === "restore" ? "正在恢复…" : "恢复活动"}
          </Button>
        ) : null}
      </div>
      <ErrorDialog message={error} onClose={() => setError(null)} title="操作失败" />
    </>
  );
}
