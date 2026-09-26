"use client";

import { SearchIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/toast";

interface SearchHeaderState {
  readonly active: boolean;
  readonly count: number;
  readonly label: string;
}

export interface PublicGalleryShellProps {
  readonly albumTitle: string;
  readonly albumDescription?: string;
  readonly children: ReactNode;
  readonly searchAvailable?: boolean;
}

export function PublicGalleryShell({
  albumTitle,
  albumDescription = "",
  children,
  searchAvailable = false,
}: PublicGalleryShellProps) {
  const [searchState, setSearchState] = useState<SearchHeaderState>({
    active: false,
    count: 0,
    label: "找照片",
  });
  const headerHeightClass = albumDescription
    ? "[--public-gallery-header-height:4rem] lg:[--public-gallery-header-height:6.25rem]"
    : "[--public-gallery-header-height:3rem] lg:[--public-gallery-header-height:5.5rem]";

  useEffect(() => {
    const updateSearchState = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          readonly active?: boolean;
          readonly count?: number;
          readonly label?: string;
        }>
      ).detail;
      setSearchState({
        active: detail?.active === true,
        count: typeof detail?.count === "number" ? detail.count : 0,
        label:
          typeof detail?.label === "string" && detail.label.length > 0
            ? detail.label
            : "找照片",
      });
    };
    window.addEventListener("photostream:search-status", updateSearchState);
    return () => window.removeEventListener("photostream:search-status", updateSearchState);
  }, []);

  const openSearch = () => window.dispatchEvent(new Event("photostream:open-search"));
  const clearSearch = () => window.dispatchEvent(new Event("photostream:clear-search"));

  return (
    <Toaster>
      <div
        className={`public-theme min-h-dvh bg-background pb-[calc(2rem+env(safe-area-inset-bottom))] text-foreground ${headerHeightClass}`}
      >
        <a
          className="sr-only layer-skip-link rounded-lg bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
          href="#gallery-main"
        >
          跳到主要内容
        </a>

        <header className="sticky top-0 z-40 h-[var(--public-gallery-header-height)] border-b border-border/45 bg-background/94 backdrop-blur-xl supports-[backdrop-filter]:bg-background/84">
          <div className="mx-auto flex h-full max-w-[2080px] items-center px-3.5 sm:px-5 lg:px-8 xl:px-10 2xl:px-12">
            <div className="flex min-w-0 flex-1 items-center justify-between gap-3 lg:gap-8">
              <div className="flex min-w-0 flex-1 flex-col justify-center">
                <p className="truncate text-[10px] font-medium leading-4 text-muted-foreground sm:text-[11px] lg:text-[13px] lg:leading-5">
                  北航实验学校中学部暨北航实验学校分校
                </p>
                <h1 className="truncate text-[17px] font-semibold leading-5 tracking-tight sm:text-lg sm:leading-6 lg:text-[26px] lg:leading-8">
                  {albumTitle}
                </h1>
                {albumDescription ? (
                  <p className="line-clamp-1 text-[11px] leading-4 text-muted-foreground sm:text-xs lg:mt-0.5 lg:text-sm lg:leading-5">
                    {albumDescription}
                  </p>
                ) : null}
              </div>

              {searchAvailable ? (
                <div
                  className="flex shrink-0 items-center gap-0.5"
                  data-viewer-onboarding-target="search"
                >
                  <button
                    className="flex h-8 min-w-0 max-w-[8.5rem] items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-2.5 text-xs font-semibold text-foreground shadow-xs transition-[background-color,border-color] hover:border-primary/40 hover:bg-primary/15 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 sm:max-w-[10rem] sm:text-sm lg:h-9 lg:max-w-[13rem] lg:px-3"
                    onClick={openSearch}
                    type="button"
                  >
                    <SearchIcon aria-hidden="true" className="size-3.5 shrink-0 text-primary sm:size-4" />
                    <span className="truncate">
                      {searchState.active
                        ? `${searchState.label} · ${searchState.count}张`
                        : "找照片"}
                    </span>
                  </button>
                  {searchState.active ? (
                    <Button
                      aria-label="关闭找照片"
                      className="size-7 shrink-0 rounded-lg"
                      onClick={clearSearch}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <XIcon aria-hidden="true" />
                    </Button>
                  ) : null}
                </div>
              ) : null}
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
            <p>© 2026 CCA3370 · Images © 2026 校团委学生会电视台</p>
          </div>
        </footer>
      </div>
    </Toaster>
  );
}
