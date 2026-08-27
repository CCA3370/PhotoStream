export default function Loading() {
  return (
    <main
      aria-busy="true"
      aria-label="正在加载"
      className="workbench-theme min-h-screen bg-background p-6 text-foreground"
    >
      <div className="mx-auto h-8 max-w-5xl rounded-lg bg-muted" />
    </main>
  );
}
