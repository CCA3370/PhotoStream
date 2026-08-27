"use client";

export default function ErrorPage({ reset }: Readonly<{ reset: () => void }>) {
  return (
    <main className="workbench-theme grid min-h-screen place-items-center bg-background p-6 text-foreground">
      <div className="flex max-w-md flex-col gap-4 text-center">
        <h1 className="text-2xl font-semibold">页面暂时无法加载</h1>
        <p className="text-muted-foreground">当前操作尚未完成，可以稍后重试。</p>
        <button
          className="min-h-11 rounded-lg bg-primary px-4 font-medium text-primary-foreground"
          onClick={reset}
          type="button"
        >
          重试
        </button>
      </div>
    </main>
  );
}
