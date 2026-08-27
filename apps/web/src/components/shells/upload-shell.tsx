"use client";

import { ArrowLeftIcon, ListChecksIcon, PauseIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { InternalProviders } from "@/components/internal-providers";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { cn } from "@/lib/utils";

export interface UploadShellProps {
  readonly albumId: string;
  readonly albumTitle: string;
  readonly children: ReactNode;
}

function QueueControls() {
  return (
    <div className="flex flex-col gap-2">
      <Button className="min-h-11 justify-start" variant="outline">
        <PauseIcon data-icon="inline-start" />
        暂停全部
      </Button>
      <Button className="min-h-11 justify-start" variant="outline">
        <RotateCcwIcon data-icon="inline-start" />
        重试失败
      </Button>
      <Button className="min-h-11 justify-start" variant="ghost">
        <Trash2Icon data-icon="inline-start" />
        清理已完成
      </Button>
    </div>
  );
}

export function UploadShell({ albumId, albumTitle, children }: UploadShellProps) {
  return (
    <InternalProviders>
      <div className="workbench-theme min-h-screen bg-background text-foreground">
        <a
          className="sr-only rounded-lg bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
          href="#upload-main"
        >
          跳到上传队列
        </a>
        <header className="sticky top-0 border-b bg-card/95 backdrop-blur">
          <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-3 py-3 sm:px-4 md:px-6">
            <Link
              aria-label="返回相册"
              className={cn(buttonVariants({ variant: "ghost", size: "icon-lg" }), "min-h-11")}
              href={`/studio/albums/${albumId}`}
            >
              <ArrowLeftIcon data-icon="inline-start" />
            </Link>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">上传队列 · 网络在线</p>
              <h1 className="truncate text-xl font-semibold">{albumTitle}</h1>
            </div>
            <Drawer showSwipeHandle>
              <DrawerTrigger render={<Button className="min-h-11 lg:hidden" variant="outline" />}>
                <ListChecksIcon data-icon="inline-start" />
                队列摘要
              </DrawerTrigger>
              <DrawerContent>
                <DrawerHeader>
                  <DrawerTitle>队列摘要</DrawerTitle>
                  <DrawerDescription>当前没有进行中的上传任务。</DrawerDescription>
                </DrawerHeader>
                <div className="p-4">
                  <QueueControls />
                </div>
              </DrawerContent>
            </Drawer>
          </div>
        </header>
        <div className="mx-auto grid max-w-[1600px] lg:grid-cols-[minmax(0,1fr)_320px]">
          <main className="min-w-0 p-3 pb-28 sm:p-4 lg:p-6 lg:pb-6" id="upload-main">
            {children}
          </main>
          <aside className="hidden border-l p-6 lg:block" aria-label="上传任务摘要">
            <div className="sticky top-20 flex flex-col gap-5">
              <div className="flex flex-col gap-1">
                <h2 className="font-semibold">任务摘要</h2>
                <p className="text-sm text-muted-foreground">处理中 0 · 失败 0 · 待复核 0</p>
              </div>
              <QueueControls />
            </div>
          </aside>
        </div>
        <div className="fixed inset-x-0 bottom-0 border-t bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
          <div className="mx-auto flex max-w-lg gap-2">
            <Button className="min-h-11 flex-1" variant="outline">
              暂停全部
            </Button>
            <Button className="min-h-11 flex-1" variant="outline">
              重试失败
            </Button>
          </div>
        </div>
      </div>
    </InternalProviders>
  );
}
