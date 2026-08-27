import { defineConfig } from "@playwright/test";

const usesExternalBrowser = process.env.BROWSER_CDP_URL !== undefined;
const appOrigin = process.env.E2E_APP_ORIGIN ?? "http://localhost:3000";

const config = {
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: "list" as const,
  use: {
    baseURL: appOrigin,
    trace: "retain-on-failure" as const,
    screenshot: "only-on-failure" as const,
  },
  ...(usesExternalBrowser
    ? {}
    : {
        webServer: {
          command: "./node_modules/.bin/next dev --hostname 127.0.0.1 --port 3000",
          cwd: ".",
          reuseExistingServer: true,
          url: "http://127.0.0.1:3000/compatibility",
          timeout: 60_000,
        },
      }),
};

export default defineConfig(config);
