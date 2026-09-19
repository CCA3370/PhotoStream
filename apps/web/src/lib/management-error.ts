export function managementErrorMessage(error: unknown, fallback = "Unknown error"): string {
  if (error instanceof Error) {
    const response =
      "response" in error && typeof error.response === "object" && error.response !== null
        ? (error.response as {
            readonly code?: unknown;
            readonly message?: unknown;
            readonly requestId?: unknown;
            readonly retryable?: unknown;
          })
        : null;
    if (response !== null && typeof response.message === "string") {
      const code = typeof response.code === "string" ? response.code : error.name;
      const requestId =
        typeof response.requestId === "string" ? ` requestId=${response.requestId}` : "";
      const retryable =
        typeof response.retryable === "boolean" ? ` retryable=${String(response.retryable)}` : "";
      return `[${code}] ${response.message}${requestId}${retryable}`;
    }
    if (error.message.length > 0) {
      return error.name === "Error" ? error.message : `${error.name}: ${error.message}`;
    }
    return error.name || fallback;
  }
  if (typeof error === "string" && error.length > 0) return error;
  try {
    const serialized = JSON.stringify(error);
    return serialized === undefined || serialized === "{}" ? fallback : serialized;
  } catch {
    return String(error) || fallback;
  }
}
