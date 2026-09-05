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
      roles: ["admin", "reviewer"],
    },
    {
      id: "upload",
      href: `/studio/albums/${albumId}/upload`,
      label: "上传",
      roles: ["admin", "uploader"],
    },
    {
      id: "review",
      href: `/studio/albums/${albumId}/review`,
      label: "审核",
      roles: ["admin", "reviewer"],
    },
    {
      id: "settings",
      href: `/studio/albums/${albumId}/settings`,
      label: "设置",
      roles: ["admin"],
    },
  ] as const;

  return (
    <nav aria-label="相册工作区" className="flex gap-1 overflow-x-auto border-b">
      {links
        .filter((link) => link.roles.some((allowed) => allowed === role))
        .map((link) => (
          <Link
            className={cn(
              "relative shrink-0 px-3 py-2 text-sm font-medium transition-colors",
              link.id === current
                ? "text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            href={link.href}
            key={link.id}
          >
            {link.label}
          </Link>
        ))}
    </nav>
  );
}
