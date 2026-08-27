import { cn } from "@/lib/utils";

const swatches = [
  ["主操作", "bg-primary text-primary-foreground"],
  ["完成", "bg-success text-success-foreground"],
  ["警告", "bg-warning text-warning-foreground"],
  ["危险", "bg-destructive text-destructive-foreground"],
] as const;

const compatibilityMediaIds = [
  "01",
  "02",
  "03",
  "04",
  "05",
  "06",
  "07",
  "08",
  "09",
  "10",
  "11",
  "12",
];

export default function CompatibilityPage() {
  return (
    <main className="public-theme min-h-screen bg-background px-3 py-8 text-foreground sm:px-4 md:px-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <header className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">Tailwind v4 浏览器门禁样页</p>
          <h1 className="text-2xl font-semibold tracking-tight">中学部影像直播</h1>
          <p className="max-w-2xl text-base text-muted-foreground">
            用于检查 OKLCH、color-mix、CSS Grid、粘性定位、焦点和系统深色模式。
          </p>
        </header>

        <section aria-labelledby="token-heading" className="flex flex-col gap-4">
          <h2 id="token-heading" className="text-xl font-semibold">
            语义状态
          </h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {swatches.map(([label, classes]) => (
              <div
                className={cn("rounded-lg px-4 py-6 text-center font-medium", classes)}
                key={label}
              >
                {label}
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="layout-heading" className="flex flex-col gap-4">
          <div className="sticky top-0 rounded-lg border bg-card/95 p-4 backdrop-blur">
            <h2 id="layout-heading" className="text-xl font-semibold">
              响应式网格
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-2 min-[480px]:grid-cols-3 md:grid-cols-4 md:gap-3 lg:grid-cols-[repeat(auto-fit,minmax(176px,1fr))]">
            {compatibilityMediaIds.map((id) => (
              <div
                aria-hidden="true"
                className="aspect-square rounded-lg border bg-muted"
                data-compat-media={id}
                key={id}
              />
            ))}
          </div>
        </section>

        <label className="flex max-w-md flex-col gap-2 text-sm font-medium" htmlFor="focus-test">
          焦点与输入
          <input
            className="min-h-11 rounded-lg border bg-background px-3 text-foreground"
            id="focus-test"
            placeholder="使用键盘 Tab 到此处"
          />
        </label>
      </div>
    </main>
  );
}
