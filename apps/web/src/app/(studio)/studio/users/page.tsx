import { requireInternalSession } from "@/lib/server-auth";

export default async function UsersPage() {
  await requireInternalSession(["admin"]);
  return (
    <section className="flex flex-col gap-2" aria-labelledby="users-title">
      <h2 className="text-xl font-semibold" id="users-title">
        成员界面壳
      </h2>
      <p className="text-muted-foreground">管理员成员管理将在运营阶段接入。</p>
    </section>
  );
}
