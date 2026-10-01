import { readdirSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";

// The admin page lists every signup, and PostHog session replay records the
// page and its network bodies, so nothing here may load analytics. The admin
// CSP (connect-src 'self') is the backstop. Resolved from the frontend root.
const DIR = "src/features/waitlist-admin";
const BANNED =
  /from\s+["'](?:posthog-js[^"']*|[^"']*landing\/analytics)["']|import\(\s*["'](?:posthog-js|[^"']*landing\/analytics)/;

it("never imports analytics", () => {
  const offenders = readdirSync(DIR, { recursive: true })
    .map(String)
    .filter((file) => /\.tsx?$/.test(file) && !file.endsWith(".test.ts"))
    .filter((file) => BANNED.test(readFileSync(`${DIR}/${file}`, "utf8")));
  expect(offenders).toEqual([]);
});
