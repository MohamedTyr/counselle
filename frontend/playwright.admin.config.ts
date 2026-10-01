import { defineConfig } from "@playwright/test";

// The waitlist admin against the real Pages Functions and a seeded local D1.
// ADMIN_DEV_EMAIL is the localhost-only bypass that stands in for Access.
const port = Number(process.env.ADMIN_E2E_PORT ?? 8788);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "landing-admin.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 30_000,
  outputDir: "../test-results/landing-admin",
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
    command: [
      "npm run build:landing",
      "npx wrangler d1 migrations apply acceptra-waitlist --local",
      "npx wrangler d1 execute acceptra-waitlist --local --file e2e/fixtures/waitlist-seed.sql",
      `npx wrangler pages dev dist-landing --port ${port} --inspector-port ${port + 1000} --binding ADMIN_DEV_EMAIL=e2e@seed.test`,
    ].join(" && "),
    url: `${baseURL}/admin/`,
    // The seed must be fresh: the spec deletes a row.
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
