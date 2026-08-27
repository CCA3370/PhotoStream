import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

export default function StudioPage() {
  return (
    <section aria-labelledby="activity-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold" id="activity-heading">
            活动总览
          </h2>
          <p className="text-sm text-muted-foreground">阶段 1 界面壳；活动数据将在照片闭环接入。</p>
        </div>
        <Link className={buttonVariants()} href="/studio/albums/demo">
          查看示例相册
        </Link>
      </div>
      <div className="rounded-xl border bg-card p-5">
        <h3 className="font-semibold">暂无活动</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          创建相册能力将在阶段 2 接入 Fastify API。
        </p>
      </div>
    </section>
  );
}
