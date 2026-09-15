import { defineConfig, devices } from "@playwright/test";

const fixturePort = process.env.SCHOOL_CHANCES_FIXTURE_PORT ?? "4175";

/**
 * Browser verification for the static Chances gallery. The gallery is a
 * development-only route and is deliberately served without the API, auth,
 * or a database so this pass stays deterministic and inexpensive.
 */
export default defineConfig({
  testDir: "./e2e",
  // The first cold lazy-route transform can be slow on a shared checkout;
  // keep the failure explicit while allowing that one startup to finish.
  timeout: 120_000,
  outputDir: "../test-results/school-chances-fixture",
  // The web server URL only proves that Vite can answer HTTP. Exercise the
  // real lazy route in Chromium before any project worker starts so the first
  // browser navigation cannot race the shared Vite transform graph.
  globalSetup: "./e2e/school-chances.global-setup.ts",
  // Vite's dev transform graph is shared by all browser projects. Starting
  // four Chromium workers at once makes the fixture intermittently serve a
  // blank shell while the route's lazy module graph is still transforming.
  // Keep the required viewport matrix, but load it through one deterministic
  // browser worker.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  // A retry can hide a fixture-server startup failure; this pass is intended
  // to prove a clean cold start every time.
  retries: 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "../playwright-report/school-chances" }],
  ],
  use: {
    baseURL: `http://127.0.0.1:${fixturePort}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
  },
  webServer: {
    command: "node scripts/serve-school-chances-fixture.mjs",
    url: `http://127.0.0.1:${fixturePort}/dev/school-chances`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium-375",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 375, height: 900 },
      },
    },
    {
      name: "chromium-1440",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "chromium-768",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 768, height: 1000 },
      },
    },
    {
      name: "chromium-reduced-motion",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 375, height: 900 },
        reducedMotion: "reduce",
      },
    },
  ],
});
