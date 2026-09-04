"use client";

import type { UserRole } from "@photostream/contracts";
import {
  ImagesIcon,
  LayoutDashboardIcon,
  ScrollTextIcon,
  Settings2Icon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";

import { InternalProviders } from "@/components/internal-providers";
import { Badge } from "@/components/ui/badge";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";

const navigation = [
  {
    href: "/studio",
    label: "首页",
    icon: LayoutDashboardIcon,
    roles: ["admin", "reviewer", "uploader"],
  },
  {
    href: "/studio/albums",
    label: "活动",
    icon: ImagesIcon,
    roles: ["admin", "reviewer", "uploader"],
  },
  { href: "/studio/users", label: "成员", icon: UsersIcon, roles: ["admin"] },
  { href: "/studio/audit", label: "审计", icon: ScrollTextIcon, roles: ["admin"] },
] as const satisfies ReadonlyArray<{
  readonly href: string;
  readonly label: string;
  readonly icon: typeof LayoutDashboardIcon;
  readonly roles: readonly UserRole[];
}>;

const roleLabels: Record<UserRole, string> = {
  admin: "管理员",
  reviewer: "审核员",
  uploader: "上传员",
};

export interface StudioShellProps {
  readonly children: ReactNode;
  readonly pageTitle: string;
  readonly userRole?: UserRole;
  readonly userDisplayName?: string;
}

function isNavigationActive(pathname: string, href: string): boolean {
  if (href === "/studio") return pathname === "/studio";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function sectionTitle(pathname: string, fallback: string): string {
  if (pathname === "/studio") return "首页";
  if (pathname.startsWith("/studio/albums")) return "活动管理";
  if (pathname.startsWith("/studio/users")) return "成员管理";
  if (pathname.startsWith("/studio/audit")) return "审计日志";
  return fallback;
}

export function StudioShell({
  children,
  pageTitle,
  userDisplayName = "内部成员",
  userRole = "admin",
}: StudioShellProps) {
  const pathname = usePathname();
  const visibleNavigation = navigation.filter((item) =>
    item.roles.some((allowedRole) => allowedRole === userRole),
  );
  const resolvedTitle = sectionTitle(pathname, pageTitle);
  const initials = userDisplayName.trim().slice(0, 1).toUpperCase() || "内";

  return (
    <InternalProviders>
      <div className="workbench-theme min-h-screen bg-sidebar text-foreground">
        <a
          className="sr-only rounded-lg bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
          href="#studio-main"
        >
          跳到主要内容
        </a>
        <SidebarProvider
          style={
            {
              "--sidebar-width": "16.5rem",
              "--sidebar-width-icon": "4.25rem",
            } as CSSProperties
          }
        >
          <Sidebar collapsible="icon" variant="inset">
            <SidebarHeader className="p-3">
              <Link
                className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-sidebar-accent"
                href="/studio"
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                  <ImagesIcon aria-hidden="true" className="size-5" />
                </div>
                <div className="min-w-0 group-data-[collapsible=icon]:hidden">
                  <p className="truncate text-sm font-semibold">PhotoStream</p>
                  <p className="truncate text-xs text-sidebar-foreground/60">中学部影像直播</p>
                </div>
              </Link>
            </SidebarHeader>

            <SidebarContent className="px-1">
              <SidebarGroup>
                <SidebarGroupLabel>管理</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {visibleNavigation.map((item) => {
                      const Icon = item.icon;
                      return (
                        <SidebarMenuItem key={item.href}>
                          <SidebarMenuButton
                            className="h-10 rounded-xl"
                            isActive={isNavigationActive(pathname, item.href)}
                            render={<Link href={item.href} />}
                            tooltip={item.label}
                          >
                            <Icon aria-hidden="true" />
                            <span>{item.label}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>

            <SidebarFooter className="p-3">
              <div className="flex items-center gap-3 rounded-xl border border-sidebar-border bg-sidebar-accent/45 p-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-0">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground">
                  {initials}
                </div>
                <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                  <p className="truncate text-sm font-medium">{userDisplayName}</p>
                  <div className="mt-0.5 flex items-center gap-2">
                    <Badge className="h-5 px-1.5 text-[10px]" variant="secondary">
                      {roleLabels[userRole]}
                    </Badge>
                  </div>
                </div>
              </div>
            </SidebarFooter>
            <SidebarRail />
          </Sidebar>

          <SidebarInset
            className="overflow-hidden border border-sidebar-border/70 bg-background shadow-sm"
            id="studio-main"
          >
            <header className="sticky top-0 z-20 flex min-h-16 items-center gap-3 border-b bg-background/92 px-4 backdrop-blur md:px-6">
              <SidebarTrigger aria-label="切换工作台导航" />
              <div className="h-5 w-px bg-border" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">PhotoStream 管理后台</p>
                <h1 className="truncate text-base font-semibold">{resolvedTitle}</h1>
              </div>
              <div className="hidden items-center gap-2 rounded-full border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground sm:flex">
                <Settings2Icon aria-hidden="true" className="size-3.5" />
                {roleLabels[userRole]}
              </div>
            </header>
            <div className="mx-auto flex w-full max-w-[1680px] flex-1 flex-col gap-6 p-4 md:p-6 xl:p-8">
              {children}
            </div>
          </SidebarInset>
        </SidebarProvider>
      </div>
    </InternalProviders>
  );
}
