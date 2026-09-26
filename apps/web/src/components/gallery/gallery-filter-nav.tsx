"use client";

import { StarIcon } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import { cn } from "@/lib/utils";

interface GalleryCategory {
  readonly id: string;
  readonly name: string;
}

export interface GalleryFilterSelection {
  readonly categoryId?: string;
  readonly key: string;
  readonly label: string;
}

export function GalleryFilterNav({
  categories,
  featuredOnly,
  onFeaturedChange,
  onSelect,
  pendingKey = null,
  selectedKey,
}: Readonly<{
  categories: readonly GalleryCategory[];
  featuredOnly: boolean;
  onFeaturedChange: (featuredOnly: boolean) => void;
  onSelect: (selection: GalleryFilterSelection) => void;
  pendingKey?: string | null;
  selectedKey: string;
}>) {
  const items = useMemo<readonly GalleryFilterSelection[]>(
    () => [
      { key: "all", label: "全部" },
      ...categories.map((category) => ({
        key: category.id,
        label: category.name,
        categoryId: category.id,
      })),
    ],
    [categories],
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = scrollRef.current;
    const selected = container?.querySelector<HTMLElement>(
      `[data-gallery-filter-key="${CSS.escape(selectedKey)}"]`,
    );
    if (container === null || selected === undefined || selected === null) return;
    const containerRect = container.getBoundingClientRect();
    const selectedRect = selected.getBoundingClientRect();
    if (selectedRect.left >= containerRect.left && selectedRect.right <= containerRect.right) return;
    selected.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [selectedKey]);

  return (
    <nav
      aria-label="相册筛选"
      className="sticky top-[var(--public-gallery-header-height)] z-30 -mx-2.5 -mt-2.5 mb-2 flex h-11 min-h-11 max-h-11 shrink-0 items-stretch overflow-hidden border-b bg-background/92 pl-2.5 backdrop-blur-xl supports-[backdrop-filter]:bg-background/82 sm:-mx-5 sm:-mt-3 sm:mb-3 sm:pl-5 lg:-mx-8 lg:-mt-5 lg:h-13 lg:min-h-13 lg:max-h-13 lg:pl-8 lg:bg-background/96 xl:-mx-10 xl:pl-10 2xl:-mx-12 2xl:pl-12"
      data-viewer-onboarding-target="filters"
    >
      <div
        className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        ref={scrollRef}
      >
        <div className="flex h-full w-max items-stretch pr-2 sm:pr-3">
          {items.map((item) => {
            const active = selectedKey === item.key;
            return (
              <button
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-full shrink-0 touch-manipulation items-center justify-center bg-transparent px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent after:transition-colors hover:text-foreground focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px] disabled:cursor-wait disabled:opacity-70 sm:px-3.5 lg:px-5 lg:text-[15px] lg:after:inset-x-3",
                  active && "text-foreground after:bg-primary",
                )}
                data-gallery-filter-key={item.key}
                disabled={pendingKey !== null}
                key={item.key}
                onClick={() => onSelect(item)}
                type="button"
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="relative flex shrink-0 items-center border-l-2 border-border bg-background/98 px-2.5 sm:px-3.5 lg:px-4">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 -left-4 w-4 bg-gradient-to-r from-transparent to-background/98"
        />
        <button
          aria-pressed={featuredOnly}
          className={cn(
            "flex h-8 shrink-0 touch-manipulation items-center gap-1.5 rounded-lg border border-border/80 bg-muted/25 px-2.5 text-sm font-medium text-foreground shadow-xs transition-[background-color,border-color,color] duration-150 hover:border-border hover:bg-muted/55 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 disabled:cursor-wait disabled:opacity-70 lg:h-9 lg:px-3 lg:text-[15px]",
            featuredOnly && "border-primary/35 bg-primary/10 text-primary hover:border-primary/45 hover:bg-primary/15",
          )}
          disabled={pendingKey !== null}
          onClick={() => onFeaturedChange(!featuredOnly)}
          type="button"
        >
          <StarIcon
            aria-hidden="true"
            className={cn("size-4", featuredOnly && "fill-current")}
          />
          精选
        </button>
      </div>
    </nav>
  );
}
