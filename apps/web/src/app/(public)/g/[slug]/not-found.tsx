import { ImageOffIcon } from "lucide-react";
import Link from "next/link";

export default function GalleryNotFound() {
  return (
    <main className="public-theme grid min-h-dvh place-items-center bg-background px-5 py-10 text-foreground">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border bg-muted/40">
          <ImageOffIcon aria-hidden="true" className="size-6 text-muted-foreground" />
        </div>
        <p className="mt-5 text-xs font-medium text-muted-foreground">
          北航实验学校中学部暨北航实验学校分校
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">活动不存在</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
          该活动可能已结束服务、已被删除，或访问链接有误。
        </p>
        <Link
          className="mt-6 inline-flex min-h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          href="/"
        >
          返回首页
        </Link>
      </div>
    </main>
  );
}
