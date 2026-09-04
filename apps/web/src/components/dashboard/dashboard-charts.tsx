"use client";

import type { AlbumSummaryView } from "@photostream/contracts";
import { useMemo, useState } from "react";

interface TrendPoint {
  readonly at: string;
  readonly opens: number;
  readonly uniqueVisitors: number;
  readonly downloads: number;
}

const numberFormatter = new Intl.NumberFormat("zh-CN");
const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function chartPoint(value: number, max: number, index: number, count: number): [number, number] {
  const x = count <= 1 ? 360 : 42 + (index / (count - 1)) * 642;
  const y = 218 - (value / Math.max(max, 1)) * 178;
  return [x, y];
}

function linePath(values: readonly number[], max: number): string {
  return values
    .map((value, index) => {
      const [x, y] = chartPoint(value, max, index, values.length);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function timeLabel(value: string): string {
  return dateFormatter.format(new Date(value));
}

export function AnalyticsTrendChart({ data }: Readonly<{ data: readonly TrendPoint[] }>) {
  const [hovered, setHovered] = useState<number | null>(null);
  const opens = useMemo(() => data.map((point) => point.opens), [data]);
  const visitors = useMemo(() => data.map((point) => point.uniqueVisitors), [data]);
  const downloads = useMemo(() => data.map((point) => point.downloads), [data]);

  if (data.length === 0) {
    return (
      <div className="flex min-h-72 items-center justify-center rounded-xl border border-dashed bg-muted/25 px-6 text-center text-sm text-muted-foreground">
        当前时间范围内还没有访问或下载事件。
      </div>
    );
  }

  const max = Math.max(1, ...opens, ...visitors, ...downloads);
  const labelIndexes = Array.from(
    new Set([0, Math.floor((data.length - 1) / 2), Math.max(0, data.length - 1)]),
  );
  const hoverPoint = hovered === null ? null : data[hovered] ?? null;

  return (
    <div className="relative flex flex-col gap-4">
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-chart-1" />浏览量
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-chart-2" />独立访客
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-chart-3" />下载量
        </span>
      </div>
      <div className="relative overflow-hidden rounded-xl bg-muted/20 px-2 pt-3">
        {hoverPoint === null ? null : (
          <div className="pointer-events-none absolute top-3 right-3 z-10 min-w-40 rounded-xl border bg-popover/95 p-3 text-xs shadow-md backdrop-blur">
            <p className="mb-2 font-medium text-popover-foreground">{timeLabel(hoverPoint.at)}</p>
            <div className="space-y-1 text-muted-foreground">
              <p className="flex justify-between gap-4"><span>浏览</span><strong className="text-foreground">{numberFormatter.format(hoverPoint.opens)}</strong></p>
              <p className="flex justify-between gap-4"><span>访客</span><strong className="text-foreground">{numberFormatter.format(hoverPoint.uniqueVisitors)}</strong></p>
              <p className="flex justify-between gap-4"><span>下载</span><strong className="text-foreground">{numberFormatter.format(hoverPoint.downloads)}</strong></p>
            </div>
          </div>
        )}
        <svg
          aria-label="所选时间范围内的浏览量、独立访客和下载量趋势"
          className="h-[280px] w-full touch-pan-y"
          onMouseLeave={() => setHovered(null)}
          role="img"
          viewBox="0 0 720 260"
        >
          <title>访问与下载趋势</title>
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = 218 - ratio * 178;
            return (
              <g key={ratio}>
                <line
                  stroke="var(--border)"
                  strokeDasharray="3 5"
                  strokeWidth="1"
                  x1="42"
                  x2="684"
                  y1={y}
                  y2={y}
                />
                <text fill="var(--muted-foreground)" fontSize="10" textAnchor="end" x="36" y={y + 3}>
                  {numberFormatter.format(Math.round(max * ratio))}
                </text>
              </g>
            );
          })}
          <path
            d={`${linePath(opens, max)} L684,218 L42,218 Z`}
            fill="color-mix(in oklab, var(--chart-1) 12%, transparent)"
            stroke="none"
          />
          <path d={linePath(opens, max)} fill="none" stroke="var(--chart-1)" strokeWidth="3" />
          <path d={linePath(visitors, max)} fill="none" stroke="var(--chart-2)" strokeWidth="2.5" />
          <path d={linePath(downloads, max)} fill="none" stroke="var(--chart-3)" strokeWidth="2.5" />
          {data.map((point, index) => {
            const [x] = chartPoint(0, max, index, data.length);
            return (
              <rect
                fill="transparent"
                height="218"
                key={point.at}
                onMouseEnter={() => setHovered(index)}
                onTouchStart={() => setHovered(index)}
                width={Math.max(4, 642 / Math.max(data.length - 1, 1))}
                x={x - Math.max(2, 321 / Math.max(data.length - 1, 1))}
                y="0"
              />
            );
          })}
          {hovered === null ? null : (() => {
            const [x] = chartPoint(0, max, hovered, data.length);
            return <line stroke="var(--ring)" strokeDasharray="4 4" strokeWidth="1" x1={x} x2={x} y1="40" y2="218" />;
          })()}
          {labelIndexes.map((index) => {
            const [x] = chartPoint(0, max, index, data.length);
            return (
              <text
                fill="var(--muted-foreground)"
                fontSize="10"
                key={index}
                textAnchor={index === 0 ? "start" : index === data.length - 1 ? "end" : "middle"}
                x={x}
                y="246"
              >
                {timeLabel(data[index]?.at ?? "")}
              </text>
            );
          })}
        </svg>
      </div>
    </div>
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
