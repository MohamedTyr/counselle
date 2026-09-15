import { chromium, type FullConfig } from "@playwright/test";

const fixturePort = process.env.SCHOOL_CHANCES_FIXTURE_PORT ?? "4175";
const fixtureUrl = `http://127.0.0.1:${fixturePort}/dev/school-chances`;
const gallerySelector = '[data-slot="school-chances-gallery"]';

/**
 * Warm the development-only gallery through a real browser before the matrix
 * starts. HTTP-only checks can pass while Vite is still compiling the route's
 * React lazy module, which leaves the first test navigation with a blank shell.
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  const browser = await chromium.launch();

  try {
    const contexts = [
      { viewport: { width: 375, height: 900 } },
      { viewport: { width: 768, height: 1000 } },
      { viewport: { width: 1440, height: 1000 } },
      { viewport: { width: 375, height: 900 }, reducedMotion: "reduce" as const },
    ];

    for (const options of contexts) {
      const context = await browser.newContext(options);
      try {
        const page = await context.newPage();
        await page.route("**/v1/**", async (route) => {
          await route.fulfill({
            body: JSON.stringify({}),
            contentType: "application/json",
            status: 401,
          });
        });
        await page.goto(fixtureUrl, {
          timeout: 120_000,
          waitUntil: "domcontentloaded",
        });
        await page.locator(gallerySelector).waitFor({
          state: "visible",
          timeout: 120_000,
        });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}
