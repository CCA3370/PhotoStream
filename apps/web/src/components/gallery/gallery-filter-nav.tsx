"use client";

import Link from "next/link";
import { useMemo } from "react";

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
        "sticky top-[var(--public-gallery-header-height)] z-30 -mx-2.5 mb-2 flex min-h-10 gap-0.5 overflow-x-auto border-b bg-background/95 px-2.5 py-1 backdrop-blur-md supports-[backdrop-filter]:bg-background/88 sm:-mx-5 sm:mb-3 sm:gap-1 sm:px-5 lg:-mx-7 lg:px-7",
        reserveSearchSpace && "pr-28 sm:pr-30 lg:pr-32",
      )}
    >
      {items.map((item) => {
        const active = selectedKey === item.key;
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "h-8 shrink-0 touch-manipulation rounded-lg px-2.5 transition-colors duration-150 hover:bg-muted/55 sm:px-3",
              active &&
                "bg-primary text-primary-foreground shadow-xs hover:bg-primary hover:text-primary-foreground",
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
