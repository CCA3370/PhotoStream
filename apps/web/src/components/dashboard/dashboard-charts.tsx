import type { AlbumSummaryView } from "@photostream/contracts";

interface DailyPoint {
  readonly day: string;
  readonly opens: number;
  readonly uniqueVisitors: number;
  readonly downloads: number;
}

interface RankedAlbum {
  readonly album: AlbumSummaryView;
  readonly downloads: number;
  readonly opens: number;
}

const numberFormatter = new Intl.NumberFormat("zh-CN");
const shortDateFormatter = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" });

function chartPoint(value: number, max: number, index: number, count: number): [number, number] {
  const x = count <= 1 ? 360 : 28 + (index / (count - 1)) * 664;
  const y = 210 - (value / Math.max(max, 1)) * 176;
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

function dateLabel(day: string): string {
  return shortDateFormatter.format(new Date(`${day}T00:00:00Z`));
}

export function AnalyticsTrendChart({ data }: Readonly<{ data: readonly DailyPoint[] }>) {
  if (data.length === 0) {
    return (
      <div className="flex min-h-64 items-center justify-center rounded-xl border border-dashed bg-muted/30 px-6 text-center text-sm text-muted-foreground">
        有访问或下载后，这里会显示最近 30 天趋势。
      </div>
    );
  }

  const opens = data.map((point) => point.opens);
  const visitors = data.map((point) => point.uniqueVisitors);
  const downloads = data.map((point) => point.downloads);
  const max = Math.max(1, ...opens, ...visitors, ...downloads);
  const labelIndexes = Array.from(new Set([0, Math.floor((data.length - 1) / 2), data.length - 1]));

  return (
    <div className="flex flex-col gap-4">
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
      <div className="overflow-hidden rounded-xl bg-muted/20 px-2 pt-3">
        <svg
          aria-label="最近 30 天浏览量、独立访客和下载量趋势"
          className="h-[260px] w-full"
          role="img"
          viewBox="0 0 720 250"
        >
          <title>最近 30 天访问与下载趋势</title>
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = 210 - ratio * 176;
            return (
              <g key={ratio}>
                <line
                  stroke="var(--border)"
                  strokeDasharray="3 5"
                  strokeWidth="1"
                  x1="28"
                  x2="692"
                  y1={y}
                  y2={y}
                />
                <text fill="var(--muted-foreground)" fontSize="10" textAnchor="end" x="24" y={y + 3}>
                  {numberFormatter.format(Math.round(max * ratio))}
                </text>
              </g>
            );
          })}
          <path
            d={`${linePath(opens, max)} L692,210 L28,210 Z`}
            fill="color-mix(in oklab, var(--chart-1) 12%, transparent)"
            stroke="none"
          />
          <path d={linePath(opens, max)} fill="none" stroke="var(--chart-1)" strokeWidth="3" />
          <path
            d={linePath(visitors, max)}
            fill="none"
            stroke="var(--chart-2)"
            strokeWidth="2.5"
          />
          <path
            d={linePath(downloads, max)}
            fill="none"
            stroke="var(--chart-3)"
            strokeWidth="2.5"
          />
          {labelIndexes.map((index) => {
            const [x] = chartPoint(0, max, index, data.length);
            return (
              <text
                fill="var(--muted-foreground)"
                fontSize="10"
                key={index}
                textAnchor={index === 0 ? "start" : index === data.length - 1 ? "end" : "middle"}
                x={x}
                y="235"
              >
                {dateLabel(data[index]?.day ?? "")}
              </text>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

export function AlbumDownloadRanking({ items }: Readonly<{ items: readonly RankedAlbum[] }>) {
  const visible = items.slice(0, 6);
  const max = Math.max(1, ...visible.map((item) => item.downloads));

  if (visible.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">暂无可排行的活动。</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      {visible.map((item, index) => (
        <div className="flex flex-col gap-2" key={item.album.id}>
          <div className="flex items-center justify-between gap-4 text-sm">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold text-muted-foreground">
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="truncate font-medium">{item.album.title}</p>
                <p className="text-xs text-muted-foreground">
                  {numberFormatter.format(item.opens)} 次浏览
                </p>
              </div>
            </div>
            <span className="shrink-0 font-semibold tabular-nums">
              {numberFormatter.format(item.downloads)}
              <span className="ml-1 text-xs font-normal text-muted-foreground">次下载</span>
            </span>
          </div>
          <div className="ml-10 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-chart-1"
              style={{ width: `${Math.max(4, (item.downloads / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
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
