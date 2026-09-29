import fs from "node:fs/promises";
import path from "node:path";

import { expect, test, type APIRequestContext } from "@playwright/test";

const API_URL = process.env.COUNSELLE_REAL_API_URL ?? "http://127.0.0.1:8000";
const VITE_URL = process.env.COUNSELLE_REAL_VITE_URL ?? "http://127.0.0.1:4173";
const UNITID = process.env.REAL_SCHOOL_UNITID;
const AUTH_STATE = "playwright/.auth/local.json";

async function preconditionFailures(
  request: APIRequestContext,
): Promise<string[]> {
  const failures: string[] = [];
  if (!UNITID || !/^\d+$/.test(UNITID)) {
    failures.push("REAL_SCHOOL_UNITID is unset or is not a numeric UNITID");
  }
  try {
    await fs.access(AUTH_STATE);
  } catch {
    failures.push(`authenticated storage state is missing at ${AUTH_STATE}`);
  }
  try {
    const response = await request.get(`${API_URL}/v1/health`, {
      timeout: 3_000,
    });
    if (!response.ok())
      failures.push(
        `API health at ${API_URL}/v1/health returned HTTP ${response.status()}`,
      );
  } catch {
    failures.push(
      `API is unreachable at ${API_URL}; start the local API on :8000`,
    );
  }
  try {
    const response = await request.get(`${VITE_URL}/login`, { timeout: 3_000 });
    if (!response.ok())
      failures.push(`Vite at ${VITE_URL} returned HTTP ${response.status()}`);
  } catch {
    failures.push(
      `Vite is unreachable at ${VITE_URL}; start it on the fixed Playwright port`,
    );
  }
  return failures;
}

test.describe("Explore admissions-fit estimate", () => {
  test.beforeAll(async ({ request }) => {
    const failures = await preconditionFailures(request);
    if (failures.length) {
      test.skip(
        true,
        `REAL Explore admissions-fit gate is OPEN — ${failures.join("; ")}`,
      );
    }
  });

  test("shows the admit rate and its band without horizontal overflow", async ({
    page,
  }, testInfo) => {
    if (!UNITID)
      throw new Error(
        "REAL_SCHOOL_UNITID was unexpectedly unavailable after preflight",
      );

    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));

    const schoolResponse = await page.goto(`/app/schools/${UNITID}`, {
      waitUntil: "networkidle",
    });
    expect(
      schoolResponse?.ok(),
      "School detail route did not return a successful document",
    ).toBe(true);
    const schoolName = await page
      .getByRole("heading", { level: 1 })
      .textContent();
    expect(
      schoolName?.trim(),
      "School detail route did not expose an h1 school name",
    ).toBeTruthy();
    if (!schoolName?.trim())
      throw new Error(
        "School name was unexpectedly unavailable after direct navigation",
      );

    await page.goto("/app/schools?tab=explore", {
      waitUntil: "networkidle",
    });
    const searchbox = page.getByRole("searchbox", { name: "Search schools" });
    await expect(searchbox).toBeVisible({ timeout: 20_000 });
    await searchbox.fill(schoolName.trim());

    const card = page
      .locator("article")
      .filter({
        has: page.locator(`a[href="/app/schools/${UNITID}"]`),
      })
      .first();
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(
      card.locator(`a[href="/app/schools/${UNITID}"]`),
    ).toHaveAttribute("href", `/app/schools/${UNITID}`);

    const fitGroup = card.getByRole("group", { name: /^Admit rate:/ });
    await expect(fitGroup).toBeVisible();

    // The band is derived from the rate printed beside it and nothing else,
    // so the zone is inert: no control, no disclosure, nothing to open.
    // `force` is required because the card's own full-card link overlay sits
    // above the band -- which is the point of the next assertion.
    await expect(fitGroup).toContainText(/%|Admit rate not available/);
    await expect(fitGroup.getByRole("button")).toHaveCount(0);
    await fitGroup.hover({ force: true });
    await expect(page.locator("[data-slot='popover-popup']")).toHaveCount(0);

    // With nothing interactive in the band, the whole card is one target.
    const band = await fitGroup.boundingBox();
    if (!band) throw new Error("The fit band had no layout box to click");
    await page.mouse.click(band.x + band.width / 2, band.y + band.height / 2);
    await expect(page).toHaveURL(new RegExp(`/app/schools/${UNITID}$`));
    await page.goBack();
    await expect(card).toBeVisible({ timeout: 20_000 });

    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await expect
      .poll(() => pageErrors.map((error) => error.message))
      .toEqual([]);

    await page.screenshot({
      path: path.join(
        testInfo.outputDir,
        `explore-admissions-fit-${testInfo.project.name}.png`,
      ),
      fullPage: true,
    });
  });
});
