import { type AuthSession, authSessionSchema, type UserRole } from "@photostream/contracts";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { apiInternalUrl } from "@/lib/api";

export const getServerSession = cache(async (): Promise<AuthSession | null> => {
  const cookieHeader = (await headers()).get("cookie") ?? "";
  const response = await fetch(`${apiInternalUrl}/api/v1/auth/session`, {
    cache: "no-store",
    headers: { cookie: cookieHeader },
  });
  if (response.status === 401 || response.status === 403) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Authentication API failed with status ${response.status}`);
  }
  return authSessionSchema.parse(await response.json());
});

type RoleSession<Role extends UserRole> = Omit<AuthSession, "user"> & {
  readonly user: Omit<AuthSession["user"], "role"> & { readonly role: Role };
};

export function requireInternalSession(): Promise<AuthSession>;
export function requireInternalSession<const Roles extends readonly UserRole[]>(
  allowedRoles: Roles,
): Promise<RoleSession<Roles[number]>>;
export async function requireInternalSession(
  allowedRoles?: readonly UserRole[],
): Promise<AuthSession> {
  const session = await getServerSession();
  if (session === null) {
    redirect("/login");
  }
  if (session.user.mustChangePassword) {
    redirect("/change-password");
  }
  if (allowedRoles !== undefined && !allowedRoles.includes(session.user.role)) {
    redirect("/forbidden");
  }
  return session as AuthSession;
}
