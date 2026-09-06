import { LayoutDashboardIcon, SearchIcon, SettingsIcon, UploadIcon } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

export function AlbumContextNav({
  albumId,
  current,
  role,
}: Readonly<{
  albumId: string;
  current: "overview" | "review" | "settings" | "upload";
  role: "admin" | "reviewer" | "uploader";
}>) {
  const links = [
    {
      id: "overview",
      href: `/studio/albums/${albumId}`,
      label: "概览",
      icon: LayoutDashboardIcon,
      roles: ["admin", "reviewer"],
    },
    {
      id: "upload",
      href: `/studio/albums/${albumId}/upload`,
      label: "上传",
      icon: UploadIcon,
      roles: ["admin", "uploader"],
    },
    {
      id: "review",
      href: `/studio/albums/${albumId}/review`,
      label: "审核",
      icon: SearchIcon,
      roles: ["admin", "reviewer"],
    },
    {
      id: "settings",
      href: `/studio/albums/${albumId}/settings`,
      label: "设置",
      icon: SettingsIcon,
      roles: ["admin"],
    },
  ] as const;

  return (
    <nav
      aria-label="活动工作区"
      className="flex max-w-full gap-1 overflow-x-auto rounded-xl border bg-muted/30 p-1"
    >
      {links
        .filter((link) => link.roles.some((allowed) => allowed === role))
        .map((link) => {
          const Icon = link.icon;
          const active = link.id === current;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors",
                active
                  ? "bg-background text-foreground shadow-sm ring-1 ring-border/70"
                  : "text-muted-foreground hover:bg-background/65 hover:text-foreground",
              )}
              href={link.href}
              key={link.id}
            >
              <Icon aria-hidden="true" className="size-3.5" />
              {link.label}
            </Link>
          );
        })}
    </nav>
  );
}
