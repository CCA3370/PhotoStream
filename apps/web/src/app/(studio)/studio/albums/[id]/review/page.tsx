import { requireInternalSession } from "@/lib/server-auth";

export default async function ReviewPage() {
  await requireInternalSession(["admin", "reviewer"]);
  return (
    <section className="flex flex-col gap-2" aria-labelledby="review-title">
      <h2 className="text-xl font-semibold" id="review-title">
        审核界面壳
      </h2>
      <p className="text-muted-foreground">批量审核、号码复核和逐项结果将在后续阶段接入。</p>
    </section>
  );
}
