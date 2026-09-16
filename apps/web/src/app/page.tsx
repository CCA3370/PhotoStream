import type { Metadata } from "next";
import { CameraIcon, DownloadIcon, RadioIcon, ScanFaceIcon, Share2Icon } from "lucide-react";

export const metadata: Metadata = {
  title: "影像直播",
  description: "北航实验学校中学部暨北航实验学校分校活动影像直播观众入口",
};

const features = [
  {
    icon: RadioIcon,
    title: "实时更新",
    description: "活动照片发布后会持续更新，无需反复刷新页面。",
  },
  {
    icon: ScanFaceIcon,
    title: "快速找图",
    description: "支持使用找照片功能，从大量活动照片中更快找到目标人物。",
  },
  {
    icon: DownloadIcon,
    title: "保存照片",
    description: "在活动允许的范围内查看大图并下载需要的照片。",
  },
  {
    icon: Share2Icon,
    title: "便捷分享",
    description: "可通过活动页面提供的分享方式，将照片或页面分享给其他观众。",
  },
] as const;

export default function HomePage() {
  return (
    <div className="public-theme min-h-dvh bg-background text-foreground">
      <a
        className="sr-only rounded-lg bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
        href="#main-content"
      >
        跳到主要内容
      </a>

      <header className="border-b border-border/60 bg-background/95 backdrop-blur-xl supports-[backdrop-filter]:bg-background/85">
        <div className="mx-auto flex min-h-16 max-w-6xl items-center px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <CameraIcon aria-hidden="true" className="size-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-[11px] font-medium text-muted-foreground sm:text-xs">
                北航实验学校中学部暨北航实验学校分校
              </p>
              <p className="truncate text-base font-semibold tracking-tight sm:text-lg">中学部影像直播</p>
            </div>
          </div>
        </div>
      </header>

      <main id="main-content">
        <section className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[1.25fr_0.75fr] lg:items-center lg:gap-16 lg:px-8 lg:py-24">
          <div className="max-w-3xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm">
              <RadioIcon aria-hidden="true" className="size-3.5 text-primary" />
              观众入口
            </div>
            <h1 className="text-4xl font-semibold tracking-[-0.035em] text-balance sm:text-5xl lg:text-6xl">
              活动影像，实时抵达
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
              在活动现场通过主办方提供的二维码或专属链接进入相册，即可查看实时发布的活动照片，并使用找照片、查看大图、下载与分享等功能。
            </p>

            <div className="mt-8 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
              <p className="text-sm font-semibold">如何进入活动相册</p>
              <ol className="mt-4 grid gap-4 text-sm text-muted-foreground sm:grid-cols-3">
                <li className="flex gap-3 sm:block">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary sm:mb-3">1</span>
                  <span>扫描活动现场二维码，或打开主办方分享的专属链接。</span>
                </li>
                <li className="flex gap-3 sm:block">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary sm:mb-3">2</span>
                  <span>如活动设置了访问口令，请按提示输入口令进入相册。</span>
                </li>
                <li className="flex gap-3 sm:block">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary sm:mb-3">3</span>
                  <span>浏览实时照片，并按需使用找照片、下载和分享功能。</span>
                </li>
              </ol>
            </div>
          </div>

          <aside className="rounded-3xl border border-border bg-card p-6 shadow-sm sm:p-8" aria-label="访问说明">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground">
              <CameraIcon aria-hidden="true" className="size-6" />
            </div>
            <h2 className="mt-6 text-xl font-semibold tracking-tight">活动相册不会在首页公开列出</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              本平台用于校内活动的受控观看，不是公开图片社区。请以活动主办方提供的二维码、链接和访问口令为准。
            </p>
            <div className="mt-6 border-t border-border pt-5 text-xs leading-5 text-muted-foreground">
              如链接无法打开，请确认链接完整、活动仍在开放，并优先使用活动现场提供的最新入口。
            </div>
          </aside>
        </section>

        <section className="border-y border-border/60 bg-muted/35">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">面向观众的观看体验</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
                围绕现场浏览、快速找图和照片保存设计，尽量减少不必要的操作。
              </p>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {features.map(({ icon: Icon, title, description }) => (
                <article key={title} className="rounded-2xl border border-border bg-background p-5 shadow-sm">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon aria-hidden="true" className="size-5" />
                  </div>
                  <h3 className="mt-4 font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-8 text-center text-[11px] leading-5 text-muted-foreground sm:px-6 lg:px-8">
        <p>北航实验学校中学部暨北航实验学校分校 · 中学部影像直播</p>
        <p>© 2026 CCA3370 · Images © 2026 校团委学生会电视台</p>
      </footer>
    </div>
  );
}
