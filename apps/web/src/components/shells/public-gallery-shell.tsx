import { RadioIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Toaster } from "@/components/ui/toast";

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
    <Toaster>
      <div className="public-theme min-h-screen bg-background pb-14 text-foreground">
        <a
          className="sr-only rounded-lg bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
          href="#gallery-main"
        >
          跳到主要内容
        </a>

        <header className="border-b bg-gradient-to-b from-muted/40 via-background to-background">
          <div className="mx-auto max-w-[1560px] px-4 pt-5 pb-4 sm:px-6 sm:pt-7 sm:pb-5 lg:px-8">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] font-medium tracking-wide text-muted-foreground sm:text-xs">
                PhotoStream · 北航实验学校中学部
              </p>
              <Badge
                className="h-7 shrink-0 gap-1.5 rounded-full px-2.5 text-[11px] sm:h-8 sm:px-3 sm:text-xs"
                variant={status === "直播中" ? "default" : "secondary"}
              >
                <RadioIcon aria-hidden="true" className="size-3.5" />
                {status}
              </Badge>
            </div>

            <div className="mt-4 max-w-3xl sm:mt-5">
              <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl lg:text-4xl">
                {albumTitle}
              </h1>
              {albumDescription ? (
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:mt-2.5 sm:text-[15px]">
                  {albumDescription}
                </p>
              ) : null}
            </div>
          </div>
        </header>

        <main
          className="mx-auto max-w-[1560px] px-4 py-4 sm:px-6 sm:py-5 lg:px-8 lg:py-6"
          id="gallery-main"
        >
          {children}
        </main>

        <footer className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur">
          <div className="mx-auto flex min-h-12 max-w-[1560px] flex-col items-center justify-center px-4 py-1 text-center text-[11px] leading-4 text-muted-foreground sm:px-6 sm:text-xs lg:px-8">
            <p>© 2026 CCA3370. All rights reserved.</p>
            <p>Images © 2026 学生会电视台. All rights reserved.</p>
          </div>
        </footer>
      </div>
    </Toaster>
  );
}
