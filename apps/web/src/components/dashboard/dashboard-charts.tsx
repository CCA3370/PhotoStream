"use client";

import type { AlbumSummaryView } from "@photostream/contracts";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

interface DailyPoint {
  readonly day: string;
  readonly opens: number;
  readonly uniqueVisitors: number;
  readonly downloads: number;
}

const shortDateFormatter = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" });

const trendConfig = {
  opens: { label: "浏览量", color: "var(--chart-1)" },
  uniqueVisitors: { label: "独立访客", color: "var(--chart-2)" },
  downloads: { label: "下载量", color: "var(--chart-3)" },
} satisfies ChartConfig;

function dateLabel(day: string): string {
  return shortDateFormatter.format(new Date(`${day}T00:00:00Z`));
}

export function AnalyticsTrendChart({ data }: Readonly<{ data: readonly DailyPoint[] }>) {
  if (data.length === 0) {
    return (
      <div className="flex min-h-72 items-center justify-center rounded-xl border border-dashed bg-muted/25 px-6 text-center text-sm text-muted-foreground">
        有访问或下载后，这里会显示最近 30 天趋势。
      </div>
    );
  }

  return (
    <ChartContainer className="min-h-[300px] w-full" config={trendConfig}>
      <AreaChart accessibilityLayer data={data} margin={{ left: 2, right: 12, top: 8 }}>
        <defs>
          <linearGradient id="opens-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="5%" stopColor="var(--color-opens)" stopOpacity={0.24} />
            <stop offset="95%" stopColor="var(--color-opens)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis
          axisLine={false}
          dataKey="day"
          minTickGap={32}
          tickFormatter={dateLabel}
          tickLine={false}
          tickMargin={10}
        />
        <YAxis axisLine={false} tickLine={false} width={32} />
        <ChartTooltip
          content={<ChartTooltipContent labelFormatter={(value) => dateLabel(String(value))} />}
          cursor={false}
        />
        <Area
          dataKey="opens"
          fill="url(#opens-fill)"
          fillOpacity={1}
          stroke="var(--color-opens)"
          strokeWidth={2.5}
          type="monotone"
        />
        <Area
          dataKey="uniqueVisitors"
          fill="transparent"
          stroke="var(--color-uniqueVisitors)"
          strokeWidth={2}
          type="monotone"
        />
        <Area
          dataKey="downloads"
          fill="transparent"
          stroke="var(--color-downloads)"
          strokeWidth={2}
          type="monotone"
        />
      </AreaChart>
    </ChartContainer>
  );
}

const stateMeta = {
  live: { label: "直播中", className: "bg-chart-2" },
  draft: { label: "草稿", className: "bg-chart-5" },
  ended: { label: "已结束", className: "bg-chart-3" },
  archived: { label: "已归档", className: "bg-chart-4" },
} as const;

export function AlbumStateChart({
  counts,
}: Readonly<{ counts: Record<AlbumSummaryView["state"], number> }>) {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);

  if (total === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">创建活动后会显示状态分布。</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex h-3 overflow-hidden rounded-full bg-muted">
        {(Object.keys(stateMeta) as AlbumSummaryView["state"][]).map((state) =>
          counts[state] === 0 ? null : (
            <div
              className={stateMeta[state].className}
              key={state}
              style={{ width: `${(counts[state] / total) * 100}%` }}
              title={`${stateMeta[state].label} ${counts[state]}`}
            />
          ),
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {(Object.keys(stateMeta) as AlbumSummaryView["state"][]).map((state) => (
          <div className="rounded-xl border bg-background/70 p-3" key={state}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className={`size-2 rounded-full ${stateMeta[state].className}`} />
              {stateMeta[state].label}
            </div>
            <p className="mt-1 text-xl font-semibold tabular-nums">{counts[state]}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
