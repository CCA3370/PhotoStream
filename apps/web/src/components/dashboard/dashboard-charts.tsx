"use client";

import {
  ShadcnChart,
  type ShadcnChartPoint,
  type ShadcnChartSeries,
} from "@/components/dashboard/shadcn-chart";

interface TrendPoint {
  readonly at: string;
  readonly opens: number;
  readonly uniqueVisitors: number;
  readonly downloads: number;
}

const numberFormatter = new Intl.NumberFormat("zh-CN");

const series: readonly ShadcnChartSeries[] = [
  { key: "opens", label: "浏览量", color: "var(--chart-1)" },
  { key: "uniqueVisitors", label: "独立访客", color: "var(--chart-2)" },
  { key: "downloads", label: "下载量", color: "var(--chart-3)" },
];

export function AnalyticsTrendChart({ data }: Readonly<{ data: readonly TrendPoint[] }>) {
  const points: readonly ShadcnChartPoint[] = data.map((item) => ({
    at: item.at,
    opens: item.opens,
    uniqueVisitors: item.uniqueVisitors,
    downloads: item.downloads,
  }));

  return (
    <ShadcnChart
      ariaLabel="浏览量、独立访客和下载量趋势"
      data={points}
      emptyLabel="暂无数据"
      mode="area"
      series={series}
      valueFormatter={(value) => numberFormatter.format(Math.round(value))}
    />
  );
}
