import type { AlbumView } from "@photostream/contracts";
import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";

const stateLabels: Record<AlbumView["state"], string> = {
  draft: "草稿",
  live: "直播中",
  ended: "已结束",
  archived: "已归档",
  deleting: "删除中",
};

function stateVariant(state: AlbumView["state"]): "default" | "outline" | "secondary" {
  if (state === "live") return "default";
  if (state === "archived") return "outline";
  return "secondary";
}

export function AlbumWorkspaceHeader({
  actions,
  albumHref,
  albumId,
  description,
  headingId,
  metrics,
  section,
  state,
  title,
}: Readonly<{
  actions?: ReactNode | undefined;
  albumHref?: string | null | undefined;
  albumId: string;
  description?: string | null | undefined;
  headingId: string;
  metrics?: readonly { readonly label: string; readonly value: string | number }[] | undefined;
  section: string;
  state?: AlbumView["state"] | undefined;
  title: string;
}>) {
  return (
    <header className="flex flex-col gap-3">
      <nav
        aria-label="面包屑"
        className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
      >
        <Link className="shrink-0 hover:text-foreground" href="/studio/albums">
          活动
        </Link>
        <ChevronRightIcon className="size-3 shrink-0" aria-hidden="true" />
        {albumHref === null ? (
          <span className="truncate">{title}</span>
        ) : (
          <Link
            className="truncate hover:text-foreground"
            href={albumHref ?? `/studio/albums/${albumId}`}
          >
            {title}
          </Link>
        )}
        <ChevronRightIcon className="size-3 shrink-0" aria-hidden="true" />
        <span className="shrink-0 text-foreground">{section}</span>
      </nav>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-xl font-semibold tracking-tight" id={headingId}>
              {title}
            </h2>
            {state === undefined ? null : (
              <Badge variant={stateVariant(state)}>{stateLabels[state]}</Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs font-medium text-muted-foreground">{section}</p>
          {description ? (
            <p className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground">{description}</p>
          ) : null}
          {metrics === undefined || metrics.length === 0 ? null : (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {metrics.map((metric) => (
                <span key={metric.label}>
                  <span className="font-medium tabular-nums text-foreground">{metric.value}</span>{" "}
                  {metric.label}
                </span>
              ))}
            </div>
          )}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}
