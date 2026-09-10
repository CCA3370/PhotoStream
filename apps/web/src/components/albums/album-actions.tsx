"use client";

import type { AlbumView } from "@photostream/contracts";
import { ArchiveIcon, LoaderCircleIcon, RadioTowerIcon, StopCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorDialog } from "@/components/ui/error-dialog";
import { clientMutation } from "@/lib/client-api";

type AlbumAction = "archive" | "end" | "restore" | "start";

export function AlbumActions({ album }: Readonly<{ album: AlbumView }>) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);
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

  async function confirmEnd(): Promise<void> {
    setEndConfirmOpen(false);
    await mutate("end");
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
          <Button
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={pending}
            onClick={() => setEndConfirmOpen(true)}
            size="sm"
            variant="destructive"
          >
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

      <Dialog open={endConfirmOpen} onOpenChange={setEndConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>确认结束直播？</DialogTitle>
            <DialogDescription>
              结束后将停止向观众实时推送新照片，但现有相册仍可继续浏览。之后仍可恢复直播。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setEndConfirmOpen(false)} variant="outline">
              取消
            </Button>
            <Button
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void confirmEnd()}
              variant="destructive"
            >
              <StopCircleIcon data-icon="inline-start" />
              确认结束
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ErrorDialog message={error} onClose={() => setError(null)} title="操作失败" />
    </>
  );
}
