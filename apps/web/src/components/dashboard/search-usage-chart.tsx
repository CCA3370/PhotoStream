"use client";

import { type PointerEvent as ReactPointerEvent, useState } from "react";

interface SearchUsagePoint {
  readonly at: string;
  readonly number: number;
  readonly attributes: number;
  readonly face: number;
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
const plot = { left: 44, right: 18, top: 18, bottom: 42 } as const;

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

export function SearchUsageChart({ data }: Readonly<{ data: readonly SearchUsagePoint[] }>) {
  const [hover, setHover] = useState<HoverState | null>(null);

  if (data.length === 0) {
    return (
      <div className="flex min-h-52 items-center justify-center text-sm text-muted-foreground">
        暂无找图使用数据
      </div>
    );
  }

  const number = data.map((item) => item.number);
  const attributes = data.map((item) => item.attributes);
  const face = data.map((item) => item.face);
  const max = Math.max(1, ...number, ...attributes, ...face);
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
        aria-label="号码、年级班级和人脸找图使用量趋势"
        className="h-[230px] w-full touch-none select-none"
        onPointerLeave={() => setHover(null)}
        onPointerMove={pointerMove}
        role="img"
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
      >
        <title>找图方式使用量</title>

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

        <path
          d={linePath(number, max)}
          fill="none"
          stroke="var(--chart-1)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.4"
        />
        <path
          d={linePath(attributes, max)}
          fill="none"
          stroke="var(--chart-2)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.2"
        />
        <path
          d={linePath(face, max)}
          fill="none"
          stroke="var(--chart-4)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.2"
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

      <div className="mt-0.5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-chart-1" />
          号码
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-chart-2" />
          年级班级
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-chart-4" />
          人脸
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
            <span className="text-muted-foreground">号码</span>
            <span className="font-mono font-medium tabular-nums">
              {numberFormatter.format(active.number)}
            </span>
            <span className="text-muted-foreground">年级班级</span>
            <span className="font-mono font-medium tabular-nums">
              {numberFormatter.format(active.attributes)}
            </span>
            <span className="text-muted-foreground">人脸</span>
            <span className="font-mono font-medium tabular-nums">
              {numberFormatter.format(active.face)}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
