import { CameraIcon, RadioIcon, SchoolIcon, ShieldCheckIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";

export interface PublicGalleryShellProps {
  readonly albumTitle: string;
  readonly albumDescription?: string;
  readonly children: ReactNode;
  readonly status?: "直播中" | "已结束";
  readonly privacyNotice?: string;
  readonly complaintContact?: string;
}

export function PublicGalleryShell({
  albumTitle,
  albumDescription = "",
  children,
  status = "直播中",
  privacyNotice = "影像仅用于校内活动记录。",
  complaintContact = "删除或投诉联系方式将在试运行前由学校确认。",
}: PublicGalleryShellProps) {
  return (
    <div className="public-theme min-h-screen bg-background text-foreground">
      <a
        className="sr-only rounded-lg bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
        href="#gallery-main"
      >
        跳到主要内容
      </a>

      <div className="border-b bg-[radial-gradient(circle_at_top_left,color-mix(in_oklab,var(--primary)_10%,transparent),transparent_38%),linear-gradient(to_bottom,var(--card),var(--background))]">
        <header className="mx-auto flex max-w-[1560px] items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-background/80 shadow-sm backdrop-blur">
              <CameraIcon aria-hidden="true" className="size-5 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">PhotoStream</p>
              <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                <SchoolIcon aria-hidden="true" className="size-3.5" />
                北航实验学校中学部
              </p>
            </div>
          </div>
          <Badge
            className="h-8 gap-1.5 rounded-full px-3"
            variant={status === "直播中" ? "default" : "secondary"}
          >
            <RadioIcon aria-hidden="true" className="size-3.5" />
            {status}
          </Badge>
        </header>

        <div className="mx-auto max-w-[1560px] px-4 pt-8 pb-9 sm:px-6 lg:px-8 lg:pt-12 lg:pb-12">
          <div className="max-w-4xl">
            <p className="mb-3 text-sm font-medium text-primary">活动影像直播</p>
            <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl lg:text-5xl">
              {albumTitle}
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
              {albumDescription || "照片将按发布时间持续更新，你可以浏览、查找并下载已开放的影像。"}
            </p>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-[1560px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8" id="gallery-main">
        {children}
      </main>

      <footer className="mt-8 border-t bg-muted/20">
        <div className="mx-auto grid max-w-[1560px] gap-5 px-4 py-8 text-sm text-muted-foreground sm:px-6 md:grid-cols-2 lg:px-8">
          <div className="flex gap-3">
            <ShieldCheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
            <div>
              <p className="mb-1 font-medium text-foreground">隐私与使用说明</p>
              <p className="leading-6">{privacyNotice || "影像仅用于校内活动记录。"}</p>
            </div>
          </div>
          <div>
            <p className="mb-1 font-medium text-foreground">删除与投诉</p>
            <p className="leading-6">
              {complaintContact || "删除或投诉联系方式将在试运行前由学校确认。"}
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
