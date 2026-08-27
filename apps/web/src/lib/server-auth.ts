import { type AuthSession, authSessionSchema, type UserRole } from "@photostream/contracts";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

const apiInternalUrl = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:3001";

export async function getServerSession(): Promise<AuthSession | null> {
  const cookieHeader = (await headers()).get("cookie") ?? "";
  try {
    const response = await fetch(`${apiInternalUrl}/api/v1/auth/session`, {
      cache: "no-store",
      headers: { cookie: cookieHeader },
    });
    if (!response.ok) {
      return null;
    }
    return authSessionSchema.parse(await response.json());
  } catch {
    return null;
  }
}

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
  return session;
}
