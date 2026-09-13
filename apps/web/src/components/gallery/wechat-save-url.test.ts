import { describe, expect, it } from "vitest";

function isWeChatSaveableImageUrl(value: string, base = "https://photos.example.test/"): boolean {
  const url = new URL(value, base);
  return url.protocol === "http:" || url.protocol === "https:";
}

describe("WeChat lightbox save URL contract", () => {
  it("accepts HTTP(S) image URLs used by the native long-press save action", () => {
    expect(isWeChatSaveableImageUrl("https://cdn.example.test/photo.jpg?signature=abc")).toBe(true);
    expect(isWeChatSaveableImageUrl("/media/photo.jpg")).toBe(true);
  });

  it("rejects renderer-local blob URLs", () => {
    expect(isWeChatSaveableImageUrl("blob:https://photos.example.test/8d5e0b31")).toBe(false);
  });
});
