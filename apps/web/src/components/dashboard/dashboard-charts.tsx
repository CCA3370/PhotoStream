"use client";

import { useState, type PointerEvent as ReactPointerEvent } from "react";

interface TrendPoint {
  readonly at: string;
  readonly opens: number;
  readonly uniqueVisitors: number;
  readonly downloads: number;
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
const chartHeight = 280;
const plot = { left: 44, right: 18, top: 20, bottom: 42 } as const;

function point(value: number, max: number, index: number, count: number): [number, number] {
  const width = chartWidth - plot.left - plot.right;
  const height = chartHeight - plot.top - plot.bottom;
  const x = count <= 1 ? plot.left + width / 2 : plot.left + (index / (count - 1)) * width;
  const y = plot.top + height - (value / Math.max(max, 1)) * height;
  return [x, y];
}

function linePath(values: readonly number[], max: number): string {
  return values
    .map((value, index) => {
      const [x, y] = point(value, max, index, values.length);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function areaPath(values: readonly number[], max: number): string {
  const bottom = chartHeight - plot.bottom;
  const [firstX] = point(values[0] ?? 0, max, 0, values.length);
  const [lastX] = point(values.at(-1) ?? 0, max, Math.max(values.length - 1, 0), values.length);
  return `${linePath(values, max)} L${lastX},${bottom} L${firstX},${bottom} Z`;
}

export function AnalyticsTrendChart({ data }: Readonly<{ data: readonly TrendPoint[] }>) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div className="flex min-h-60 items-center justify-center text-sm text-muted-foreground">
        暂无数据
      </div>
    );
  }

  const opens = data.map((item) => item.opens);
  const visitors = data.map((item) => item.uniqueVisitors);
  const downloads = data.map((item) => item.downloads);
  const max = Math.max(1, ...opens, ...visitors, ...downloads);
  const active = activeIndex === null ? null : data[activeIndex] ?? null;
  const activeX = activeIndex === null ? null : point(0, max, activeIndex, data.length)[0];
  const bottom = chartHeight - plot.bottom;

  const xLabels = Array.from(
    new Set([0, Math.floor((data.length - 1) / 2), Math.max(data.length - 1, 0)]),
  );

  function pointerMove(event: ReactPointerEvent<SVGSVGElement>): void {
    const rect = event.currentTarget.getBoundingClientRect();
    const left = (plot.left / chartWidth) * rect.width;
    const right = ((chartWidth - plot.right) / chartWidth) * rect.width;
    const x = Math.min(right, Math.max(left, event.clientX - rect.left));
    const ratio = (x - left) / Math.max(right - left, 1);
    setActiveIndex(Math.round(ratio * Math.max(data.length - 1, 0)));
  }

  return (
    <div className="relative w-full">
      <svg
        aria-label="浏览量、独立访客和下载量趋势"
        className="h-[270px] w-full touch-none select-none"
        onPointerLeave={() => setActiveIndex(null)}
        onPointerMove={pointerMove}
        role="img"
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
      >
        <title>访问趋势</title>
        <defs>
          <linearGradient id="dashboard-opens" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0.28" />
            <stop offset="95%" stopColor="var(--chart-1)" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id="dashboard-visitors" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-2)" stopOpacity="0.14" />
            <stop offset="95%" stopColor="var(--chart-2)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = plot.top + (1 - ratio) * (bottom - plot.top);
          return (
            <g key={ratio}>
              <line
                stroke="var(--border)"
                strokeDasharray="3 4"
                strokeOpacity="0.65"
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
                {numberFormatter.format(Math.round(max * ratio))}
              </text>
            </g>
          );
        })}

        <path d={areaPath(opens, max)} fill="url(#dashboard-opens)" />
        <path d={areaPath(visitors, max)} fill="url(#dashboard-visitors)" />
        <path
          d={linePath(opens, max)}
          fill="none"
          stroke="var(--chart-1)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.5"
        />
        <path
          d={linePath(visitors, max)}
          fill="none"
          stroke="var(--chart-2)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
        <path
          d={linePath(downloads, max)}
          fill="none"
          stroke="var(--chart-3)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />

        {active !== null && activeIndex !== null && activeX !== null ? (
          <g>
            <line
              stroke="var(--border)"
              strokeDasharray="3 3"
              x1={activeX}
              x2={activeX}
              y1={plot.top}
              y2={bottom}
            />
            {[
              [active.opens, "var(--chart-1)"],
              [active.uniqueVisitors, "var(--chart-2)"],
              [active.downloads, "var(--chart-3)"],
            ].map(([value, color]) => {
              const [, y] = point(Number(value), max, activeIndex, data.length);
              return (
                <circle
                  cx={activeX}
                  cy={y}
                  fill={String(color)}
                  key={String(color)}
                  r="4"
                  stroke="var(--background)"
                  strokeWidth="2"
                />
              );
            })}
          </g>
        ) : null}

        {xLabels.map((index) => {
          const [x] = point(0, max, index, data.length);
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

      <div className="mt-1 flex items-center justify-center gap-5 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-chart-1" />浏览量
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-chart-2" />独立访客
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-chart-3" />下载量
        </span>
      </div>

      {active !== null && activeX !== null ? (
        <div
          className="pointer-events-none absolute top-3 z-10 min-w-40 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
          style={{
            left: `${(activeX / chartWidth) * 100}%`,
            transform:
              activeX < 150
                ? "translateX(0)"
                : activeX > chartWidth - 150
                  ? "translateX(-100%)"
                  : "translateX(-50%)",
          }}
        >
          <p className="mb-2 font-medium">{tooltipFormatter.format(new Date(active.at))}</p>
          <div className="grid grid-cols-[1fr_auto] gap-x-5 gap-y-1.5">
            <span className="text-muted-foreground">浏览量</span>
            <span className="font-mono font-medium tabular-nums">
              {numberFormatter.format(active.opens)}
            </span>
            <span className="text-muted-foreground">独立访客</span>
            <span className="font-mono font-medium tabular-nums">
              {numberFormatter.format(active.uniqueVisitors)}
            </span>
            <span className="text-muted-foreground">下载量</span>
            <span className="font-mono font-medium tabular-nums">
              {numberFormatter.format(active.downloads)}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
