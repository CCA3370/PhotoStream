import { RadioIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";

export interface PublicGalleryShellProps {
  readonly albumTitle: string;
  readonly albumDescription?: string;
  readonly children: ReactNode;
  readonly status?: "直播中" | "已结束";
}

export function PublicGalleryShell({
  albumTitle,
  albumDescription = "",
  children,
  status = "直播中",
}: PublicGalleryShellProps) {
  return (
    <div className="public-theme min-h-screen bg-background pb-12 text-foreground">
      <a
        className="sr-only rounded-lg bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
        href="#gallery-main"
      >
        跳到主要内容
      </a>

      <header className="border-b">
        <div className="mx-auto flex max-w-[1560px] items-start justify-between gap-4 px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">
              PhotoStream · 北航实验学校中学部
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
              {albumTitle}
            </h1>
            {albumDescription ? (
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                {albumDescription}
              </p>
            ) : null}
          </div>
          <Badge
            className="mt-0.5 h-8 shrink-0 gap-1.5 rounded-full px-3"
            variant={status === "直播中" ? "default" : "secondary"}
          >
            <RadioIcon aria-hidden="true" className="size-3.5" />
            {status}
          </Badge>
        </div>
      </header>

      <main className="mx-auto max-w-[1560px] px-4 py-4 sm:px-6 lg:px-8 lg:py-5" id="gallery-main">
        {children}
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur">
        <div className="mx-auto flex min-h-12 max-w-[1560px] flex-col items-center justify-center px-4 py-1 text-center text-[11px] leading-4 text-muted-foreground sm:px-6 sm:text-xs lg:px-8">
          <p>© 2026 CCA3370. All rights reserved.</p>
          <p>Images © 2026 学生会电视台. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
