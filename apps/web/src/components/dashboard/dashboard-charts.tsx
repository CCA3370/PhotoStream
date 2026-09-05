"use client";

import { useState, type PointerEvent as ReactPointerEvent } from "react";

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

function areaPath(values: readonly number[], max: number): string {
  return `${linePath(values, max)} L684,218 L42,218 Z`;
}

function timeLabel(value: string): string {
  return dateFormatter.format(new Date(value));
}

export function AnalyticsTrendChart({ data }: Readonly<{ data: readonly TrendPoint[] }>) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div className="flex min-h-56 items-center justify-center text-sm text-muted-foreground">
        暂无数据
      </div>
    );
  }

  const opens = data.map((point) => point.opens);
  const visitors = data.map((point) => point.uniqueVisitors);
  const downloads = data.map((point) => point.downloads);
  const max = Math.max(1, ...opens, ...visitors, ...downloads);
  const labelIndexes = Array.from(
    new Set([0, Math.floor((data.length - 1) / 2), Math.max(0, data.length - 1)]),
  );
  const activePoint = activeIndex === null ? null : data[activeIndex] ?? null;
  const activeX =
    activeIndex === null ? null : chartPoint(0, max, activeIndex, data.length)[0];

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>): void {
    const rect = event.currentTarget.getBoundingClientRect();
    const plotStart = (42 / 720) * rect.width;
    const plotEnd = (684 / 720) * rect.width;
    const pointer = Math.min(plotEnd, Math.max(plotStart, event.clientX - rect.left));
    const ratio = (pointer - plotStart) / Math.max(plotEnd - plotStart, 1);
    setActiveIndex(Math.round(ratio * Math.max(data.length - 1, 0)));
  }

  const tooltipTransform =
    activeX === null
      ? undefined
      : activeX < 150
        ? "translateX(0)"
        : activeX > 570
          ? "translateX(-100%)"
          : "translateX(-50%)";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-x-5 gap-y-2 px-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <span className="size-2 rounded-full bg-chart-1" />
          浏览量
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="size-2 rounded-full bg-chart-2" />
          独立访客
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="size-2 rounded-full bg-chart-3" />
          下载量
        </span>
      </div>

      <div className="relative -mx-1 overflow-hidden">
        <svg
          aria-label="所选时间范围内的浏览量、独立访客和下载量趋势"
          className="h-[248px] w-full touch-none select-none"
          onPointerLeave={() => setActiveIndex(null)}
          onPointerMove={handlePointerMove}
          role="img"
          viewBox="0 0 720 260"
        >
          <title>访问趋势</title>
          <defs>
            <linearGradient id="dashboard-opens-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0.24" />
              <stop offset="85%" stopColor="var(--chart-1)" stopOpacity="0.02" />
            </linearGradient>
          </defs>

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
                <text
                  fill="var(--muted-foreground)"
                  fontSize="10"
                  textAnchor="end"
                  x="35"
                  y={y + 3}
                >
                  {numberFormatter.format(Math.round(max * ratio))}
                </text>
              </g>
            );
          })}

          <path d={areaPath(opens, max)} fill="url(#dashboard-opens-fill)" stroke="none" />
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

          {activeIndex !== null && activePoint !== null && activeX !== null ? (
            <g>
              <line
                stroke="var(--border)"
                strokeDasharray="4 4"
                strokeWidth="1"
                x1={activeX}
                x2={activeX}
                y1="40"
                y2="218"
              />
              {[
                [activePoint.opens, "var(--chart-1)"],
                [activePoint.uniqueVisitors, "var(--chart-2)"],
                [activePoint.downloads, "var(--chart-3)"],
              ].map(([value, color]) => {
                const [, y] = chartPoint(Number(value), max, activeIndex, data.length);
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

        {activePoint !== null && activeX !== null ? (
          <div
            className="pointer-events-none absolute top-3 z-10 min-w-36 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
            style={{ left: `${(activeX / 720) * 100}%`, transform: tooltipTransform }}
          >
            <p className="mb-1.5 font-medium">{timeLabel(activePoint.at)}</p>
            <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-muted-foreground">
              <span>浏览量</span>
              <span className="font-medium tabular-nums text-foreground">
                {numberFormatter.format(activePoint.opens)}
              </span>
              <span>独立访客</span>
              <span className="font-medium tabular-nums text-foreground">
                {numberFormatter.format(activePoint.uniqueVisitors)}
              </span>
              <span>下载量</span>
              <span className="font-medium tabular-nums text-foreground">
                {numberFormatter.format(activePoint.downloads)}
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
