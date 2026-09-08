"use client";

import { useId } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";

import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

export interface ShadcnChartPoint {
  readonly at: string;
  readonly [key: string]: string | number | null;
}

export interface ShadcnChartSeries {
  readonly key: string;
  readonly label: string;
  readonly color: string;
}

type ChartMode = "area" | "line" | "stacked-bar";

const axisFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  hour12: false,
});
const tooltipFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function valueAt(point: ShadcnChartPoint, key: string): number | null {
  const value = point[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeData(
  data: readonly ShadcnChartPoint[],
  series: readonly ShadcnChartSeries[],
  fixedMax?: number,
): ShadcnChartPoint[] {
  return data.map((point) => {
    const normalized: Record<string, string | number | null> = { at: point.at };
    for (const item of series) {
      const value = valueAt(point, item.key);
      normalized[item.key] =
        value === null ? null : Math.min(Math.max(value, 0), fixedMax ?? Number.POSITIVE_INFINITY);
    }
    return normalized as ShadcnChartPoint;
  });
}

function buildConfig(series: readonly ShadcnChartSeries[]): ChartConfig {
  return Object.fromEntries(
    series.map((item) => [item.key, { label: item.label, color: item.color }]),
  );
}

function axisLabel(value: unknown): string {
  if (typeof value !== "string") return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : axisFormatter.format(date);
}

function tooltipLabel(value: unknown): string {
  if (typeof value !== "string") return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : tooltipFormatter.format(date);
}

const chartClassName =
  "aspect-auto h-[250px] w-full [&_.recharts-surface:focus]:outline-none [&_.recharts-surface:focus-visible]:outline-none";

export function ShadcnChart({
  data,
  series,
  mode,
  valueFormatter,
  ariaLabel,
  emptyLabel,
  fixedMax,
}: Readonly<{
  data: readonly ShadcnChartPoint[];
  series: readonly ShadcnChartSeries[];
  mode: ChartMode;
  valueFormatter: (value: number) => string;
  ariaLabel: string;
  emptyLabel: string;
  fixedMax?: number;
}>) {
  const gradientId = useId().replace(/:/gu, "");

  if (data.length === 0) {
    return (
      <div className="flex min-h-[250px] items-center justify-center text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }

  const chartData = normalizeData(data, series, fixedMax);
  const chartConfig = buildConfig(series);
  const yDomain: [number, number | "auto"] = [0, fixedMax ?? "auto"];
  const showLegend = series.length > 1;
  const tooltip = (
    <ChartTooltip
      cursor={false}
      content={
        <ChartTooltipContent
          indicator="dot"
          labelFormatter={tooltipLabel}
          formatter={(value, name, item) => {
            const key = String(item.dataKey ?? name);
            const config = chartConfig[key];
            const number = typeof value === "number" ? value : Number(value);
            return (
              <>
                <span
                  className="size-2 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-muted-foreground">{config?.label ?? String(name)}</span>
                <span className="ml-auto font-mono font-medium text-foreground tabular-nums">
                  {Number.isFinite(number) ? valueFormatter(number) : "—"}
                </span>
              </>
            );
          }}
        />
      }
    />
  );
  const xAxis = (
    <XAxis
      dataKey="at"
      tickLine={false}
      axisLine={false}
      tickMargin={8}
      minTickGap={32}
      tickFormatter={axisLabel}
    />
  );
  const yAxis = <YAxis hide domain={yDomain} allowDataOverflow />;
  const legend = showLegend ? (
    <ChartLegend content={<ChartLegendContent />} itemSorter={null} />
  ) : null;

  if (mode === "area") {
    return (
      <ChartContainer
        aria-label={ariaLabel}
        className={chartClassName}
        config={chartConfig}
        role="img"
      >
        <AreaChart accessibilityLayer data={chartData} margin={{ left: 12, right: 12 }}>
          <defs>
            {series.map((item) => (
              <linearGradient
                id={`${gradientId}-${item.key}`}
                key={item.key}
                x1="0"
                x2="0"
                y1="0"
                y2="1"
              >
                <stop offset="5%" stopColor={`var(--color-${item.key})`} stopOpacity={0.8} />
                <stop offset="95%" stopColor={`var(--color-${item.key})`} stopOpacity={0.1} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} />
          {xAxis}
          {yAxis}
          {tooltip}
          {series.map((item) => (
            <Area
              baseValue={0}
              dataKey={item.key}
              fill={`url(#${gradientId}-${item.key})`}
              fillOpacity={0.4}
              key={item.key}
              stroke={`var(--color-${item.key})`}
              strokeWidth={2}
              type="monotone"
            />
          ))}
          {legend}
        </AreaChart>
      </ChartContainer>
    );
  }

  if (mode === "stacked-bar") {
    return (
      <ChartContainer
        aria-label={ariaLabel}
        className={chartClassName}
        config={chartConfig}
        role="img"
      >
        <BarChart accessibilityLayer data={chartData} margin={{ left: 12, right: 12 }}>
          <CartesianGrid vertical={false} />
          {xAxis}
          {yAxis}
          {tooltip}
          {legend}
          {series.map((item, index) => (
            <Bar
              dataKey={item.key}
              fill={`var(--color-${item.key})`}
              key={item.key}
              radius={index === 0 ? [0, 0, 4, 4] : index === series.length - 1 ? [4, 4, 0, 0] : 0}
              stackId="a"
            />
          ))}
        </BarChart>
      </ChartContainer>
    );
  }

  return (
    <ChartContainer
      aria-label={ariaLabel}
      className={chartClassName}
      config={chartConfig}
      role="img"
    >
      <LineChart accessibilityLayer data={chartData} margin={{ left: 12, right: 12 }}>
        <CartesianGrid vertical={false} />
        {xAxis}
        {yAxis}
        {tooltip}
        {series.map((item) => (
          <Line
            dataKey={item.key}
            dot={false}
            key={item.key}
            stroke={`var(--color-${item.key})`}
            strokeWidth={2}
            type="monotone"
          />
        ))}
        {legend}
      </LineChart>
    </ChartContainer>
  );
}
