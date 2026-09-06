import type { AdminUserView } from "@photostream/contracts";

import { UserManagement } from "@/components/users/user-management";
import { serverApi } from "@/lib/api";
import { requireInternalSession } from "@/lib/server-auth";

export default async function UsersPage() {
  await requireInternalSession(["admin"]);
  const users = await serverApi<AdminUserView[]>("/api/v1/users");
  return (
    <section aria-label="成员管理">
      <UserManagement initialUsers={users} />
    </section>
  );
}
