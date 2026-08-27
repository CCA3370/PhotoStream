import { redirect } from "next/navigation";

import { ChangePasswordForm } from "@/components/change-password-form";
import { getServerSession } from "@/lib/server-auth";

export default async function ChangePasswordPage() {
  const session = await getServerSession();
  if (session === null) {
    redirect("/login");
  }
  if (!session.user.mustChangePassword) {
    redirect("/studio");
  }

  return (
    <main className="workbench-theme grid min-h-screen place-items-center bg-muted p-4 text-foreground">
      <section
        aria-labelledby="change-password-title"
        className="w-full max-w-md rounded-xl border bg-card p-6"
      >
        <div className="mb-6 flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">{session.user.displayName}</p>
          <h1 className="text-2xl font-semibold" id="change-password-title">
            首次登录，请修改密码
          </h1>
          <p className="text-sm text-muted-foreground">保存后所有旧会话都会失效，并建立新会话。</p>
        </div>
        <ChangePasswordForm />
      </section>
    </main>
  );
}
