import { describe, expect, it } from "vitest";

import { hasPermission, loginRequestSchema, normalizeUsername, permissionsFor } from "./index.js";

describe("permission matrix", () => {
  it("grants administrators the complete permission set", () => {
    expect(permissionsFor("admin")).toHaveLength(10);
    expect(hasPermission("admin", "user:manage")).toBe(true);
    expect(hasPermission("admin", "media:upload")).toBe(true);
  });

  it("keeps reviewer and uploader capabilities separated", () => {
    expect(hasPermission("reviewer", "media:review")).toBe(true);
    expect(hasPermission("reviewer", "media:upload")).toBe(false);
    expect(hasPermission("uploader", "media:upload")).toBe(true);
    expect(hasPermission("uploader", "media:review")).toBe(false);
    expect(hasPermission("uploader", "user:manage")).toBe(false);
  });
});

describe("shared validation", () => {
  it("normalizes usernames deterministically", () => {
    expect(normalizeUsername("  Photo.Admin  ")).toBe("photo.admin");
  });

  it("rejects unknown login fields", () => {
    const result = loginRequestSchema.safeParse({
      username: "admin",
      password: "a password",
      role: "admin",
    });

    expect(result.success).toBe(false);
  });
});
