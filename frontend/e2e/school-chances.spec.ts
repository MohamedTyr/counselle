import path from "node:path";

import { expect, test } from "@playwright/test";

test.describe("School Chances fixture gallery", () => {
  test.beforeEach(async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    // App-level auth bootstrap is intercepted so this development-only route
    // never depends on a running API or database. The gallery itself uses
    // static fixtures and the panel's Profile override.
    await page.route("**/v1/**", async (route) => {
      await route.fulfill({
        body: JSON.stringify({}),
        contentType: "application/json",
        status: 401,
      });
    });
    await page.goto("/dev/school-chances", { waitUntil: "networkidle" });
    await expect(
      page.getByRole("heading", { name: "School chances gallery" }),
    ).toBeVisible({ timeout: 120_000 });

    expect(
      pageErrors.map((error) => error.message),
      "The static gallery must not emit browser page errors",
    ).toEqual([]);
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
  });

  test("covers metric switching, missing-value entry, exploration, reset, and profile prompt", async ({
    page,
  }, testInfo) => {
    const fullGpa = page.getByTestId("school-chances-gallery-fixture-full-gpa");
    const metric = fullGpa.getByRole("radio");

    await expect(fullGpa.getByText("How your academics compare")).toBeVisible();
    await expect(metric.filter({ hasText: "GPA" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(
      fullGpa.locator('[data-slot="school-chances-plot-reveal"]'),
    ).toHaveAttribute(
      "data-reveal-state",
      testInfo.project.name === "chromium-reduced-motion"
        ? "visited"
        : "first-visit",
    );

    await metric.filter({ hasText: "SAT" }).click();
    await expect(fullGpa.getByText("Compared by section")).toBeVisible();
    await metric.filter({ hasText: "ACT" }).click();
    await expect(fullGpa.getByText("ACT composite").first()).toBeVisible();
    await metric.filter({ hasText: "GPA" }).click();
    await expect(
      fullGpa.getByText("Your 3.82 GPA", { exact: false }),
    ).toBeVisible();

    const noScore = page.getByTestId(
      "school-chances-gallery-fixture-no-student-score",
    );
    await noScore.getByRole("radio").filter({ hasText: "SAT" }).click();
    await expect(
      noScore.getByText(
        "Add your SAT section scores to place yourself on these charts.",
      ),
    ).toBeVisible();

    const mathInput = noScore.locator('input[aria-label="Math scenario"]');
    await mathInput.fill("650");
    await mathInput.press("Enter");
    await mathInput.blur();
    const mathSlider = noScore.getByRole("slider", {
      name: "Explore SAT Math",
    });
    await expect(mathSlider).toHaveAttribute("aria-valuenow", "650");

    const control = noScore.locator('[data-slot="slider-control"]').first();
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    await control.click({
      position: {
        x: Math.max(1, (box?.width ?? 2) * 0.7),
        y: (box?.height ?? 2) / 2,
      },
    });
    await expect(mathSlider).not.toHaveAttribute("aria-valuenow", "650");
    const pointerValue = await mathSlider.getAttribute("aria-valuenow");
    expect(pointerValue).not.toBeNull();

    await mathSlider.press("ArrowLeft");
    await expect(mathSlider).toHaveAttribute(
      "aria-valuenow",
      String(Number(pointerValue) - 10),
    );
    await expect(
      noScore.getByRole("button", { name: "Reset SAT" }),
    ).toBeVisible();
    await noScore.getByRole("button", { name: "Reset SAT" }).click();
    await expect(
      noScore.getByRole("button", { name: "Reset SAT" }),
    ).toHaveCount(0);
    await expect(
      noScore.getByText("Enter a value to start exploring").first(),
    ).toBeVisible();

    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await page.screenshot({
      path: path.join(
        testInfo.outputDir,
        `school-chances-${testInfo.project.name}.png`,
      ),
      fullPage: true,
    });
  });
});
