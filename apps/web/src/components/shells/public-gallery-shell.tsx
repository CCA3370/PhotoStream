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
      <style>{`
        html,
        body {
          background-color: oklch(1 0 0);
          color-scheme: light;
        }

        @media (prefers-color-scheme: dark) {
          html,
          body {
            background-color: oklch(0.208 0.042 265.755);
            color-scheme: dark;
          }
        }
      `}</style>

      <div className="public-theme min-h-dvh bg-background pb-[calc(2rem+env(safe-area-inset-bottom))] text-foreground">
        <a
          className="sr-only rounded-lg bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70]"
          href="#gallery-main"
        >
          跳到主要内容
        </a>

        <header className="sticky top-0 z-50 h-16 border-b bg-background">
          <div className="mx-auto h-full max-w-[1560px] px-3.5 py-1.5 sm:px-5 lg:px-7">
            <div className="flex h-full min-w-0 items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[9px] font-medium leading-4 text-muted-foreground sm:text-[10px]">
                  北航实验学校中学部
                </p>
                <h1 className="truncate text-base font-semibold leading-5 tracking-tight sm:text-[17px] lg:text-lg">
                  {albumTitle}
                </h1>
                {albumDescription ? (
                  <p className="line-clamp-1 text-[10px] leading-4 text-muted-foreground sm:text-[11px]">
                    {albumDescription}
                  </p>
                ) : null}
              </div>

              <Badge
                className="mt-1 h-6 shrink-0 gap-1 rounded-full px-2 text-[10px] sm:text-[11px]"
                variant={status === "直播中" ? "default" : "secondary"}
              >
                <RadioIcon aria-hidden="true" className="size-2.5" />
                {status}
              </Badge>
            </div>
          </div>
        </header>

        <main
          className="mx-auto max-w-[1560px] px-2.5 py-2.5 sm:px-5 sm:py-3 lg:px-7 lg:py-4"
          id="gallery-main"
        >
          {children}
        </main>

        <footer className="fixed inset-x-0 bottom-0 z-40 border-t bg-background pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto flex h-8 max-w-[1560px] items-center justify-center px-3 text-center text-[9px] leading-none text-muted-foreground sm:text-[10px]">
            <p>© 2026 CCA3370 · Images © 2026 学生会电视台</p>
          </div>
        </footer>
      </div>
    </Toaster>
  );
}
