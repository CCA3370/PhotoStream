import type { AdminUserView } from "@photostream/contracts";

import { UserManagement } from "@/components/users/user-management";
import { serverApi } from "@/lib/api";
import { requireInternalSession } from "@/lib/server-auth";

export default async function UsersPage() {
  await requireInternalSession(["admin"]);
  const users = await serverApi<AdminUserView[]>("/api/v1/users");
  return (
    <section className="flex flex-col gap-2" aria-labelledby="users-title">
      <h2 className="text-xl font-semibold" id="users-title">
        成员管理
      </h2>
      <p className="text-muted-foreground">创建内部账号、调整最小角色并吊销失效会话。</p>
      <UserManagement initialUsers={users} />
    </section>
  );
}
