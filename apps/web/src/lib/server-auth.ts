import {
  type ApiError,
  type AuthSession,
  apiErrorSchema,
  authSessionSchema,
  type UserRole,
} from "@photostream/contracts";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { ApiRequestError, apiInternalUrl } from "./api";

async function readApiError(response: Response): Promise<ApiError | null> {
  try {
    const parsed = apiErrorSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const getServerSession = cache(async (): Promise<AuthSession | null> => {
  const cookieHeader = (await headers()).get("cookie") ?? "";
  const response = await fetch(`${apiInternalUrl}/api/v1/auth/session`, {
    cache: "no-store",
    headers: { cookie: cookieHeader },
  });
  if (!response.ok) {
    const error = await readApiError(response);
    if (response.status === 401 && error?.code === "AUTH_REQUIRED") {
      return null;
    }
    throw new ApiRequestError(response.status, error);
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
