"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

interface TrendPoint {
  readonly at: string;
  readonly opens: number;
  readonly uniqueVisitors: number;
  readonly downloads: number;
}

const axisFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
});
const tooltipFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const chartConfig = {
  opens: { label: "浏览量", color: "var(--chart-1)" },
  uniqueVisitors: { label: "独立访客", color: "var(--chart-2)" },
  downloads: { label: "下载量", color: "var(--chart-3)" },
} satisfies ChartConfig;

export function AnalyticsTrendChart({ data }: Readonly<{ data: readonly TrendPoint[] }>) {
  if (data.length === 0) {
    return (
      <div className="flex min-h-56 items-center justify-center text-sm text-muted-foreground">
        暂无数据
      </div>
    );
  }

  return (
    <ChartContainer className="h-[270px] w-full aspect-auto" config={chartConfig}>
      <AreaChart accessibilityLayer data={[...data]} margin={{ left: 0, right: 8, top: 8 }}>
        <defs>
          <linearGradient id="fill-opens" x1="0" x2="0" y1="0" y2="1">
            <stop offset="5%" stopColor="var(--color-opens)" stopOpacity={0.28} />
            <stop offset="95%" stopColor="var(--color-opens)" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="fill-visitors" x1="0" x2="0" y1="0" y2="1">
            <stop offset="5%" stopColor="var(--color-uniqueVisitors)" stopOpacity={0.2} />
            <stop offset="95%" stopColor="var(--color-uniqueVisitors)" stopOpacity={0.01} />
          </linearGradient>
          <linearGradient id="fill-downloads" x1="0" x2="0" y1="0" y2="1">
            <stop offset="5%" stopColor="var(--color-downloads)" stopOpacity={0.16} />
            <stop offset="95%" stopColor="var(--color-downloads)" stopOpacity={0.01} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis
          axisLine={false}
          dataKey="at"
          minTickGap={28}
          tickFormatter={(value) => axisFormatter.format(new Date(String(value)))}
          tickLine={false}
          tickMargin={10}
        />
        <YAxis axisLine={false} tickLine={false} width={34} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              indicator="dot"
              labelFormatter={(_label, payload) => {
                const value = payload[0]?.payload?.at;
                return typeof value === "string" ? tooltipFormatter.format(new Date(value)) : "";
              }}
            />
          }
          cursor={false}
        />
        <Area
          dataKey="opens"
          fill="url(#fill-opens)"
          fillOpacity={1}
          isAnimationActive={false}
          stackId="a"
          stroke="var(--color-opens)"
          strokeWidth={2}
          type="monotone"
        />
        <Area
          dataKey="uniqueVisitors"
          fill="url(#fill-visitors)"
          fillOpacity={1}
          isAnimationActive={false}
          stackId="b"
          stroke="var(--color-uniqueVisitors)"
          strokeWidth={2}
          type="monotone"
        />
        <Area
          dataKey="downloads"
          fill="url(#fill-downloads)"
          fillOpacity={1}
          isAnimationActive={false}
          stackId="c"
          stroke="var(--color-downloads)"
          strokeWidth={2}
          type="monotone"
        />
        <ChartLegend content={<ChartLegendContent />} />
      </AreaChart>
    </ChartContainer>
  );
}
