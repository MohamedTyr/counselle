import fs from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const artifactStamp =
  process.env.SCHOOL_CHANCES_ARTIFACT_STAMP ??
  new Date().toISOString().replace(/[:.]/g, "-");
const authState = path.resolve("playwright/.auth/local.json");

/**
 * Opt-in authenticated gate. Unlike the fixture config this intentionally
 * starts no server: the API, Vite, school UNITID, and approved local auth
 * state must be supplied by the operator.
 */
export default defineConfig({
  testDir: "./e2e",
  outputDir: path.resolve(
    "../artifacts/school-chances",
    artifactStamp,
    "test-output",
  ),
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: process.env.COUNSELLE_REAL_VITE_URL ?? "http://127.0.0.1:4173",
    // Do not let a missing opt-in auth file abort Playwright's global setup
    // with ENOENT. The real spec reports the actionable precondition instead.
    storageState: fs.existsSync(authState) ? authState : undefined,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "real-375",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 375, height: 900 },
      },
    },
    {
      name: "real-768",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 768, height: 1000 },
      },
    },
    {
      name: "real-1440",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
});

export { authState };
