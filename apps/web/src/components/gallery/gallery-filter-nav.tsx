"use client";

import { LoaderCircleIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

interface GalleryCategory {
  readonly id: string;
  readonly name: string;
}

export interface GalleryFilterSelection {
  readonly categoryId?: string;
  readonly featuredOnly: boolean;
  readonly key: string;
  readonly label: string;
}

export function GalleryFilterNav({
  categories,
  onSelect,
  pendingKey = null,
  reserveSearchSpace = false,
  selectedKey,
}: Readonly<{
  categories: readonly GalleryCategory[];
  onSelect: (selection: GalleryFilterSelection) => void;
  pendingKey?: string | null;
  reserveSearchSpace?: boolean;
  selectedKey: string;
}>) {
  const items = useMemo<readonly GalleryFilterSelection[]>(
    () => [
      { key: "all", label: "全部", featuredOnly: false },
      { key: "featured", label: "精选", featuredOnly: true },
      ...categories.map((category) => ({
        key: category.id,
        label: category.name,
        categoryId: category.id,
        featuredOnly: false,
      })),
    ],
    [categories],
  );
  const navRef = useRef<HTMLElement>(null);
  const itemsRef = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);
  const [endSpacerWidth, setEndSpacerWidth] = useState(0);

  useEffect(() => {
    const nav = navRef.current;
    const itemRow = itemsRef.current;
    if (nav === null || itemRow === null) return;

    const measure = () => {
      const navRect = nav.getBoundingClientRect();
      const navStyle = window.getComputedStyle(nav);
      const paddingLeft = Number.parseFloat(navStyle.paddingLeft) || 0;
      const paddingRight = Number.parseFloat(navStyle.paddingRight) || 0;
      const contentLeft = navRect.left + paddingLeft;
      let contentRight = navRect.right - paddingRight;

      if (reserveSearchSpace) {
        const searchButton = Array.from(
          document.querySelectorAll<HTMLButtonElement>("#gallery-main button"),
        ).find((button) => button.querySelector("svg.lucide-search") !== null);
        const searchToolbar = searchButton?.parentElement ?? searchButton;

        if (searchToolbar !== undefined && searchToolbar !== null) {
          const searchRect = searchToolbar.getBoundingClientRect();
          const overlapsFilterBar = searchRect.bottom > navRect.top && searchRect.top < navRect.bottom;
          if (overlapsFilterBar && searchRect.width > 0) {
            contentRight = Math.min(contentRight, searchRect.left - 4);
          }
        }
      }

      const availableWidth = Math.max(0, contentRight - contentLeft);
      const itemWidth = itemRow.getBoundingClientRect().width;
      const nextScrollable = itemWidth > availableWidth + 1;
      const nextEndSpacerWidth = nextScrollable
        ? Math.max(0, navRect.right - paddingRight - contentRight)
        : 0;

      setScrollable((current) => (current === nextScrollable ? current : nextScrollable));
      setEndSpacerWidth((current) =>
        Math.abs(current - nextEndSpacerWidth) < 1 ? current : nextEndSpacerWidth,
      );

      if (!nextScrollable && nav.scrollLeft !== 0) nav.scrollLeft = 0;
    };

    measure();
    const frame = window.requestAnimationFrame(measure);
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(nav);
    resizeObserver.observe(itemRow);

    const searchButton = reserveSearchSpace
      ? Array.from(document.querySelectorAll<HTMLButtonElement>("#gallery-main button")).find(
          (button) => button.querySelector("svg.lucide-search") !== null,
        )
      : undefined;
    const searchToolbar = searchButton?.parentElement ?? searchButton;
    if (searchToolbar !== undefined && searchToolbar !== null) resizeObserver.observe(searchToolbar);

    window.addEventListener("resize", measure);
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [items, reserveSearchSpace]);

  return (
    <nav
      aria-label="相册筛选"
      className={cn(
        "sticky top-[var(--public-gallery-header-height)] z-30 -mx-2.5 -mt-2.5 mb-2 flex h-11 min-h-11 max-h-11 shrink-0 items-stretch gap-0 overflow-y-hidden border-b bg-background/92 px-2.5 backdrop-blur-xl supports-[backdrop-filter]:bg-background/82 sm:-mx-5 sm:-mt-3 sm:mb-3 sm:px-5 lg:-mx-8 lg:-mt-5 lg:h-14 lg:min-h-14 lg:max-h-14 lg:px-8 lg:bg-background/96 xl:-mx-10 xl:px-10 2xl:-mx-12 2xl:px-12",
        scrollable ? "overflow-x-auto" : "overflow-x-hidden",
      )}
      ref={navRef}
    >
      <div className="flex h-full shrink-0 items-stretch" ref={itemsRef}>
        {items.map((item) => {
          const active = selectedKey === item.key;
          const pending = pendingKey === item.key;
          return (
            <button
              aria-busy={pending || undefined}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex h-full shrink-0 touch-manipulation items-center justify-center gap-1.5 bg-transparent px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent after:transition-colors hover:text-foreground focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px] disabled:cursor-wait disabled:opacity-70 sm:px-3.5 lg:px-5 lg:text-[15px] lg:after:inset-x-3",
                active && "text-foreground after:bg-primary",
              )}
              disabled={pendingKey !== null}
              key={item.key}
              onClick={() => onSelect(item)}
              type="button"
            >
              {pending ? (
                <LoaderCircleIcon aria-hidden="true" className="size-3.5 animate-spin" />
              ) : null}
              {item.label}
            </button>
          );
        })}
      </div>
      {endSpacerWidth > 0 ? (
        <span aria-hidden="true" className="h-full shrink-0" style={{ width: endSpacerWidth }} />
      ) : null}
    </nav>
  );
}
