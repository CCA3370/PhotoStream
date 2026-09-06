"use client";

import type { UserRole } from "@photostream/contracts";
import {
  ImagesIcon,
  LayoutDashboardIcon,
  LoaderCircleIcon,
  LogOutIcon,
  ScrollTextIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";

import { InternalProviders } from "@/components/internal-providers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { clientMutation } from "@/lib/client-api";

const navigation = [
  {
    href: "/studio",
    label: "仪表盘",
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
  if (pathname === "/studio") return "仪表盘";
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
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const visibleNavigation = navigation.filter((item) =>
    item.roles.some((allowedRole) => allowedRole === userRole),
  );
  const resolvedTitle = sectionTitle(pathname, pageTitle);
  const initials = userDisplayName.trim().slice(0, 1).toUpperCase() || "内";

  async function logout(): Promise<void> {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await clientMutation<{ ok: true }>("/api/v1/auth/logout");
    } finally {
      router.replace("/login");
      router.refresh();
      setLoggingOut(false);
    }
  }

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
              "--sidebar-width": "15.5rem",
              "--sidebar-width-icon": "3.75rem",
            } as CSSProperties
          }
        >
          <Sidebar collapsible="icon" variant="inset">
            <SidebarHeader className="p-2.5">
              <Link
                className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors hover:bg-sidebar-accent"
                href="/studio"
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
                  <ImagesIcon aria-hidden="true" className="size-4" />
                </div>
                <p className="min-w-0 truncate text-sm font-semibold group-data-[collapsible=icon]:hidden">
                  PhotoStream
                </p>
              </Link>
            </SidebarHeader>

            <SidebarContent className="px-1">
              <SidebarGroup className="pt-1">
                <SidebarGroupLabel>管理</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu className="gap-1">
                    {visibleNavigation.map((item) => {
                      const Icon = item.icon;
                      return (
                        <SidebarMenuItem key={item.href}>
                          <SidebarMenuButton
                            className="h-9 rounded-lg"
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

            <SidebarFooter className="p-2.5">
              <div className="flex items-center gap-2 rounded-xl border border-sidebar-border bg-sidebar-accent/35 p-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-0">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground group-data-[collapsible=icon]:hidden">
                  {initials}
                </div>
                <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                  <p className="truncate text-sm font-medium">{userDisplayName}</p>
                  <Badge className="mt-0.5 h-5 px-1.5 text-[10px]" variant="secondary">
                    {roleLabels[userRole]}
                  </Badge>
                </div>
                <Button
                  className="size-8 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:ring-destructive/25"
                  disabled={loggingOut}
                  onClick={() => void logout()}
                  size="icon-sm"
                  title="退出登录"
                  variant="ghost"
                >
                  {loggingOut ? (
                    <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
                  ) : (
                    <LogOutIcon aria-hidden="true" className="size-4" />
                  )}
                  <span className="sr-only">退出登录</span>
                </Button>
              </div>
            </SidebarFooter>
            <SidebarRail />
          </Sidebar>

          <SidebarInset
            className="min-w-0 overflow-hidden border border-sidebar-border/70 bg-background shadow-sm"
            id="studio-main"
            tabIndex={-1}
          >
            <header className="sticky top-0 z-20 flex min-h-12 items-center gap-2.5 border-b bg-background/94 px-3.5 backdrop-blur md:px-4">
              <SidebarTrigger aria-label="切换工作台导航" />
              <div className="h-4 w-px bg-border" />
              <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{resolvedTitle}</h1>
            </header>
            <div className="mx-auto flex w-full max-w-[1680px] flex-1 flex-col gap-3 p-3.5 md:p-4 xl:p-5">
              {children}
            </div>
          </SidebarInset>
        </SidebarProvider>
      </div>
    </InternalProviders>
  );
}
