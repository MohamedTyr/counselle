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

  test("covers metric switching, drag, keyboard, exact entry, reset, and the no-comparison guard", async ({
    page,
  }, testInfo) => {
    const fullGpa = page.getByTestId("school-chances-gallery-fixture-full-gpa");
    const gpaSlider = fullGpa.getByRole("slider", { name: "GPA" });

    // Metric switching — the plot is the same product on every tab.
    await expect(
      fullGpa.getByText("Your 3.82 GPA sits in the 3.75 - 3.99 reported band."),
    ).toBeVisible();
    await fullGpa.getByRole("radio", { name: "SAT" }).click();
    await expect(fullGpa.getByRole("slider", { name: "SAT Math" })).toBeVisible();
    await fullGpa.getByRole("radio", { name: "ACT" }).click();
    await expect(
      fullGpa.getByRole("slider", { name: "ACT composite" }),
    ).toBeVisible();
    await fullGpa.getByRole("radio", { name: "GPA" }).click();
    await expect(gpaSlider).toBeVisible();

    // Drag — press anywhere on the plot, the mark follows 1:1. The fixture
    // gallery stacks every fixture on one long page, so raw `page.mouse`
    // coordinates need the target scrolled into view first — a locator
    // action like `.click()` does this automatically, but `boundingBox()`
    // does not.
    await gpaSlider.scrollIntoViewIfNeeded();
    const plotBox = await gpaSlider.boundingBox();
    expect(plotBox).not.toBeNull();
    await page.mouse.move(
      (plotBox?.x ?? 0) + (plotBox?.width ?? 0) * 0.5,
      (plotBox?.y ?? 0) + (plotBox?.height ?? 0) * 0.5,
      { steps: 5 },
    );
    await page.mouse.down();
    await page.mouse.move(
      (plotBox?.x ?? 0) + (plotBox?.width ?? 0) * 0.75,
      (plotBox?.y ?? 0) + (plotBox?.height ?? 0) * 0.5,
      { steps: 5 },
    );
    await page.mouse.up();
    const draggedValue = await gpaSlider.getAttribute("aria-valuenow");
    expect(draggedValue).not.toBe("3.82");

    // Keyboard — arrow steps by the metric's own 0.01 grid, Home/End to the
    // window ends, and focus stays on the plot throughout.
    await gpaSlider.focus();
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () => Number(await gpaSlider.getAttribute("aria-valuenow")))
      .toBeCloseTo(Number(draggedValue) + 0.01, 5);
    const beforeHome = Number(await gpaSlider.getAttribute("aria-valuenow"));
    await page.keyboard.press("Home");
    // `Home` jumps to the window's own low end — which the commit itself
    // can then re-pad/re-snap (`plotWindow()` folds the new value back in),
    // so the only stable assertion is the direction, not a fixed target.
    await expect
      .poll(async () => Number(await gpaSlider.getAttribute("aria-valuenow")))
      .toBeLessThan(beforeHome);
    const beforeEnd = Number(await gpaSlider.getAttribute("aria-valuenow"));
    await page.keyboard.press("End");
    await expect
      .poll(async () => Number(await gpaSlider.getAttribute("aria-valuenow")))
      .toBeGreaterThan(beforeEnd);
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe(
      "BODY",
    );

    // Exact entry — Enter opens the pill as a field; off-grid shows
    // errorCopy() inline and does not commit; a valid value does.
    await page.keyboard.press("Enter");
    const exactInput = fullGpa.getByLabel("Enter an exact value");
    await expect(exactInput).toBeFocused();
    // Out of range rather than off-grid-by-precision: the pill's own
    // `maxLength={4}` makes a 3-decimal GPA (needing 5+ characters)
    // untypeable, so this is the shortest string `onGrid()` still rejects.
    await exactInput.fill("4.01");
    await page.keyboard.press("Enter");
    await expect(fullGpa.getByText("Use increments of 0.01")).toBeVisible();
    await exactInput.fill("3.90");
    await page.keyboard.press("Enter");
    await expect(gpaSlider).toHaveAttribute("aria-valuenow", "3.9");
    await expect(gpaSlider).toBeFocused();

    // Reset — one word, only while a scenario differs from the saved value;
    // clicking it returns focus to the plot, never to <body>.
    const resetButton = fullGpa.getByRole("button", { name: "Reset" });
    await expect(resetButton).toBeVisible();
    await resetButton.click();
    await expect(resetButton).toHaveCount(0);
    await expect(gpaSlider).toBeFocused();

    // No comparison data — the plot never becomes draggable when there is
    // nothing honest to drag against.
    const noSchoolData = page.getByTestId(
      "school-chances-gallery-fixture-no-school-data",
    );
    await expect(noSchoolData.getByRole("slider")).toHaveCount(0);

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

  test("keeps a plot present but valueless with no saved comparison until the student sets one", async ({
    page,
  }) => {
    const noScore = page.getByTestId(
      "school-chances-gallery-fixture-no-student-score",
    );
    const mathSlider = noScore.getByRole("slider", { name: "SAT Math" });

    // No saved value, no scenario yet — the plot is still focusable and
    // reachable, it just has nothing to show until the first interaction
    // (ScrubbablePlot.tsx never invents a starting position).
    await expect(mathSlider).toBeVisible();
    await expect(noScore.locator('[data-slot="you-mark"]')).toHaveCount(0);

    await mathSlider.focus();
    await page.keyboard.press("Enter");
    const input = noScore.getByLabel("Enter an exact value");
    await input.fill("650");
    await page.keyboard.press("Enter");
    await expect(mathSlider).toHaveAttribute("aria-valuenow", "650");
  });

  test("shows the drag affordance hint once, then fades it permanently after the first successful drag", async ({
    page,
  }) => {
    const fullSat = page.getByTestId("school-chances-gallery-fixture-full-sat");
    const mathSlider = fullSat.getByRole("slider", { name: "SAT Math" });
    // SAT has two lanes, each with its own hint line under its own axis.
    const hint = fullSat.locator('[data-slot="scrub-affordance-hint"]');

    await expect(hint).toHaveCount(2);
    await expect(hint.first()).toHaveText("Drag to try a different score");

    await mathSlider.scrollIntoViewIfNeeded();
    const box = await mathSlider.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(
      (box?.x ?? 0) + (box?.width ?? 0) * 0.2,
      (box?.y ?? 0) + (box?.height ?? 0) * 0.5,
      { steps: 5 },
    );
    await page.mouse.down();
    await page.mouse.move(
      (box?.x ?? 0) + (box?.width ?? 0) * 0.6,
      (box?.y ?? 0) + (box?.height ?? 0) * 0.5,
      { steps: 5 },
    );
    await page.mouse.up();

    // Fades on every plot in the gallery, not just the one dragged — the
    // lesson is learned once per session (plan §5), not once per lane.
    await expect(hint).toHaveCount(0);
    const gpaHint = page
      .getByTestId("school-chances-gallery-fixture-full-gpa")
      .locator('[data-slot="scrub-affordance-hint"]');
    await expect(gpaHint).toHaveCount(0);
  });
});
