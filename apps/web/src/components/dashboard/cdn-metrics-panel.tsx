"use client";

import { type PointerEvent as ReactPointerEvent, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface CdnPoint {
  readonly at: string;
  readonly trafficBytes: number;
  readonly bandwidthBps: number;
  readonly originTrafficBytes: number;
  readonly byteHitRate: number | null;
  readonly requestHitRate: number | null;
  readonly http2xx: number;
  readonly http3xx: number;
  readonly http4xx: number;
  readonly http5xx: number;
}

export interface CdnMetricsData {
  readonly status: "ok" | "partial" | "unavailable" | "error";
  readonly domain: string | null;
  readonly intervalSeconds: number;
  readonly dataDelaySeconds: number;
  readonly trafficBytes: number;
  readonly originTrafficBytes: number;
  readonly peakBandwidthBps: number;
  readonly averageByteHitRate: number | null;
  readonly averageRequestHitRate: number | null;
  readonly requests: number;
  readonly errorRequests: number;
  readonly points: readonly CdnPoint[];
  readonly message: string | null;
}

interface Series {
  readonly key: keyof CdnPoint;
  readonly label: string;
  readonly color: string;
}

interface HoverState {
  readonly index: number;
  readonly x: number;
}

const numberFormatter = new Intl.NumberFormat("zh-CN");
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
const chartWidth = 760;
const chartHeight = 250;
const plot = { left: 54, right: 18, top: 18, bottom: 42 } as const;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function formatBps(bps: number): string {
  if (bps < 1_000) return `${Math.round(bps)} bps`;
  const units = ["Kbps", "Mbps", "Gbps", "Tbps"];
  let value = bps / 1_000;
  let index = 0;
  while (value >= 1_000 && index < units.length - 1) {
    value /= 1_000;
    index += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(value >= 10 ? 1 : 2)}%`;
}

function delayLabel(seconds: number): string {
  if (seconds <= 0) return "";
  if (seconds >= 60 * 60) return `约 ${Math.round(seconds / 3600)} 小时延迟`;
  return `约 ${Math.round(seconds / 60)} 分钟延迟`;
}

function numericValue(point: CdnPoint, key: keyof CdnPoint): number | null {
  const value = point[key];
  return typeof value === "number" ? value : null;
}

function chartPoint(value: number, max: number, index: number, count: number): [number, number] {
  const width = chartWidth - plot.left - plot.right;
  const height = chartHeight - plot.top - plot.bottom;
  const x = count <= 1 ? plot.left + width / 2 : plot.left + (index / (count - 1)) * width;
  const y = plot.top + height - (value / Math.max(max, 1)) * height;
  return [x, y];
}

function linePath(data: readonly CdnPoint[], key: keyof CdnPoint, max: number): string {
  let path = "";
  let drawing = false;
  data.forEach((item, index) => {
    const value = numericValue(item, key);
    if (value === null) {
      drawing = false;
      return;
    }
    const [x, y] = chartPoint(value, max, index, data.length);
    path += `${drawing ? " L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
    drawing = true;
  });
  return path;
}

function MetricChart({
  data,
  series,
  valueFormatter,
  fixedMax,
}: Readonly<{
  data: readonly CdnPoint[];
  series: readonly Series[];
  valueFormatter: (value: number) => string;
  fixedMax?: number;
}>) {
  const [hover, setHover] = useState<HoverState | null>(null);
  if (data.length === 0) {
    return (
      <div className="flex min-h-52 items-center justify-center text-sm text-muted-foreground">
        暂无 CDN 监控数据
      </div>
    );
  }

  const max =
    fixedMax ??
    Math.max(
      1,
      ...series.flatMap((item) =>
        data.flatMap((point) => {
          const value = numericValue(point, item.key);
          return value === null ? [] : [value];
        }),
      ),
    );
  const bottom = chartHeight - plot.bottom;
  const active = hover === null ? null : (data[hover.index] ?? null);
  const xLabels = Array.from(
    new Set([0, Math.floor((data.length - 1) / 2), Math.max(data.length - 1, 0)]),
  );

  function pointerMove(event: ReactPointerEvent<SVGSVGElement>): void {
    const matrix = event.currentTarget.getScreenCTM();
    if (matrix === null) return;
    const cursor = event.currentTarget.createSVGPoint();
    cursor.x = event.clientX;
    cursor.y = event.clientY;
    const svgPoint = cursor.matrixTransform(matrix.inverse());
    const x = Math.min(chartWidth - plot.right, Math.max(plot.left, svgPoint.x));
    const ratio = (x - plot.left) / Math.max(chartWidth - plot.left - plot.right, 1);
    const index = Math.round(ratio * Math.max(data.length - 1, 0));
    setHover({ index, x });
  }

  return (
    <div className="relative w-full">
      <svg
        className="h-[230px] w-full touch-none select-none"
        onPointerLeave={() => setHover(null)}
        onPointerMove={pointerMove}
        role="img"
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
      >
        <title>CDN 资源监控趋势</title>
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = plot.top + (1 - ratio) * (bottom - plot.top);
          return (
            <g key={ratio}>
              <line
                stroke="var(--border)"
                strokeDasharray="3 4"
                strokeOpacity="0.58"
                x1={plot.left}
                x2={chartWidth - plot.right}
                y1={y}
                y2={y}
              />
              <text
                fill="var(--muted-foreground)"
                fontSize="10"
                textAnchor="end"
                x={plot.left - 8}
                y={y + 3}
              >
                {valueFormatter(max * ratio)}
              </text>
            </g>
          );
        })}

        {series.map((item) => (
          <path
            d={linePath(data, item.key, max)}
            fill="none"
            key={item.key}
            stroke={item.color}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.2"
          />
        ))}

        {hover === null ? null : (
          <line
            stroke="var(--foreground)"
            strokeOpacity="0.34"
            x1={hover.x}
            x2={hover.x}
            y1={plot.top}
            y2={bottom}
          />
        )}

        {xLabels.map((index) => {
          const [x] = chartPoint(0, max, index, data.length);
          const value = data[index]?.at;
          return (
            <text
              fill="var(--muted-foreground)"
              fontSize="10"
              key={index}
              textAnchor={index === 0 ? "start" : index === data.length - 1 ? "end" : "middle"}
              x={x}
              y={chartHeight - 12}
            >
              {value === undefined ? "" : axisFormatter.format(new Date(value))}
            </text>
          );
        })}
      </svg>

      <div className="mt-0.5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
        {series.map((item) => (
          <span className="inline-flex items-center gap-1.5" key={item.key}>
            <span className="size-2 rounded-[2px]" style={{ background: item.color }} />
            {item.label}
          </span>
        ))}
      </div>

      {active !== null && hover !== null ? (
        <div
          className="pointer-events-none absolute top-3 z-10 min-w-44 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
          style={{
            left: `${(hover.x / chartWidth) * 100}%`,
            transform:
              hover.x < 160
                ? "translateX(0)"
                : hover.x > chartWidth - 160
                  ? "translateX(-100%)"
                  : "translateX(-50%)",
          }}
        >
          <p className="mb-2 font-medium">{tooltipFormatter.format(new Date(active.at))}</p>
          <div className="grid grid-cols-[1fr_auto] gap-x-5 gap-y-1.5">
            {series.map((item) => {
              const value = numericValue(active, item.key);
              return (
                <span className="contents" key={item.key}>
                  <span className="text-muted-foreground">{item.label}</span>
                  <span className="font-mono font-medium tabular-nums">
                    {value === null ? "—" : valueFormatter(value)}
                  </span>
                </span>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const trafficSeries: readonly Series[] = [
  { key: "trafficBytes", label: "CDN 流量", color: "var(--chart-1)" },
  { key: "originTrafficBytes", label: "回源流量", color: "var(--chart-3)" },
];
const bandwidthSeries: readonly Series[] = [
  { key: "bandwidthBps", label: "带宽", color: "var(--chart-2)" },
];
const hitRateSeries: readonly Series[] = [
  { key: "byteHitRate", label: "字节命中率", color: "var(--chart-1)" },
  { key: "requestHitRate", label: "请求命中率", color: "var(--chart-2)" },
];
const statusSeries: readonly Series[] = [
  { key: "http2xx", label: "2xx", color: "var(--chart-1)" },
  { key: "http3xx", label: "3xx", color: "var(--chart-2)" },
  { key: "http4xx", label: "4xx", color: "var(--chart-4)" },
  { key: "http5xx", label: "5xx", color: "var(--chart-5)" },
];

export function CdnMetricsPanel({ data }: Readonly<{ data: CdnMetricsData }>) {
  const errorRate = data.requests === 0 ? 0 : (data.errorRequests / data.requests) * 100;
  const summaries = [
    ["CDN 流量", formatBytes(data.trafficBytes)],
    ["回源流量", formatBytes(data.originTrafficBytes)],
    ["峰值带宽", formatBps(data.peakBandwidthBps)],
    ["字节命中率", formatPercent(data.averageByteHitRate)],
    ["请求数", numberFormatter.format(data.requests)],
    ["4xx/5xx", `${errorRate.toFixed(errorRate >= 10 ? 1 : 2)}%`],
  ] as const;

  return (
    <Card className="overflow-hidden shadow-none">
      <CardHeader className="gap-3 border-b py-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>CDN 资源监控</CardTitle>
              {data.status === "partial" ? <Badge variant="outline">部分数据</Badge> : null}
              {data.domain === null ? null : (
                <span className="truncate text-xs text-muted-foreground">{data.domain}</span>
              )}
            </div>
            {data.dataDelaySeconds <= 0 ? null : (
              <p className="mt-1 text-[11px] text-muted-foreground">
                阿里云监控数据 · {delayLabel(data.dataDelaySeconds)}
              </p>
            )}
          </div>
        </div>
      </CardHeader>

      {data.status === "unavailable" || (data.status === "error" && data.points.length === 0) ? (
        <CardContent className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
          {data.message ?? "CDN 监控数据暂不可用"}
        </CardContent>
      ) : (
        <Tabs className="gap-0" defaultValue="traffic">
          <div className="grid grid-cols-2 gap-px border-b bg-border sm:grid-cols-3 xl:grid-cols-6">
            {summaries.map(([label, value]) => (
              <div className="bg-card px-3 py-2.5" key={label}>
                <p className="text-[11px] text-muted-foreground">{label}</p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums">{value}</p>
              </div>
            ))}
          </div>
          <div className="flex justify-end border-b px-3 py-2">
            <TabsList className="gap-1 p-1">
              <TabsTrigger value="traffic">流量</TabsTrigger>
              <TabsTrigger value="bandwidth">带宽</TabsTrigger>
              <TabsTrigger value="hit-rate">命中率</TabsTrigger>
              <TabsTrigger value="status">状态码</TabsTrigger>
            </TabsList>
          </div>
          <CardContent className="px-3 pt-3 pb-2 sm:px-5">
            <TabsContent value="traffic">
              <MetricChart data={data.points} series={trafficSeries} valueFormatter={formatBytes} />
            </TabsContent>
            <TabsContent value="bandwidth">
              <MetricChart data={data.points} series={bandwidthSeries} valueFormatter={formatBps} />
            </TabsContent>
            <TabsContent value="hit-rate">
              <MetricChart
                data={data.points}
                fixedMax={100}
                series={hitRateSeries}
                valueFormatter={(value) => `${value.toFixed(1)}%`}
              />
            </TabsContent>
            <TabsContent value="status">
              <MetricChart
                data={data.points}
                series={statusSeries}
                valueFormatter={(value) => numberFormatter.format(Math.round(value))}
              />
            </TabsContent>
          </CardContent>
          {data.message === null ? null : (
            <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">{data.message}</p>
          )}
        </Tabs>
      )}
    </Card>
  );
}
