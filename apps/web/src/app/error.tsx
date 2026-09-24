"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: Readonly<{ reset: () => void }>) {
  return (
    <main className="workbench-theme grid min-h-screen place-items-center bg-background p-6 text-foreground">
      <div className="flex max-w-md flex-col gap-4 text-center">
        <h1 className="text-2xl font-semibold">页面暂时无法加载</h1>
        <p className="text-muted-foreground">当前操作尚未完成，可以稍后重试。</p>
        <Button className="min-h-11 px-4" onClick={reset} type="button">
          重试
        </Button>
      </div>
    </main>
  );
}
