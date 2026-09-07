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
      <>
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

        <div className="public-theme min-h-dvh bg-background pb-[calc(2.5rem+env(safe-area-inset-bottom))] text-foreground">
          <a
            className="sr-only rounded-lg bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
            href="#gallery-main"
          >
            跳到主要内容
          </a>

          <header className="border-b bg-background/96 supports-backdrop-filter:bg-background/88 supports-backdrop-filter:backdrop-blur-xl">
            <div className="mx-auto max-w-[1560px] px-3.5 py-3 sm:px-5 sm:py-3.5 lg:px-7">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-medium text-muted-foreground sm:text-xs">
                    北航实验学校中学部
                  </p>
                  <h1 className="mt-0.5 truncate text-lg font-semibold tracking-tight sm:text-xl lg:text-2xl">
                    {albumTitle}
                  </h1>
                  {albumDescription ? (
                    <p className="mt-0.5 line-clamp-1 text-xs leading-5 text-muted-foreground sm:text-sm">
                      {albumDescription}
                    </p>
                  ) : null}
                </div>

                <Badge
                  className="mt-0.5 h-7 shrink-0 gap-1.5 rounded-full px-2.5 text-[11px] sm:text-xs"
                  variant={status === "直播中" ? "default" : "secondary"}
                >
                  <RadioIcon aria-hidden="true" className="size-3" />
                  {status}
                </Badge>
              </div>
            </div>
          </header>

          <main
            className="mx-auto max-w-[1560px] px-2.5 py-3 sm:px-5 sm:py-4 lg:px-7 lg:py-5"
            id="gallery-main"
          >
            {children}
          </main>

          <footer className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/94 pb-[env(safe-area-inset-bottom)] supports-backdrop-filter:backdrop-blur-xl">
            <div className="mx-auto flex h-10 max-w-[1560px] items-center justify-center px-3 text-center text-[10px] leading-none text-muted-foreground sm:text-[11px]">
              <p>© 2026 CCA3370 · Images © 2026 学生会电视台</p>
            </div>
          </footer>
        </div>
      </>
    </Toaster>
  );
}
