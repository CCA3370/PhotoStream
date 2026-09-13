"use client";

export function ImageDownloadProgress({
  kind,
  progress,
}: Readonly<{
  kind: "preview" | "original";
  progress: number;
}>) {
  const percent = Math.min(100, Math.max(0, Math.round(progress * 100)));
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - percent / 100);
  const label = kind === "original" ? "正在加载原图" : "正在加载普通图";

  return (
    <div
      aria-live="polite"
      className="pointer-events-none absolute inset-0 z-40 grid place-items-center"
    >
      <div className="flex min-w-36 flex-col items-center gap-2 rounded-2xl border border-white/10 bg-black/70 px-5 py-4 text-white shadow-2xl shadow-black/40 backdrop-blur-xl">
        <div className="relative grid size-20 place-items-center" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={`${label} ${percent}%`}>
          <svg aria-hidden="true" className="absolute inset-0 size-20 -rotate-90" viewBox="0 0 72 72">
            <circle
              className="text-white/15"
              cx="36"
              cy="36"
              fill="none"
              r={radius}
              stroke="currentColor"
              strokeWidth="5"
            />
            <circle
              className="text-white transition-[stroke-dashoffset] duration-150 ease-out motion-reduce:transition-none"
              cx="36"
              cy="36"
              fill="none"
              r={radius}
              stroke="currentColor"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              strokeLinecap="round"
              strokeWidth="5"
            />
          </svg>
          <span className="text-sm font-semibold tabular-nums">{percent}%</span>
        </div>
        <span className="text-sm font-medium">{label}</span>
      </div>
    </div>
  );
}
