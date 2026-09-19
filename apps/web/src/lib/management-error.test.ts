import { describe, expect, it } from "vitest";

import { managementErrorMessage } from "./management-error";

describe("managementErrorMessage", () => {
  it("preserves a raw runtime error", () => {
    expect(managementErrorMessage(new Error("WebGPU device lost"))).toBe("WebGPU device lost");
  });

  it("preserves API code, server message, request id and retryability", () => {
    const error = Object.assign(new Error("friendly text"), {
      name: "ClientApiError",
      response: {
        code: "STATE_CONFLICT",
        message: "expected generation 12 but received 13",
        requestId: "req-123",
        retryable: false,
      },
    });

    expect(managementErrorMessage(error)).toBe(
      "[STATE_CONFLICT] expected generation 12 but received 13 requestId=req-123 retryable=false",
    );
  });

  it("serializes non-Error diagnostic values", () => {
    expect(managementErrorMessage({ phase: "webgpu", status: 7 })).toBe(
      '{"phase":"webgpu","status":7}',
    );
  });
});
