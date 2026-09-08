"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface GalleryCategory {
  readonly id: string;
  readonly name: string;
}

interface FilterItem {
  readonly key: string;
  readonly label: string;
  readonly href: string;
}

interface IndicatorState {
  readonly x: number;
  readonly width: number;
  readonly ready: boolean;
}

export function GalleryFilterNav({
  categories,
  selectedKey,
  slug,
}: Readonly<{
  categories: readonly GalleryCategory[];
  selectedKey: string;
  slug: string;
}>) {
  const items = useMemo<readonly FilterItem[]>(
    () => [
      { key: "all", label: "全部", href: `/g/${slug}` },
      { key: "featured", label: "精选", href: `/g/${slug}?featured=1` },
      ...categories.map((category) => ({
        key: category.id,
        label: category.name,
        href: `/g/${slug}?category=${category.id}`,
      })),
    ],
    [categories, slug],
  );
  const [activeKey, setActiveKey] = useState(selectedKey);
  const [indicator, setIndicator] = useState<IndicatorState>({ x: 0, width: 0, ready: false });
  const navRef = useRef<HTMLElement>(null);
  const itemRefs = useRef(new Map<string, HTMLAnchorElement>());

  useEffect(() => {
    setActiveKey(selectedKey);
  }, [selectedKey]);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const active = itemRefs.current.get(activeKey);
    if (nav === null || active === undefined) return;

    const measure = () => {
      setIndicator({ x: active.offsetLeft, width: active.offsetWidth, ready: true });
    };
    const keepVisible = () => {
      const left = active.offsetLeft;
      const right = left + active.offsetWidth;
      const viewLeft = nav.scrollLeft;
      const viewRight = viewLeft + nav.clientWidth;
      const padding = 8;
      let nextLeft: number | null = null;
      if (left < viewLeft + padding) nextLeft = Math.max(0, left - padding);
      else if (right > viewRight - padding) nextLeft = right - nav.clientWidth + padding;
      if (nextLeft === null) return;
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      nav.scrollTo({ left: nextLeft, behavior: reduceMotion ? "auto" : "smooth" });
    };

    measure();
    keepVisible();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    observer.observe(active);
    return () => observer.disconnect();
  }, [activeKey]);

  return (
    <nav
      aria-label="相册筛选"
      className="sticky top-1.5 z-20 mb-2 flex gap-0.5 overflow-x-auto rounded-xl border bg-background/94 p-1 shadow-sm supports-backdrop-filter:backdrop-blur-xl sm:mb-3 sm:gap-1"
      ref={navRef}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute top-1 bottom-1 left-0 rounded-lg bg-primary shadow-sm transition-[width,transform,opacity] duration-250 ease-out motion-reduce:transition-none",
          indicator.ready ? "opacity-100" : "opacity-0",
        )}
        style={{ width: indicator.width, transform: `translateX(${indicator.x}px)` }}
      />
      {items.map((item) => {
        const active = activeKey === item.key;
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "relative z-10 h-8 shrink-0 touch-manipulation rounded-lg bg-transparent px-2.5 transition-colors duration-150 hover:bg-muted/55 sm:px-3",
              active &&
                "bg-transparent text-primary-foreground hover:bg-transparent hover:text-primary-foreground",
            )}
            href={item.href}
            key={item.key}
            onClick={() => setActiveKey(item.key)}
            ref={(element) => {
              if (element === null) itemRefs.current.delete(item.key);
              else itemRefs.current.set(item.key, element);
            }}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
