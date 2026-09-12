"use client";

import Link from "next/link";
import { useMemo } from "react";

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

export function GalleryFilterNav({
  categories,
  reserveSearchSpace = false,
  selectedKey,
  slug,
}: Readonly<{
  categories: readonly GalleryCategory[];
  reserveSearchSpace?: boolean;
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

  return (
    <nav
      aria-label="相册筛选"
      className={cn(
        "sticky top-[var(--public-gallery-header-height)] z-30 -mx-2.5 -mt-2.5 mb-2 flex h-11 items-stretch gap-0 overflow-x-auto border-b bg-background/92 px-2.5 backdrop-blur-xl supports-[backdrop-filter]:bg-background/82 sm:-mx-5 sm:-mt-3 sm:mb-3 sm:px-5 lg:-mx-8 lg:-mt-5 lg:h-14 lg:px-8 lg:bg-background/96 xl:-mx-10 xl:px-10 2xl:-mx-12 2xl:px-12",
        reserveSearchSpace && "pr-28 sm:pr-30 lg:pr-8 xl:pr-10 2xl:pr-12",
      )}
    >
      {items.map((item) => {
        const active = selectedKey === item.key;
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex h-full shrink-0 touch-manipulation items-center justify-center px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent after:transition-colors hover:text-foreground focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px] sm:px-3.5 lg:px-5 lg:text-[15px] lg:after:inset-x-3",
              active && "text-foreground after:bg-primary",
            )}
            href={item.href}
            key={item.key}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
