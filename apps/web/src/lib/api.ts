import type { ApiError } from "@photostream/contracts";
import { headers } from "next/headers";

export const apiInternalUrl = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:3001";

export class ApiRequestError extends Error {
  readonly status: number;
  readonly response: ApiError | null;

  constructor(status: number, response: ApiError | null) {
    super(response?.message ?? `API request failed with status ${status}`);
    this.name = "ApiRequestError";
    this.status = status;
    this.response = response;
  }
}

export async function serverApi<T>(path: string): Promise<T> {
  const cookie = (await headers()).get("cookie") ?? "";
  const response = await fetch(`${apiInternalUrl}${path}`, {
    cache: "no-store",
    headers: { cookie },
  });
  if (!response.ok) {
    let error: ApiError | null = null;
    try {
      error = (await response.json()) as ApiError;
    } catch {
      // Preserve a generic error when an upstream response is not JSON.
    }
    throw new ApiRequestError(response.status, error);
  }
  return (await response.json()) as T;
}
