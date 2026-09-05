"use client";

import { type PointerEvent as ReactPointerEvent, useState } from "react";

interface TrendPoint {
  readonly at: string;
  readonly opens: number;
  readonly uniqueVisitors: number;
  readonly downloads: number;
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
const chartHeight = 280;
const plot = { left: 44, right: 18, top: 20, bottom: 42 } as const;

function point(value: number, max: number, index: number, count: number): [number, number] {
  const width = chartWidth - plot.left - plot.right;
  const height = chartHeight - plot.top - plot.bottom;
  const x = count <= 1 ? plot.left + width / 2 : plot.left + (index / (count - 1)) * width;
  const y = plot.top + height - (value / Math.max(max, 1)) * height;
  return [x, y];
}

function smoothPath(values: readonly number[], max: number): string {
  const points = values.map((value, index) => point(value, max, index, values.length));
  const first = points[0];
  if (first === undefined) return "";
  if (points.length === 1) return `M${first[0].toFixed(2)},${first[1].toFixed(2)}`;

  const slopes: number[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    if (current === undefined || next === undefined) continue;
    slopes.push((next[1] - current[1]) / Math.max(next[0] - current[0], 1));
  }

  const tangents = points.map((_, index) => {
    if (index === 0) return slopes[0] ?? 0;
    if (index === points.length - 1) return slopes.at(-1) ?? 0;
    const previous = slopes[index - 1] ?? 0;
    const next = slopes[index] ?? 0;
    return previous * next <= 0 ? 0 : (previous + next) / 2;
  });

  for (let index = 0; index < slopes.length; index += 1) {
    const slope = slopes[index] ?? 0;
    if (slope === 0) {
      tangents[index] = 0;
      tangents[index + 1] = 0;
      continue;
    }
    const left = (tangents[index] ?? 0) / slope;
    const right = (tangents[index + 1] ?? 0) / slope;
    const magnitude = Math.hypot(left, right);
    if (magnitude <= 3) continue;
    const scale = 3 / magnitude;
    tangents[index] = scale * left * slope;
    tangents[index + 1] = scale * right * slope;
  }

  let path = `M${first[0].toFixed(2)},${first[1].toFixed(2)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    if (current === undefined || next === undefined) continue;
    const width = next[0] - current[0];
    const leftTangent = tangents[index] ?? 0;
    const rightTangent = tangents[index + 1] ?? 0;
    const c1x = current[0] + width / 3;
    const c1y = current[1] + (leftTangent * width) / 3;
    const c2x = next[0] - width / 3;
    const c2y = next[1] - (rightTangent * width) / 3;
    path += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${next[0].toFixed(2)},${next[1].toFixed(2)}`;
  }
  return path;
}

function areaPath(values: readonly number[], max: number): string {
  const curve = smoothPath(values, max);
  if (curve.length === 0) return "";
  const bottom = chartHeight - plot.bottom;
  const [firstX] = point(values[0] ?? 0, max, 0, values.length);
  const [lastX] = point(values.at(-1) ?? 0, max, Math.max(values.length - 1, 0), values.length);
  return `${curve} L${lastX.toFixed(2)},${bottom} L${firstX.toFixed(2)},${bottom} Z`;
}

export function AnalyticsTrendChart({ data }: Readonly<{ data: readonly TrendPoint[] }>) {
  const [hover, setHover] = useState<HoverState | null>(null);

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
  const active = hover === null ? null : (data[hover.index] ?? null);
  const bottom = chartHeight - plot.bottom;

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
        aria-label="浏览量、独立访客和下载量趋势"
        className="h-[252px] w-full touch-none select-none"
        onPointerLeave={() => setHover(null)}
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
                {numberFormatter.format(Math.round(max * ratio))}
              </text>
            </g>
          );
        })}

        <path d={areaPath(opens, max)} fill="url(#dashboard-opens)" />
        <path d={areaPath(visitors, max)} fill="url(#dashboard-visitors)" />
        <path
          d={smoothPath(opens, max)}
          fill="none"
          stroke="var(--chart-1)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.5"
        />
        <path
          d={smoothPath(visitors, max)}
          fill="none"
          stroke="var(--chart-2)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
        <path
          d={smoothPath(downloads, max)}
          fill="none"
          stroke="var(--chart-3)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />

        {hover === null ? null : (
          <line
            stroke="var(--foreground)"
            strokeOpacity="0.34"
            strokeWidth="1"
            x1={hover.x}
            x2={hover.x}
            y1={plot.top}
            y2={bottom}
          />
        )}

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

      <div className="mt-0.5 flex items-center justify-center gap-5 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-chart-1" />
          浏览量
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-chart-2" />
          独立访客
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-chart-3" />
          下载量
        </span>
      </div>

      {active !== null && hover !== null ? (
        <div
          className="pointer-events-none absolute top-3 z-10 min-w-40 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
          style={{
            left: `${(hover.x / chartWidth) * 100}%`,
            transform:
              hover.x < 150
                ? "translateX(0)"
                : hover.x > chartWidth - 150
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
