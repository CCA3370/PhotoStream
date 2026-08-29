import type { ReactNode } from "react";

export interface PublicGalleryShellProps {
  readonly albumTitle: string;
  readonly children: ReactNode;
  readonly status?: "直播中" | "已结束";
  readonly privacyNotice?: string;
  readonly complaintContact?: string;
}

export function PublicGalleryShell({
  albumTitle,
  children,
  status = "直播中",
  privacyNotice = "影像仅用于校内活动记录。",
  complaintContact = "删除或投诉联系方式将在试运行前由学校确认。",
}: PublicGalleryShellProps) {
  return (
    <div className="public-theme min-h-screen bg-background text-foreground">
      <a
        className="sr-only rounded-lg bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        href="#gallery-main"
      >
        跳到主要内容
      </a>
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-[1440px] items-start justify-between gap-4 px-3 py-4 sm:px-4 md:px-6">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-sm text-muted-foreground">北航实验学校中学部</p>
            <h1 className="truncate text-2xl font-semibold tracking-tight">{albumTitle}</h1>
            <p className="text-sm text-muted-foreground">活动影像将按发布时间稳定展示</p>
          </div>
          <p className="shrink-0 text-sm font-medium text-success">{status}</p>
        </div>
      </header>
      <main className="mx-auto max-w-[1440px] px-3 py-4 sm:px-4 md:px-6" id="gallery-main">
        {children}
      </main>
      <footer className="mx-auto max-w-[1440px] px-3 py-8 text-sm text-muted-foreground sm:px-4 md:px-6">
        <p>{privacyNotice || "影像仅用于校内活动记录。"}</p>
        <p>{complaintContact || "删除或投诉联系方式将在试运行前由学校确认。"}</p>
      </footer>
    </div>
  );
}
