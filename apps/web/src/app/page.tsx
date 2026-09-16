import type { Metadata } from "next";
import { CameraIcon } from "lucide-react";

export const metadata: Metadata = {
  title: "影像直播",
  description: "北航实验学校中学部暨北航实验学校分校活动影像直播观众入口",
};

export default function HomePage() {
  return (
    <div className="public-theme flex min-h-dvh flex-col bg-background text-foreground">
      <a
        className="sr-only rounded-lg bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
        href="#main-content"
      >
        跳到主要内容
      </a>

      <header className="border-b border-border/60">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4 sm:px-6 lg:px-8">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <CameraIcon aria-hidden="true" className="size-4.5" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight">中学部影像直播</p>
            <p className="truncate text-[11px] text-muted-foreground sm:text-xs">
              北航实验学校中学部暨北航实验学校分校
            </p>
          </div>
        </div>
      </header>

      <main className="flex flex-1 items-center" id="main-content">
        <div className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
          <div className="max-w-2xl">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">活动照片直播</h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground">
              查看学校活动现场实时发布的照片。
            </p>

            <div className="mt-8 border-t border-border pt-6">
              <h2 className="text-sm font-semibold">进入活动相册</h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                请扫描活动现场二维码，或打开主办方提供的活动链接。部分活动需要输入访问口令。
              </p>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                活动相册不会在首页公开展示。
              </p>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-border/60">
        <div className="mx-auto max-w-5xl px-4 py-5 text-[11px] text-muted-foreground sm:px-6 lg:px-8">
          © 2026 CCA3370 · Images © 2026 校团委学生会电视台
        </div>
      </footer>
    </div>
  );
}
