import { requireInternalSession } from "@/lib/server-auth";

export default async function AuditPage() {
  await requireInternalSession(["admin"]);
  return (
    <section className="flex flex-col gap-2" aria-labelledby="audit-title">
      <h2 className="text-xl font-semibold" id="audit-title">
        审计界面壳
      </h2>
      <p className="text-muted-foreground">当前阶段已建立认证审计表，查询界面将在运营阶段接入。</p>
    </section>
  );
}
