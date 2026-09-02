import type { ApiError, AuthSession } from "@photostream/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nextMocks = vi.hoisted(() => ({
  headers: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: nextMocks.headers }));
vi.mock("react", () => ({ cache: <FunctionType>(callback: FunctionType) => callback }));

import { ApiRequestError } from "./api";
import { getServerSession } from "./server-auth";

const session: AuthSession = {
  user: {
    id: "019d0000-0000-7000-8000-000000000001",
    username: "admin",
    displayName: "系统管理员",
    role: "admin",
    mustChangePassword: true,
  },
  csrfToken: "c".repeat(32),
  permissions: ["user:manage"],
};

function apiError(code: ApiError["code"]): ApiError {
  return {
    code,
    message: code,
    requestId: "request-id",
    retryable: false,
  };
}

describe("getServerSession", () => {
  beforeEach(() => {
    nextMocks.headers.mockResolvedValue(new Headers({ cookie: "session=token" }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("returns the authenticated session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(session)));

    await expect(getServerSession()).resolves.toEqual(session);
  });

  it("maps only AUTH_REQUIRED to a missing session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json(apiError("AUTH_REQUIRED"), { status: 401 })),
    );

    await expect(getServerSession()).resolves.toBeNull();
  });

  it.each(["AUTH_ORIGIN_INVALID", "AUTH_ACCOUNT_DISABLED"] as const)(
    "preserves %s as an API failure",
    async (code) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(Response.json(apiError(code), { status: 403 })),
      );

      const result = getServerSession();
      await expect(result).rejects.toBeInstanceOf(ApiRequestError);
      await expect(result).rejects.toMatchObject({
        name: "ApiRequestError",
        status: 403,
        response: expect.objectContaining({ code }),
      });
    },
  );

  it("does not treat an unrelated 401 response as a missing session", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(Response.json(apiError("AUTH_INVALID_CREDENTIALS"), { status: 401 })),
    );

    await expect(getServerSession()).rejects.toMatchObject({
      name: "ApiRequestError",
      status: 401,
      response: expect.objectContaining({ code: "AUTH_INVALID_CREDENTIALS" }),
    });
  });
});
