export default function NotFound() {
  return (
    <main className="workbench-theme grid min-h-screen place-items-center bg-background p-6 text-foreground">
      <div className="flex max-w-md flex-col gap-3 text-center">
        <h1 className="text-2xl font-semibold">页面不可用</h1>
        <p className="text-muted-foreground">请检查链接，或返回活动列表。</p>
        <a className="font-medium text-primary underline-offset-4 hover:underline" href="/studio">
          返回活动列表
        </a>
      </div>
    </main>
  );
}
