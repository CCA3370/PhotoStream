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
  const headerHeightClass = albumDescription
    ? "[--public-gallery-header-height:4rem] lg:[--public-gallery-header-height:5.5rem]"
    : "[--public-gallery-header-height:3rem] lg:[--public-gallery-header-height:4.75rem]";

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

        @media (min-width: 1024px) {
          [data-lightbox-controls] button {
            min-height: 3rem;
          }

          [data-lightbox-controls] button[aria-label] {
            min-width: 3rem;
          }

          [data-lightbox-controls] button svg {
            width: 1.125rem;
            height: 1.125rem;
          }

          button[aria-label="上一张照片"],
          button[aria-label="下一张照片"] {
            width: 3.5rem !important;
            height: 3.5rem !important;
            min-width: 3.5rem !important;
            min-height: 3.5rem !important;
          }

          button[aria-label="上一张照片"] svg,
          button[aria-label="下一张照片"] svg {
            width: 1.5rem;
            height: 1.5rem;
          }

          button[aria-label="上一张照片"]:active,
          button[aria-label="下一张照片"]:active {
            scale: 1 !important;
            --tw-scale-x: 1 !important;
            --tw-scale-y: 1 !important;
          }
        }
      `}</style>

      <div
        className={`public-theme min-h-dvh bg-background pb-[calc(2rem+env(safe-area-inset-bottom))] text-foreground ${headerHeightClass}`}
      >
        <a
          className="sr-only rounded-lg bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70]"
          href="#gallery-main"
        >
          跳到主要内容
        </a>

        <header className="sticky top-0 z-40 h-[var(--public-gallery-header-height)] bg-background/92 backdrop-blur-xl supports-[backdrop-filter]:bg-background/82">
          <div className="mx-auto flex h-full max-w-[2080px] items-center px-3.5 sm:px-5 lg:px-8 xl:px-10 2xl:px-12">
            <div className="flex min-w-0 flex-1 items-center justify-between gap-3 lg:gap-8">
              <div className="flex min-w-0 flex-1 flex-col justify-center">
                <p className="truncate text-[10px] font-medium leading-4 text-muted-foreground sm:text-[11px] lg:text-xs lg:leading-5">
                  北航实验学校中学部
                </p>
                <h1 className="truncate text-[17px] font-semibold leading-5 tracking-tight sm:text-lg sm:leading-6 lg:text-2xl lg:leading-8">
                  {albumTitle}
                </h1>
                {albumDescription ? (
                  <p className="line-clamp-1 text-[11px] leading-4 text-muted-foreground sm:text-xs lg:text-sm lg:leading-5">
                    {albumDescription}
                  </p>
                ) : null}
              </div>

              <Badge
                className="h-6 shrink-0 self-center gap-1 rounded-full px-2.5 text-[10px] shadow-xs sm:text-[11px] lg:h-8 lg:gap-1.5 lg:px-3.5 lg:text-xs"
                variant={status === "直播中" ? "default" : "secondary"}
              >
                <RadioIcon aria-hidden="true" className="size-2.5 lg:size-3" />
                {status}
              </Badge>
            </div>
          </div>
        </header>

        <main
          className="mx-auto max-w-[2080px] px-2.5 py-2.5 sm:px-5 sm:py-3 lg:px-8 lg:py-5 xl:px-10 2xl:px-12"
          id="gallery-main"
        >
          {children}
        </main>

        <footer className="fixed inset-x-0 bottom-0 z-40 border-t bg-background pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto flex h-8 max-w-[2080px] items-center justify-center px-3 text-center text-[9px] leading-none text-muted-foreground sm:text-[10px]">
            <p>© 2026 CCA3370 · Images © 2026 学生会电视台</p>
          </div>
        </footer>
      </div>
    </Toaster>
  );
}
