"use client";

import {
  ShadcnChart,
  type ShadcnChartPoint,
  type ShadcnChartSeries,
} from "@/components/dashboard/shadcn-chart";
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

const numberFormatter = new Intl.NumberFormat("zh-CN");

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

const trafficSeries: readonly ShadcnChartSeries[] = [
  { key: "trafficBytes", label: "CDN 流量", color: "var(--chart-1)" },
  { key: "originTrafficBytes", label: "回源流量", color: "var(--chart-3)" },
];
const bandwidthSeries: readonly ShadcnChartSeries[] = [
  { key: "bandwidthBps", label: "带宽", color: "var(--chart-2)" },
];
const hitRateSeries: readonly ShadcnChartSeries[] = [
  { key: "byteHitRate", label: "字节命中率", color: "var(--chart-1)" },
  { key: "requestHitRate", label: "请求命中率", color: "var(--chart-2)" },
];
const statusSeries: readonly ShadcnChartSeries[] = [
  { key: "http2xx", label: "2xx", color: "var(--chart-1)" },
  { key: "http3xx", label: "3xx", color: "var(--chart-2)" },
  { key: "http4xx", label: "4xx", color: "var(--chart-4)" },
  { key: "http5xx", label: "5xx", color: "var(--chart-5)" },
];

function chartPoints(data: readonly CdnPoint[]): readonly ShadcnChartPoint[] {
  return data.map((item) => ({
    at: item.at,
    trafficBytes: item.trafficBytes,
    bandwidthBps: item.bandwidthBps,
    originTrafficBytes: item.originTrafficBytes,
    byteHitRate: item.byteHitRate,
    requestHitRate: item.requestHitRate,
    http2xx: item.http2xx,
    http3xx: item.http3xx,
    http4xx: item.http4xx,
    http5xx: item.http5xx,
  }));
}

export function CdnMetricsPanel({ data }: Readonly<{ data: CdnMetricsData }>) {
  const errorRate = data.requests === 0 ? 0 : (data.errorRequests / data.requests) * 100;
  const points = chartPoints(data.points);
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
            <TabsList className="h-8 gap-0 overflow-hidden rounded-md border bg-muted/40 p-0">
              <TabsTrigger
                className="rounded-none border-r px-3 text-xs last:border-r-0"
                value="traffic"
              >
                流量
              </TabsTrigger>
              <TabsTrigger
                className="rounded-none border-r px-3 text-xs last:border-r-0"
                value="bandwidth"
              >
                带宽
              </TabsTrigger>
              <TabsTrigger
                className="rounded-none border-r px-3 text-xs last:border-r-0"
                value="hit-rate"
              >
                命中率
              </TabsTrigger>
              <TabsTrigger className="rounded-none px-3 text-xs" value="status">
                状态码
              </TabsTrigger>
            </TabsList>
          </div>
          <CardContent className="px-3 pt-3 pb-2 sm:px-5">
            <TabsContent value="traffic">
              <ShadcnChart
                ariaLabel="CDN 与回源流量趋势"
                data={points}
                emptyLabel="暂无 CDN 流量数据"
                mode="area"
                series={trafficSeries}
                valueFormatter={formatBytes}
              />
            </TabsContent>
            <TabsContent value="bandwidth">
              <ShadcnChart
                ariaLabel="CDN 带宽趋势"
                data={points}
                emptyLabel="暂无 CDN 带宽数据"
                mode="line"
                series={bandwidthSeries}
                valueFormatter={formatBps}
              />
            </TabsContent>
            <TabsContent value="hit-rate">
              <ShadcnChart
                ariaLabel="CDN 缓存命中率趋势"
                data={points}
                emptyLabel="暂无 CDN 命中率数据"
                fixedMax={100}
                mode="line"
                series={hitRateSeries}
                valueFormatter={(value) => `${value.toFixed(1)}%`}
              />
            </TabsContent>
            <TabsContent value="status">
              <ShadcnChart
                ariaLabel="CDN HTTP 状态码趋势"
                data={points}
                emptyLabel="暂无 CDN 状态码数据"
                mode="stacked-bar"
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
