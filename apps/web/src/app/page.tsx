import {
  CameraIcon,
  DownloadIcon,
  ImageIcon,
  KeyRoundIcon,
  LinkIcon,
  ScanFaceIcon,
} from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "影像直播",
  description: "北航实验学校中学部暨北航实验学校分校活动影像直播观众入口",
};

const capabilities = [
  {
    icon: ImageIcon,
    title: "实时浏览",
    description: "活动照片发布后即可在相册中查看。",
  },
  {
    icon: ScanFaceIcon,
    title: "找照片",
    description: "在支持的活动中，可使用找照片功能快速筛选。",
  },
  {
    icon: DownloadIcon,
    title: "下载与分享",
    description: "按活动开放范围查看大图、保存或分享照片。",
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

      <header className="border-b border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-4 sm:px-6 lg:h-[72px] lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground lg:size-10">
              <CameraIcon aria-hidden="true" className="size-[18px] lg:size-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight lg:text-[15px]">
                中学部影像直播
              </p>
              <p className="hidden truncate text-[11px] text-muted-foreground sm:block">
                北航实验学校中学部暨北航实验学校分校
              </p>
            </div>
          </div>

          <nav
            aria-label="首页导航"
            className="hidden items-center gap-7 text-sm text-muted-foreground sm:flex"
          >
            <a className="transition-colors hover:text-foreground" href="#access">
              活动相册
            </a>
            <a className="transition-colors hover:text-foreground" href="#features">
              平台功能
            </a>
            <a className="transition-colors hover:text-foreground" href="#about">
              关于平台
            </a>
          </nav>
        </div>
      </header>

      <main id="main-content">
        <section className="border-b border-border/60">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:gap-20 lg:px-8 lg:py-24">
            <div className="max-w-2xl">
              <p className="text-sm font-medium text-primary">校园活动影像平台</p>
              <h1 className="mt-3 text-4xl font-semibold tracking-[-0.035em] sm:text-5xl lg:text-[56px] lg:leading-[1.08]">
                中学部影像直播
              </h1>
              <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
                用于学校活动照片的实时发布与查看。观众通过活动专属链接或现场二维码进入对应相册。
              </p>
            </div>

            <div
              className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-7"
              id="access"
            >
              <div className="flex items-start gap-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-secondary-foreground">
                  <LinkIcon aria-hidden="true" className="size-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold">进入活动相册</h2>
                  <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                    扫描活动现场二维码，或打开主办方提供的专属链接。
                  </p>
                </div>
              </div>

              <div className="my-5 border-t border-border" />

              <div className="flex items-start gap-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-secondary-foreground">
                  <KeyRoundIcon aria-hidden="true" className="size-5" />
                </div>
                <div>
                  <h2 className="text-sm font-medium">访问口令</h2>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    部分活动设有访问口令，请按页面提示输入。
                  </p>
                </div>
              </div>

              <p className="mt-5 rounded-lg bg-muted px-3.5 py-3 text-xs leading-5 text-muted-foreground">
                活动相册不在首页公开列出，请以活动主办方提供的入口为准。
              </p>
            </div>
          </div>
        </section>

        <section className="border-b border-border/60 bg-muted/25" id="features">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
            <div className="grid gap-8 lg:grid-cols-[0.8fr_2.2fr] lg:gap-16">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">平台功能</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  面向活动现场浏览场景，保留必要的查看和保存能力。
                </p>
              </div>

              <div className="grid divide-y divide-border border-y border-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                {capabilities.map(({ icon: Icon, title, description }) => (
                  <div className="py-5 sm:px-6 sm:py-1 sm:first:pl-0 sm:last:pr-0" key={title}>
                    <Icon aria-hidden="true" className="size-5 text-primary" />
                    <h3 className="mt-3 text-sm font-semibold">{title}</h3>
                    <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="about">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[0.8fr_2.2fr] lg:gap-16 lg:px-8 lg:py-16">
            <h2 className="text-2xl font-semibold tracking-tight">关于平台</h2>
            <div className="flex max-w-3xl flex-col gap-4 text-sm leading-7 text-muted-foreground sm:text-[15px]">
              <p>
                中学部影像直播用于北航实验学校中学部暨北航实验学校分校校内活动照片的发布与受控观看，由活动组织人员提供具体访问入口。
              </p>
              <p>
                不同活动的开放时间、访问权限和可用功能可能不同。如遇无法访问、口令失效等情况，请联系活动组织人员确认最新入口。
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/60 bg-muted/20">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-[11px] leading-5 text-muted-foreground sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <p>北航实验学校中学部暨北航实验学校分校 · 中学部影像直播</p>
          <p>© 2026 CCA3370 · Images © 2026 校团委学生会电视台</p>
        </div>
      </footer>
    </div>
  );
}
