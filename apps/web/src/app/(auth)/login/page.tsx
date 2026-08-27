import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { getServerSession } from "@/lib/server-auth";

export default async function LoginPage() {
  const session = await getServerSession();
  if (session !== null) {
    redirect(session.user.mustChangePassword ? "/change-password" : "/studio");
  }

  return (
    <main className="workbench-theme grid min-h-screen place-items-center bg-muted p-4 text-foreground">
      <section
        className="w-full max-w-md rounded-xl border bg-card p-6"
        aria-labelledby="login-title"
      >
        <div className="mb-6 flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">中学部影像直播</p>
          <h1 className="text-2xl font-semibold" id="login-title">
            内部人员登录
          </h1>
          <p className="text-sm text-muted-foreground">首次登录后必须修改临时密码。</p>
        </div>
        <LoginForm />
      </section>
    </main>
  );
}
