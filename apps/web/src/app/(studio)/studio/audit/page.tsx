import type { AuditLogList } from "@photostream/contracts";

import { AuditLogTable } from "@/components/audit/audit-log-table";
import { serverApi } from "@/lib/api";
import { requireInternalSession } from "@/lib/server-auth";

export default async function AuditPage() {
  await requireInternalSession(["admin"]);
  const logs = await serverApi<AuditLogList>("/api/v1/audit?limit=60");
  return (
    <section className="flex flex-col gap-2" aria-labelledby="audit-title">
      <h2 className="text-xl font-semibold" id="audit-title">
        审计
      </h2>
      <p className="text-muted-foreground">追踪成员、相册、媒体与删除任务的最小必要变更。</p>
      <AuditLogTable initial={logs} />
    </section>
  );
}
