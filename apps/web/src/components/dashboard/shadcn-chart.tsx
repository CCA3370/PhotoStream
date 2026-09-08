"use client";

import { type PointerEvent as ReactPointerEvent, useId, useState } from "react";

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

interface HoverState {
  readonly index: number;
  readonly x: number;
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

const chartWidth = 760;
const chartHeight = 236;
const plot = { left: 10, right: 10, top: 10, bottom: 34 } as const;

function valueAt(point: ShadcnChartPoint, key: string): number | null {
  const value = point[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function chartPoint(value: number, max: number, index: number, count: number): [number, number] {
  const width = chartWidth - plot.left - plot.right;
  const height = chartHeight - plot.top - plot.bottom;
  const x = count <= 1 ? plot.left + width / 2 : plot.left + (index / (count - 1)) * width;
  const y = plot.top + height - (value / Math.max(max, 1)) * height;
  return [x, y];
}

function smoothPath(data: readonly ShadcnChartPoint[], key: string, max: number): string {
  const values = data.map((item) => valueAt(item, key));
  const points = values.map((value, index) =>
    value === null ? null : chartPoint(value, max, index, values.length),
  );
  let path = "";
  let previous: [number, number] | null = null;

  points.forEach((current, index) => {
    if (current === null) {
      previous = null;
      return;
    }
    if (previous === null) {
      path += `M${current[0].toFixed(2)},${current[1].toFixed(2)}`;
      previous = current;
      return;
    }

    const previousIndex = Math.max(index - 1, 0);
    const before = points[Math.max(previousIndex - 1, 0)] ?? previous;
    const after = points[Math.min(index + 1, points.length - 1)] ?? current;
    const tension = 0.16;
    const c1x = previous[0] + (current[0] - before[0]) * tension;
    const c1y = previous[1] + (current[1] - before[1]) * tension;
    const c2x = current[0] - (after[0] - previous[0]) * tension;
    const c2y = current[1] - (after[1] - previous[1]) * tension;
    path += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${current[0].toFixed(2)},${current[1].toFixed(2)}`;
    previous = current;
  });

  return path;
}

function areaPath(data: readonly ShadcnChartPoint[], key: string, max: number): string {
  const path = smoothPath(data, key, max);
  if (path.length === 0) return "";
  const bottom = chartHeight - plot.bottom;
  const firstIndex = data.findIndex((item) => valueAt(item, key) !== null);
  let lastIndex = -1;
  for (let index = data.length - 1; index >= 0; index -= 1) {
    if (valueAt(data[index] as ShadcnChartPoint, key) !== null) {
      lastIndex = index;
      break;
    }
  }
  if (firstIndex < 0 || lastIndex < 0) return "";
  const [firstX] = chartPoint(0, max, firstIndex, data.length);
  const [lastX] = chartPoint(0, max, lastIndex, data.length);
  return `${path} L${lastX.toFixed(2)},${bottom} L${firstX.toFixed(2)},${bottom} Z`;
}

function maximum(
  data: readonly ShadcnChartPoint[],
  series: readonly ShadcnChartSeries[],
  mode: ChartMode,
  fixedMax?: number,
): number {
  if (fixedMax !== undefined) return fixedMax;
  if (mode === "stacked-bar") {
    return Math.max(
      1,
      ...data.map((point) =>
        series.reduce((sum, item) => sum + Math.max(valueAt(point, item.key) ?? 0, 0), 0),
      ),
    );
  }
  return Math.max(
    1,
    ...data.flatMap((point) =>
      series.flatMap((item) => {
        const value = valueAt(point, item.key);
        return value === null ? [] : [value];
      }),
    ),
  );
}

function xLabelIndexes(length: number): readonly number[] {
  if (length <= 1) return [0];
  const candidates = [0, Math.round((length - 1) / 3), Math.round(((length - 1) * 2) / 3), length - 1];
  return [...new Set(candidates)];
}

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
  const [hover, setHover] = useState<HoverState | null>(null);
  const instanceId = useId().replace(/:/gu, "");

  if (data.length === 0) {
    return (
      <div className="flex min-h-56 items-center justify-center text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }

  const max = maximum(data, series, mode, fixedMax);
  const bottom = chartHeight - plot.bottom;
  const active = hover === null ? null : (data[hover.index] ?? null);
  const labels = xLabelIndexes(data.length);
  const plotWidth = chartWidth - plot.left - plot.right;
  const bucketWidth = plotWidth / Math.max(data.length, 1);
  const barWidth = Math.min(18, Math.max(4, bucketWidth * 0.58));

  function pointerMove(event: ReactPointerEvent<SVGSVGElement>): void {
    const matrix = event.currentTarget.getScreenCTM();
    if (matrix === null) return;
    const cursor = event.currentTarget.createSVGPoint();
    cursor.x = event.clientX;
    cursor.y = event.clientY;
    const svgPoint = cursor.matrixTransform(matrix.inverse());
    const x = Math.min(chartWidth - plot.right, Math.max(plot.left, svgPoint.x));
    const ratio = (x - plot.left) / Math.max(plotWidth, 1);
    const index = Math.round(ratio * Math.max(data.length - 1, 0));
    const [pointX] = chartPoint(0, max, index, data.length);
    setHover({ index, x: pointX });
  }

  return (
    <div className="relative w-full">
      <svg
        aria-label={ariaLabel}
        className="h-[224px] w-full touch-none select-none overflow-visible"
        onPointerLeave={() => setHover(null)}
        onPointerMove={pointerMove}
        role="img"
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
      >
        <title>{ariaLabel}</title>
        <defs>
          {series.map((item, index) => (
            <linearGradient
              id={`shadcn-chart-${instanceId}-${index}`}
              key={item.key}
              x1="0"
              x2="0"
              y1="0"
              y2="1"
            >
              <stop offset="5%" stopColor={item.color} stopOpacity={index === 0 ? 0.28 : 0.16} />
              <stop offset="95%" stopColor={item.color} stopOpacity="0.01" />
            </linearGradient>
          ))}
        </defs>

        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = plot.top + (1 - ratio) * (bottom - plot.top);
          return (
            <line
              key={ratio}
              stroke="var(--border)"
              strokeDasharray="3 3"
              strokeOpacity="0.72"
              x1={plot.left}
              x2={chartWidth - plot.right}
              y1={y}
              y2={y}
            />
          );
        })}

        {mode === "area"
          ? series.map((item, index) => (
              <path
                d={areaPath(data, item.key, max)}
                fill={`url(#shadcn-chart-${instanceId}-${index})`}
                key={`${item.key}-area`}
                stroke="none"
              />
            ))
          : null}

        {mode === "stacked-bar"
          ? data.flatMap((point, index) => {
              const [x] = chartPoint(0, max, index, data.length);
              let cumulative = 0;
              return series.map((item, seriesIndex) => {
                const value = Math.max(valueAt(point, item.key) ?? 0, 0);
                const yTop = chartPoint(cumulative + value, max, index, data.length)[1];
                const yBottom = chartPoint(cumulative, max, index, data.length)[1];
                cumulative += value;
                const height = Math.max(yBottom - yTop, 0);
                const isTop = series.slice(seriesIndex + 1).every((candidate) =>
                  (valueAt(point, candidate.key) ?? 0) <= 0,
                );
                return (
                  <rect
                    fill={item.color}
                    height={height}
                    key={`${point.at}-${item.key}`}
                    opacity={hover === null || hover.index === index ? 1 : 0.58}
                    rx={isTop ? 3 : 0}
                    width={barWidth}
                    x={x - barWidth / 2}
                    y={yTop}
                  />
                );
              });
            })
          : series.map((item) => (
              <path
                d={smoothPath(data, item.key, max)}
                fill="none"
                key={item.key}
                stroke={item.color}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
            ))}

        {hover === null ? null : (
          <line
            stroke="var(--foreground)"
            strokeDasharray="3 3"
            strokeOpacity="0.2"
            x1={hover.x}
            x2={hover.x}
            y1={plot.top}
            y2={bottom}
          />
        )}

        {active !== null && hover !== null && mode !== "stacked-bar"
          ? series.map((item) => {
              const value = valueAt(active, item.key);
              if (value === null) return null;
              const [, y] = chartPoint(value, max, hover.index, data.length);
              return (
                <circle
                  cx={hover.x}
                  cy={y}
                  fill="var(--background)"
                  key={item.key}
                  r="4"
                  stroke={item.color}
                  strokeWidth="2.5"
                />
              );
            })
          : null}

        {labels.map((index) => {
          const [x] = chartPoint(0, max, index, data.length);
          const at = data[index]?.at;
          return (
            <text
              fill="var(--muted-foreground)"
              fontSize="10"
              key={index}
              textAnchor={index === 0 ? "start" : index === data.length - 1 ? "end" : "middle"}
              x={x}
              y={chartHeight - 10}
            >
              {at === undefined ? "" : axisFormatter.format(new Date(at))}
            </text>
          );
        })}
      </svg>

      <div className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        {series.map((item) => (
          <span className="inline-flex items-center gap-1.5" key={item.key}>
            <span className="size-2 rounded-[2px]" style={{ background: item.color }} />
            {item.label}
          </span>
        ))}
      </div>

      {active !== null && hover !== null ? (
        <div
          className="pointer-events-none absolute top-2 z-20 min-w-44 rounded-lg border bg-background/95 px-3 py-2 text-xs shadow-xl backdrop-blur-sm"
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
          <p className="mb-2 font-medium text-foreground">
            {tooltipFormatter.format(new Date(active.at))}
          </p>
          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1.5">
            {series.map((item) => {
              const value = valueAt(active, item.key);
              return (
                <span className="contents" key={item.key}>
                  <span className="size-2 rounded-[2px]" style={{ background: item.color }} />
                  <span className="text-muted-foreground">{item.label}</span>
                  <span className="font-mono font-medium tabular-nums text-foreground">
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
