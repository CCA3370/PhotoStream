import type { ApiError, AuthSession } from "@photostream/contracts";

export class ClientApiError extends Error {
  readonly response: ApiError | null;

  constructor(message: string, response: ApiError | null = null) {
    super(message);
    this.name = "ClientApiError";
    this.response = response;
  }
}

async function errorFrom(response: Response): Promise<ClientApiError> {
  try {
    const error = (await response.json()) as ApiError;
    return new ClientApiError(error.message, error);
  } catch {
    return new ClientApiError(`请求失败（${response.status}）`);
  }
}

export async function getClientSession(signal?: AbortSignal): Promise<AuthSession> {
  const response = await fetch("/api/v1/auth/session", {
    cache: "no-store",
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as AuthSession;
}

export async function clientGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store",
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as T;
}

export async function clientMutation<T>(
  path: string,
  options: {
    readonly body?: unknown;
    readonly confirmPassword?: string;
    readonly idempotencyKey?: string;
    readonly method?: "POST" | "PUT" | "PATCH" | "DELETE";
    readonly signal?: AbortSignal;
  } = {},
): Promise<T> {
  const session = await getClientSession(options.signal);
  const headers: Record<string, string> = {
    "x-csrf-token": session.csrfToken,
  };
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (options.confirmPassword !== undefined) {
    headers["x-confirm-password"] = options.confirmPassword;
  }
  if (options.idempotencyKey !== undefined) {
    headers["idempotency-key"] = options.idempotencyKey;
  }
  const response = await fetch(path, {
    method: options.method ?? "POST",
    headers,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as T;
}

export async function publicMutation<T>(
  path: string,
  options: {
    readonly body?: unknown;
    readonly idempotencyKey?: string;
    readonly method?: "POST" | "DELETE";
    readonly signal?: AbortSignal;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.idempotencyKey !== undefined) {
    headers["idempotency-key"] = options.idempotencyKey;
  }
  const response = await fetch(path, {
    method: options.method ?? "POST",
    headers,
    cache: "no-store",
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as T;
}
