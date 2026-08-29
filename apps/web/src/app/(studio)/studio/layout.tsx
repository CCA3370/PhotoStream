import type { ReactNode } from "react";

import { StudioShell } from "@/components/shells/studio-shell";
import { requireInternalSession } from "@/lib/server-auth";

export default async function StudioLayout({ children }: Readonly<{ children: ReactNode }>) {
  const session = await requireInternalSession();
  return (
    <StudioShell
      pageTitle="活动"
      userDisplayName={session.user.displayName}
      userRole={session.user.role}
    >
      {children}
    </StudioShell>
  );
}
