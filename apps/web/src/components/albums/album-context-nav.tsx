import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
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
      label: "概览/媒体",
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
      label: "设置/统计",
      roles: ["admin"],
    },
  ] as const;
  return (
    <nav aria-label="相册工作区" className="flex gap-1 overflow-x-auto border-b pb-2">
      {links
        .filter((link) => link.roles.some((allowed) => allowed === role))
        .map((link) => (
          <Link
            className={cn(
              buttonVariants({ variant: link.id === current ? "secondary" : "ghost" }),
              "min-h-11 shrink-0",
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
