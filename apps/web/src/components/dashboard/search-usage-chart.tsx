"use client";

import {
  ShadcnChart,
  type ShadcnChartPoint,
  type ShadcnChartSeries,
} from "@/components/dashboard/shadcn-chart";

interface SearchUsagePoint {
  readonly at: string;
  readonly number: number;
  readonly attributes: number;
  readonly face: number;
}

const numberFormatter = new Intl.NumberFormat("zh-CN");

const series: readonly ShadcnChartSeries[] = [
  { key: "number", label: "号码", color: "var(--chart-1)" },
  { key: "attributes", label: "年级班级", color: "var(--chart-2)" },
  { key: "face", label: "人脸", color: "var(--chart-4)" },
];

export function SearchUsageChart({ data }: Readonly<{ data: readonly SearchUsagePoint[] }>) {
  const points: readonly ShadcnChartPoint[] = data.map((item) => ({
    at: item.at,
    number: item.number,
    attributes: item.attributes,
    face: item.face,
  }));

  return (
    <ShadcnChart
      ariaLabel="号码、年级班级和人脸找图使用量趋势"
      data={points}
      emptyLabel="暂无找图使用数据"
      mode="line"
      series={series}
      valueFormatter={(value) => numberFormatter.format(Math.round(value))}
    />
  );
}
