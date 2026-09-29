import { defineConfig } from "@playwright/test";

const baseURL = process.env.LANDING_BASE_URL ?? "http://localhost:5173";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "landing-motion.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 30_000,
  outputDir: "../test-results/landing-motion",
  reporter: "list",
  use: {
    baseURL,
    viewport: { width: 1440, height: 1000 },
    launchOptions: {
      executablePath:
        process.env.CHROMIUM_EXECUTABLE_PATH ?? "/usr/bin/chromium",
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --host localhost --port 5173",
    url: `${baseURL}/landing.html`,
    reuseExistingServer: true,
  },
});
