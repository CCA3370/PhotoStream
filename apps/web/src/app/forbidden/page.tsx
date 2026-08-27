import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

export default function ForbiddenPage() {
  return (
    <main className="workbench-theme grid min-h-screen place-items-center bg-background p-6 text-foreground">
      <section
        aria-labelledby="forbidden-title"
        className="flex max-w-md flex-col gap-4 text-center"
      >
        <h1 className="text-2xl font-semibold" id="forbidden-title">
          没有访问权限
        </h1>
        <p className="text-muted-foreground">当前角色不能访问此页面，请联系管理员。</p>
        <Link className={buttonVariants()} href="/studio">
          返回活动
        </Link>
      </section>
    </main>
  );
}
