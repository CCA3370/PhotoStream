import { randomUUID } from "node:crypto";
import type { UserRole } from "@photostream/contracts";
import { describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import { hashSessionToken } from "./auth/crypto.js";
import type {
  AuthSessionRecord,
  AuthStore,
  AuthUserRecord,
  BootstrapUserInput,
  NewSessionRecord,
  PasswordHasher,
} from "./auth/types.js";
import { loadConfig } from "./config.js";

const adminId = "019d0000-0000-7000-8000-000000000001";

class FakeAuthStore implements AuthStore {
  readonly users = new Map<string, AuthUserRecord>();
  readonly sessions = new Map<string, AuthSessionRecord>();

  constructor() {
    this.addUser({
      id: adminId,
      username: "admin",
      normalizedUsername: "admin",
      displayName: "系统管理员",
      role: "admin",
      passwordHash: "hash:correct horse battery staple",
      isActive: true,
      mustChangePassword: true,
    });
  }

  async ping(): Promise<void> {}

  async findUserByNormalizedUsername(value: string): Promise<AuthUserRecord | null> {
    return this.users.get(value) ?? null;
  }

  async findSessionByTokenHash(value: string): Promise<AuthSessionRecord | null> {
    return this.sessions.get(value) ?? null;
  }

  async createSession(input: NewSessionRecord): Promise<string> {
    const user = [...this.users.values()].find((candidate) => candidate.id === input.userId);
    if (user === undefined) throw new Error("Unknown user");
    const id = randomUUID();
    this.sessions.set(input.tokenHash, {
      id,
      user,
      ...input,
      revokedAt: null,
    });
    return id;
  }

  async touchSession(id: string, lastSeenAt: Date, idleExpiresAt: Date): Promise<void> {
    for (const [key, session] of this.sessions) {
      if (session.id === id) this.sessions.set(key, { ...session, lastSeenAt, idleExpiresAt });
    }
  }

  async revokeSession(id: string, revokedAt: Date): Promise<void> {
    for (const [key, session] of this.sessions) {
      if (session.id === id) this.sessions.set(key, { ...session, revokedAt });
    }
  }

  async updatePasswordAndRevokeSessions(
    userId: string,
    passwordHash: string,
    changedAt: Date,
  ): Promise<void> {
    const user = [...this.users.values()].find((candidate) => candidate.id === userId);
    if (user === undefined) throw new Error("Unknown user");
    this.addUser({ ...user, passwordHash, mustChangePassword: false });
    for (const [key, session] of this.sessions) {
      if (session.user.id === userId) this.sessions.set(key, { ...session, revokedAt: changedAt });
    }
  }

  async createBootstrapAdmin(input: BootstrapUserInput): Promise<AuthUserRecord> {
    const user: AuthUserRecord = {
      id: randomUUID(),
      username: input.username,
      normalizedUsername: input.normalizedUsername,
      displayName: input.displayName,
      role: input.role,
      passwordHash: input.passwordHash,
      isActive: true,
      mustChangePassword: true,
    };
    this.addUser(user);
    return user;
  }

  addUser(user: AuthUserRecord): void {
    this.users.set(user.normalizedUsername, user);
  }
}

const fakeHasher: PasswordHasher = {
  async hash(value) {
    return `hash:${value}`;
  },
  async verify(hash, value) {
    return hash === `hash:${value}`;
  },
};

const config = loadConfig({
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: "3001",
  APP_ORIGIN: "http://localhost:3000",
  MEDIA_BASE_URL: "https://cdn.cloverta.top",
  DATABASE_URL: "postgresql://user:password@localhost:5432/photostream",
  SESSION_SECRET_CURRENT: "s".repeat(32),
  SESSION_SECRET_PREVIOUS: "p".repeat(32),
  CSRF_SECRET: "c".repeat(32),
  CURSOR_SIGNING_SECRET: "u".repeat(32),
});

function requestHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { host: "localhost:3000", origin: config.APP_ORIGIN, ...extra };
}

function cookieFrom(response: {
  headers: Record<string, string | string[] | number | undefined>;
}): string {
  const setCookie = response.headers["set-cookie"];
  const value = Array.isArray(setCookie) ? setCookie[0] : String(setCookie ?? "");
  if (value === undefined) throw new Error("Missing Set-Cookie");
  return value.split(";", 1)[0] ?? "";
}

describe("API foundation", () => {
  it("publishes OpenAPI from the same runtime schemas", async () => {
    const app = await buildApp({
      config,
      authStore: new FakeAuthStore(),
      passwordHasher: fakeHasher,
      logger: false,
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/openapi.json",
      headers: requestHeaders(),
    });
    expect(response.statusCode).toBe(200);
    const document = response.json<{ paths: Record<string, unknown> }>();
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining([
        "/api/v1/auth/login",
        "/api/v1/auth/session",
        "/api/v1/auth/change-password",
        "/api/v1/auth/logout",
      ]),
    );
    await app.close();
  });

  it("returns a stable validation error and rejects unknown fields", async () => {
    const app = await buildApp({
      config,
      authStore: new FakeAuthStore(),
      passwordHasher: fakeHasher,
      logger: false,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: requestHeaders(),
      payload: { username: "admin", password: "wrong", role: "admin" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "BAD_REQUEST",
      message: "请求参数无效",
      retryable: false,
    });
    expect(response.json()).toHaveProperty("requestId");
    await app.close();
  });

  it("establishes an HttpOnly session and enforces CSRF on writes", async () => {
    const app = await buildApp({
      config,
      authStore: new FakeAuthStore(),
      passwordHasher: fakeHasher,
      logger: false,
    });

    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: requestHeaders(),
      payload: { username: "ADMIN", password: "correct horse battery staple" },
    });
    expect(login.statusCode).toBe(200);
    expect(login.headers["cache-control"]).toBe("no-store");
    expect(login.headers["set-cookie"]).toContain("HttpOnly");
    expect(login.headers["set-cookie"]).toContain("SameSite=Lax");
    const cookie = cookieFrom(login);
    const sessionBody = login.json<{
      csrfToken: string;
      permissions: string[];
      user: { role: UserRole };
    }>();
    expect(sessionBody.user.role).toBe("admin");
    expect(sessionBody.permissions).toContain("user:manage");

    const missingCsrf = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: requestHeaders({ cookie }),
    });
    expect(missingCsrf.statusCode).toBe(403);
    expect(missingCsrf.json()).toMatchObject({ code: "AUTH_CSRF_INVALID" });

    const logout = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: requestHeaders({ cookie, "x-csrf-token": sessionBody.csrfToken }),
    });
    expect(logout.statusCode).toBe(200);
    expect(logout.json()).toEqual({ ok: true });

    const expired = await app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: requestHeaders({ cookie }),
    });
    expect(expired.statusCode).toBe(401);
    expect(expired.json()).toMatchObject({ code: "AUTH_REQUIRED" });
    await app.close();
  });

  it("rotates the session after a successful first-password change", async () => {
    const app = await buildApp({
      config,
      authStore: new FakeAuthStore(),
      passwordHasher: fakeHasher,
      logger: false,
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: requestHeaders(),
      payload: { username: "admin", password: "correct horse battery staple" },
    });
    const oldCookie = cookieFrom(login);
    const loginBody = login.json<{ csrfToken: string }>();

    const changed = await app.inject({
      method: "POST",
      url: "/api/v1/auth/change-password",
      headers: requestHeaders({
        cookie: oldCookie,
        "x-csrf-token": loginBody.csrfToken,
      }),
      payload: {
        currentPassword: "correct horse battery staple",
        newPassword: "new correct horse battery staple",
      },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.headers["cache-control"]).toBe("no-store");
    expect(changed.json()).toMatchObject({ user: { mustChangePassword: false } });
    const newCookie = cookieFrom(changed);
    expect(newCookie).not.toBe(oldCookie);

    const oldSession = await app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: requestHeaders({ cookie: oldCookie }),
    });
    expect(oldSession.statusCode).toBe(401);

    const newSession = await app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: requestHeaders({ cookie: newCookie }),
    });
    expect(newSession.statusCode).toBe(200);
    expect(newSession.json()).toMatchObject({ user: { mustChangePassword: false } });
    await app.close();
  });

  it("accepts sessions hashed with the previous rotation key", async () => {
    const store = new FakeAuthStore();
    const user = store.users.get("admin");
    if (user === undefined) throw new Error("Expected admin fixture");
    const rawToken = "previous-key-session-token";
    const tokenHash = hashSessionToken(rawToken, "p".repeat(32));
    const now = new Date();
    store.sessions.set(tokenHash, {
      id: randomUUID(),
      tokenHash,
      user,
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt: new Date(now.getTime() + 60_000),
      absoluteExpiresAt: new Date(now.getTime() + 120_000),
      revokedAt: null,
    });
    const app = await buildApp({
      config,
      authStore: store,
      passwordHasher: fakeHasher,
      logger: false,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: requestHeaders({ cookie: `photostream_session=${rawToken}` }),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ user: { id: adminId } });
    await app.close();
  });

  it("rejects cross-origin login requests before authentication", async () => {
    const app = await buildApp({
      config,
      authStore: new FakeAuthStore(),
      passwordHasher: fakeHasher,
      logger: false,
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { host: "localhost:3000", origin: "https://attacker.example" },
      payload: { username: "admin", password: "correct horse battery staple" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "AUTH_ORIGIN_INVALID" });
    await app.close();
  });
});
