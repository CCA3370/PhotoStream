import type { AuditLogList } from "@photostream/contracts";

import { AuditLogTable } from "@/components/audit/audit-log-table";
import { serverApi } from "@/lib/api";
import { requireInternalSession } from "@/lib/server-auth";

export default async function AuditPage() {
  await requireInternalSession(["admin"]);
  const logs = await serverApi<AuditLogList>("/api/v1/audit?limit=60");
  return (
    <section aria-label="审计日志">
      <AuditLogTable initial={logs} />
    </section>
  );
}
