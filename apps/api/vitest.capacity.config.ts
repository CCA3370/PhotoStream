import { defineConfig } from "vitest/config";

export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: ["src/**/*.capacity.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 60_000,
    sequence: { concurrent: false },
  },
});
