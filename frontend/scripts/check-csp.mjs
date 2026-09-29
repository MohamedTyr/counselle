// Loads the landing pages in a real browser and fails on any Content-Security-
// Policy violation: the three pages, the waitlist dialog on both sides, and the
// school side's booking calendar. Violations inside the calendar's own frame
// are Google's and never reach this page. Analytics start only on acceptra.ai,
// so only a production run covers /ingest. Run by verify-landing.sh; usage:
//   node scripts/check-csp.mjs https://acceptra.ai
import { chromium } from "@playwright/test";

const base = (process.argv[2] ?? "").replace(/\/$/, "");
if (!base) {
  console.error("usage: check-csp.mjs <base-url>");
  process.exit(2);
}

/** Each visit: a path, and what must be on screen before it is judged. */
const VISITS = [
  { path: "/", ready: ".lp-hero h1" },
  { path: "/privacy", ready: "h1" },
  { path: "/terms", ready: "h1" },
  { path: "/#waitlist", ready: "[role=dialog] input[type=email]" },
  { path: "/#waitlist-schools", ready: "[role=dialog] iframe" },
];
/** Time for late requests (analytics, the calendar frame) to be attempted. */
const SETTLE_MS = 5000;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH ?? "/usr/bin/chromium",
});
let violations = 0;
try {
  for (const { path, ready } of VISITS) {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.__csp = [];
      document.addEventListener("securitypolicyviolation", (event) =>
        window.__csp.push(`${event.violatedDirective} ${event.blockedURI}`),
      );
    });
    let found;
    try {
      await page.goto(`${base}${path}`, { waitUntil: "load" });
      await page.locator(ready).first().waitFor({ state: "visible" });
      await page.waitForTimeout(SETTLE_MS);
      found = await page.evaluate(() => window.__csp);
    } catch (error) {
      found = [`never showed ${ready}: ${error.message.split("\n")[0]}`];
    }
    if (found.length) {
      violations += found.length;
      console.log(`  FAIL  CSP ${path}`);
      for (const line of new Set(found)) console.log(`          ${line}`);
    } else console.log(`  ok    CSP ${path}`);
    await page.close();
  }
} finally {
  await browser.close();
}
process.exit(violations ? 1 : 0);
