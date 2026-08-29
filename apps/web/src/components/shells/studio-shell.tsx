"use client";

import type { UserRole } from "@photostream/contracts";
import { CalendarDaysIcon, ImagesIcon, ScrollTextIcon, UsersIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";

import { InternalProviders } from "@/components/internal-providers";
import {
  Sidebar,
  SidebarContent,
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
    label: "活动",
    icon: CalendarDaysIcon,
    roles: ["admin", "reviewer", "uploader"],
  },
  { href: "/studio/users", label: "成员", icon: UsersIcon, roles: ["admin"] },
  { href: "/studio/audit", label: "审计", icon: ScrollTextIcon, roles: ["admin"] },
] as const satisfies ReadonlyArray<{
  readonly href: string;
  readonly label: string;
  readonly icon: typeof CalendarDaysIcon;
  readonly roles: readonly UserRole[];
}>;

export interface StudioShellProps {
  readonly children: ReactNode;
  readonly pageTitle: string;
  readonly userRole?: UserRole;
  readonly userDisplayName?: string;
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

  return (
    <InternalProviders>
      <div className="workbench-theme min-h-screen bg-background text-foreground">
        <a
          className="sr-only rounded-lg bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
          href="#studio-main"
        >
          跳到主要内容
        </a>
        <SidebarProvider
          style={
            {
              "--sidebar-width": "15rem",
              "--sidebar-width-icon": "4.5rem",
            } as CSSProperties
          }
        >
          <Sidebar collapsible="icon">
            <SidebarHeader>
              <div className="flex items-center gap-2 px-2 py-3">
                <ImagesIcon aria-hidden="true" />
                <div className="min-w-0 group-data-[collapsible=icon]:hidden">
                  <p className="truncate text-sm font-semibold">中学部影像直播</p>
                  <p className="truncate text-xs text-muted-foreground">内部工作台</p>
                </div>
              </div>
            </SidebarHeader>
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupLabel>工作台</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {visibleNavigation.map((item) => {
                      const Icon = item.icon;
                      const active =
                        item.href === "/studio"
                          ? pathname === item.href || pathname.startsWith("/studio/albums/")
                          : pathname.startsWith(item.href);
                      return (
                        <SidebarMenuItem key={item.href}>
                          <SidebarMenuButton
                            isActive={active}
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
            <SidebarRail />
          </Sidebar>
          <SidebarInset id="studio-main">
            <header className="flex min-h-14 items-center gap-3 border-b px-4 md:px-6">
              <SidebarTrigger aria-label="切换工作台导航" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">活动工作台</p>
                <h1 className="truncate text-xl font-semibold">{pageTitle}</h1>
              </div>
              <p className="hidden text-sm text-muted-foreground sm:block">{userDisplayName}</p>
            </header>
            <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-6 p-4 md:p-6">
              {children}
            </div>
          </SidebarInset>
        </SidebarProvider>
      </div>
    </InternalProviders>
  );
}
