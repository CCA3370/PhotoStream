import { describe, expect, it } from "vitest";

import {
  apiErrorMessage,
  fieldErrorMessage,
  httpErrorMessage,
  responseErrorMessage,
  userFacingErrorMessage,
} from "./user-facing-error";

const rawApiError = {
  code: "BAD_REQUEST" as const,
  message: "请求参数无效: password is required",
  requestId: "request-1",
  retryable: false,
};

describe("user-facing errors", () => {
  it("maps API codes without exposing the raw backend message", () => {
    const message = apiErrorMessage(rawApiError);
    expect(message).toBe("提交的内容不完整或格式不正确，请检查后重试。");
    expect(message).not.toContain("请求参数无效");
    expect(message).not.toContain("password");
  });

  it("extracts nested API errors from client exceptions", () => {
    expect(userFacingErrorMessage({ response: rawApiError }, "fallback")).toBe(
      "提交的内容不完整或格式不正确，请检查后重试。",
    );
  });

  it("uses plain-language fallbacks for malformed responses", async () => {
    const response = new Response("gateway failed", { status: 502 });
    expect(await responseErrorMessage(response)).toBe("服务暂时不可用，请稍后重试。");
    expect(httpErrorMessage(502)).not.toContain("502");
  });

  it("replaces technical form validation text but keeps friendly copy", () => {
    expect(fieldErrorMessage("Too small: expected string to have >=1 characters")).toBe(
      "请检查填写内容是否完整、格式是否正确。",
    );
    expect(fieldErrorMessage("两次输入的新密码不一致")).toBe("两次输入的新密码不一致");
  });

  it("does not expose arbitrary exception messages", () => {
    expect(userFacingErrorMessage(new Error("SQLSTATE 23505 duplicate key"), "保存失败，请重试。")).toBe(
      "保存失败，请重试。",
    );
  });
});
