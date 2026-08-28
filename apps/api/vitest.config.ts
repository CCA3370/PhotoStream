import { defineConfig } from "vitest/config";

export default defineConfig({
  root: import.meta.dirname,
  test: {
    exclude: ["src/**/*.capacity.test.ts", "src/**/*.integration.test.ts"],
    include: ["src/**/*.test.ts"],
  },
});
