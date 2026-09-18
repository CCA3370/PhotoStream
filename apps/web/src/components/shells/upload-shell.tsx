"use client";

import { ListChecksIcon, PauseIcon, PlayIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";

export interface UploadShellProps {
  readonly children: ReactNode;
  readonly queue: {
    readonly paused: boolean;
    readonly queued: number;
    readonly processing: number;
    readonly failed: number;
    readonly cancelled: number;
    readonly retryableFailed: number;
    readonly pendingReview: number;
    readonly completed: number;
    readonly total: number;
    readonly onTogglePause: () => void;
    readonly onRetryFailed: () => void;
    readonly onClearCompleted: () => void;
  };
}

function QueueSummary({ queue }: Readonly<{ queue: UploadShellProps["queue"] }>) {
  return (
    <div className="grid grid-cols-2 gap-2 text-sm">
      <div className="rounded-lg border bg-muted/20 p-3">
        <p className="text-xs text-muted-foreground">等待处理</p>
        <p className="mt-1 text-lg font-semibold tabular-nums">{queue.queued}</p>
      </div>
      <div className="rounded-lg border bg-muted/20 p-3">
        <p className="text-xs text-muted-foreground">处理并上传</p>
        <p className="mt-1 text-lg font-semibold tabular-nums">{queue.processing}</p>
      </div>
      <div className="rounded-lg border bg-muted/20 p-3">
        <p className="text-xs text-muted-foreground">本机未完成</p>
        <p className="mt-1 text-lg font-semibold tabular-nums">{queue.pendingReview}</p>
      </div>
      <div className="rounded-lg border bg-muted/20 p-3">
        <p className="text-xs text-muted-foreground">失败 / 已取消</p>
        <p className="mt-1 text-lg font-semibold tabular-nums">
          {queue.failed} / {queue.cancelled}
        </p>
      </div>
    </div>
  );
}

function QueueControls({ queue }: Readonly<{ queue: UploadShellProps["queue"] }>) {
  const canPause = queue.queued > 0 || queue.processing > 0 || queue.paused;
  return (
    <div className="flex flex-col gap-2">
      <Button
        className="min-h-10 justify-start"
        disabled={!canPause}
        onClick={queue.onTogglePause}
        type="button"
        variant="outline"
      >
        {queue.paused ? (
          <PlayIcon data-icon="inline-start" />
        ) : (
          <PauseIcon data-icon="inline-start" />
        )}
        {queue.paused ? "继续队列" : "暂停新任务"}
      </Button>
      <Button
        className="min-h-10 justify-start"
        disabled={queue.retryableFailed === 0}
        onClick={queue.onRetryFailed}
        type="button"
        variant="outline"
      >
        <RotateCcwIcon data-icon="inline-start" />
        重试失败（{queue.retryableFailed}）
      </Button>
      <Button
        className="min-h-10 justify-start"
        disabled={queue.completed + queue.cancelled === 0}
        onClick={queue.onClearCompleted}
        type="button"
        variant="ghost"
      >
        <Trash2Icon data-icon="inline-start" />
        清理已完成记录
      </Button>
    </div>
  );
}

export function UploadShell({ children, queue }: UploadShellProps) {
  const processed = queue.completed + queue.failed + queue.cancelled;
  const progress =
    queue.total === 0 ? 0 : Math.min(100, Math.round((processed / queue.total) * 100));

  return (
    <section className="overflow-hidden rounded-xl border bg-card" aria-label="上传队列">
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate font-semibold">上传队列</h2>
            {queue.paused ? <Badge variant="outline">已暂停</Badge> : null}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            照片在当前设备生成派生图，并直接上传原图和派生图；上传完成后默认隐藏。
          </p>
        </div>
        <Drawer showSwipeHandle>
          <DrawerTrigger render={<Button className="lg:hidden" size="sm" variant="outline" />}>
            <ListChecksIcon data-icon="inline-start" />
            队列摘要
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>队列摘要</DrawerTitle>
              <DrawerDescription>
                {queue.total === 0 ? "当前没有处理任务" : `本轮 ${processed}/${queue.total} 已处理`}
              </DrawerDescription>
            </DrawerHeader>
            <div className="flex flex-col gap-4 p-4 pt-0">
              <QueueSummary queue={queue} />
              <QueueControls queue={queue} />
            </div>
          </DrawerContent>
        </Drawer>
      </div>

      {queue.total > 0 ? (
        <div className="border-b px-4 py-2 sm:px-5">
          <div className="mb-1 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>本轮处理进度</span>
            <span className="tabular-nums">
              {processed}/{queue.total} · {progress}%
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      ) : null}

      <div className="grid lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 p-4 sm:p-5">{children}</div>
        <aside className="hidden border-l p-5 lg:block" aria-label="上传任务摘要">
          <div className="sticky top-20 flex flex-col gap-4">
            <QueueSummary queue={queue} />
            <QueueControls queue={queue} />
          </div>
        </aside>
      </div>

      <div className="flex gap-2 border-t p-3 lg:hidden">
        <Button
          className="min-h-10 flex-1"
          disabled={queue.queued === 0 && queue.processing === 0 && !queue.paused}
          onClick={queue.onTogglePause}
          type="button"
          variant="outline"
        >
          {queue.paused ? "继续队列" : "暂停新任务"}
        </Button>
        <Button
          className="min-h-10 flex-1"
          disabled={queue.retryableFailed === 0}
          onClick={queue.onRetryFailed}
          type="button"
          variant="outline"
        >
          重试失败
        </Button>
      </div>
    </section>
  );
}
