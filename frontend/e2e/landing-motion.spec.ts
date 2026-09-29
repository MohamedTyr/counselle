import { expect, test, type Page } from "@playwright/test";

async function openLanding(page: Page) {
  await page.goto("/landing.html");
  await expect(page.locator(".lp-hero h1")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  // The hero tells its story in order; wait for it to settle before judging.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) => animation.effect?.getTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

for (const width of [390, 768, 1440]) {
  test(`landing remains readable and actionable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await openLanding(page);
    const cta = page.locator(".lp-nav-cta");
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute("href", "#waitlist");
    const box = await cta.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(
      await cta.evaluate((element) => getComputedStyle(element).opacity),
    ).toBe("1");
    const heading = await page.locator(".lp-hero h1").boundingBox();
    expect(heading?.width).toBeLessThanOrEqual(width);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    for (const tab of await page.getByRole("tab").all()) {
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      const panel = await page.getByRole("tabpanel").boundingBox();
      expect(panel?.x).toBeGreaterThanOrEqual(0);
      expect((panel?.x ?? 0) + (panel?.width ?? 0)).toBeLessThanOrEqual(width);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
    }
    await page.locator("#faq").scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  });
}

test("FAQ supports rapid pointer changes and immediate keyboard toggling", async ({
  page,
}) => {
  await openLanding(page);
  const toggles = page.locator(".lp-faq-toggle");
  for (const toggle of await toggles.all()) {
    const controls = await toggle.getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    await expect(page.locator(`[id="${controls}"]`)).toHaveCount(1);
  }
  await toggles.nth(1).click();
  await toggles.nth(2).click();
  await expect(toggles.nth(1)).toHaveAttribute("aria-expanded", "false");
  await expect(toggles.nth(2)).toHaveAttribute("aria-expanded", "true");
  await toggles.nth(2).press("Enter");
  await expect(toggles.nth(2)).toHaveAttribute("aria-expanded", "false");
  await expect(toggles.nth(2)).toBeFocused();
  await toggles.nth(2).press("Space");
  await expect(toggles.nth(2)).toHaveAttribute("aria-expanded", "true");
  await expect(toggles.nth(2)).toBeFocused();
});

test("content survives unavailable animation and observation APIs", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "IntersectionObserver", { value: undefined });
    Object.defineProperty(Element.prototype, "animate", { value: undefined });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openLanding(page);
  for (const selector of [
    ".lp-nav-cta",
    ".lp-essay-sheet",
    ".lp-note",
    ".lp-stage-list",
    "#faq-heading",
  ]) {
    const element = page.locator(selector).first();
    await element.scrollIntoViewIfNeeded();
    await expect(element).toBeVisible();
    expect(
      await element.evaluate((node) => getComputedStyle(node).opacity),
    ).toBe("1");
  }
  expect(errors).toEqual([]);
});

type RecordedMotion = {
  target: string;
  frames: Keyframe[];
  timing: KeyframeAnimationOptions;
};

async function recordMotion(page: Page) {
  await page.addInitScript(() => {
    const records: {
      target: string;
      frames: Keyframe[];
      timing: KeyframeAnimationOptions;
    }[] = [];
    Object.defineProperty(window, "landingMotionRecords", { value: records });
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      if (this.closest(".lp-hero, .lp-features")) {
        records.push({
          target: this.getAttribute("class") ?? "",
          frames: frames as Keyframe[],
          timing: typeof options === "object" ? options : { duration: options },
        });
      }
      return animate.call(this, frames, options);
    };
  });
}

async function motions(page: Page): Promise<RecordedMotion[]> {
  return page.evaluate(
    () =>
      (window as unknown as { landingMotionRecords: RecordedMotion[] })
        .landingMotionRecords,
  );
}

test("stage essay explanation replays when chosen again, not when scrolled back to", async ({
  page,
}) => {
  await recordMotion(page);
  await openLanding(page);
  const notes = async () =>
    (await motions(page)).filter((entry) => entry.target.includes("lp-note"))
      .length;
  const essay = page.locator(
    ".lp-stage-figure:not(.lp-stage-figure-leaving) .lp-essay-sheet",
  );
  await essay.scrollIntoViewIfNeeded();
  await expect.poll(notes).toBe(3);
  await page.locator("#faq").scrollIntoViewIfNeeded();
  await essay.scrollIntoViewIfNeeded();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(await notes()).toBe(3);
  await page.getByRole("tab").nth(1).click();
  await page.getByRole("tab").first().click();
  await expect(essay).toBeVisible();
  // Development builds mount twice, so count a replay rather than its exact size.
  await expect.poll(notes).toBeGreaterThan(3);
});

test("a replaced sheet leaves and the stage keeps its height", async ({
  page,
}) => {
  for (const width of [1440, 1366]) {
    await page.setViewportSize({ width, height: 1000 });
    await openLanding(page);
    const stage = page.locator(".lp-stage");
    const heights = new Set<number>();
    for (const tab of await page.getByRole("tab").all()) {
      await tab.click();
      await expect(page.locator(".lp-stage-figure-leaving")).toHaveCount(0);
      await expect(page.locator(".lp-stage-figure")).toHaveCount(1);
      heights.add(Math.round((await stage.boundingBox())!.height));
    }
    expect([...heights]).toHaveLength(1);
  }
});

test("reduced motion uses short opacity-only entrances without stagger", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await recordMotion(page);
  await openLanding(page);
  await page.locator(".lp-essay-sheet").scrollIntoViewIfNeeded();
  await page.getByRole("tab").nth(1).click();
  await expect
    .poll(
      async () =>
        (await motions(page)).filter((entry) =>
          entry.target.includes("lp-stage-figure"),
        ).length,
    )
    .toBeGreaterThan(0);
  const recorded = await motions(page);
  const selected = await page
    .getByRole("tab", { selected: true })
    .getAttribute("id");
  await page.waitForTimeout(7200);
  await expect(page.getByRole("tab", { selected: true })).toHaveAttribute(
    "id",
    selected as string,
  );
  await expect(
    page.getByRole("button", { name: /^(Play|Pause) showcase$/ }),
  ).toHaveCount(0);
  for (const entry of recorded) {
    expect(Number(entry.timing.delay ?? 0)).toBe(0);
    expect(Number(entry.timing.duration)).toBeLessThanOrEqual(200);
    for (const frame of entry.frames) {
      expect(frame.transform ?? "none").toBe("none");
    }
  }
});

test("stage tabs update their panel immediately from the keyboard", async ({
  page,
}) => {
  await recordMotion(page);
  await openLanding(page);
  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveCount(6);
  await tabs.nth(2).click();
  await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "true");
  const panel = page.getByRole("tabpanel");
  await expect(panel).toHaveAttribute(
    "aria-labelledby",
    (await tabs.nth(2).getAttribute("id")) as string,
  );
  await tabs.nth(2).press("ArrowDown");
  await expect(tabs.nth(3)).toBeFocused();
  await expect(tabs.nth(3)).toHaveAttribute("aria-selected", "true");
  await expect(panel).toHaveAttribute(
    "aria-labelledby",
    (await tabs.nth(3).getAttribute("id")) as string,
  );
  expect(
    await panel.evaluate(
      (element) =>
        element
          .getAnimations({ subtree: true })
          .filter(
            (animation) =>
              animation.effect?.getTiming().iterations !== Infinity &&
              animation.playState === "running",
          ).length,
    ),
  ).toBe(0);
});

test("showcase pause stops automatic changes until playback resumes", async ({
  page,
}) => {
  await openLanding(page);
  await page.locator(".lp-stage").scrollIntoViewIfNeeded();
  const pause = page.getByRole("button", {
    name: "Pause showcase",
    exact: true,
  });
  await pause.click();
  const active = page.getByRole("tab", { selected: true });
  const id = await active.getAttribute("id");
  await page.mouse.move(0, 0);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.waitForTimeout(7200);
  await expect(active).toHaveAttribute("id", id as string);
  await page
    .getByRole("button", { name: "Play showcase", exact: true })
    .click();
  await page.mouse.move(0, 0);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await expect(active).not.toHaveAttribute("id", id as string, {
    timeout: 9000,
  });
});

test.describe("touch showcase", () => {
  test.use({
    viewport: { width: 390, height: 1000 },
    hasTouch: true,
    isMobile: true,
  });

  test("starts still and explicit playback works while its control keeps focus", async ({
    page,
  }) => {
    await openLanding(page);
    await page.locator(".lp-stage").scrollIntoViewIfNeeded();
    const active = page.getByRole("tab", { selected: true });
    const initial = await active.getAttribute("id");
    await page.waitForTimeout(7200);
    await expect(active).toHaveAttribute("id", initial as string);
    await page
      .getByRole("button", { name: "Play showcase", exact: true })
      .tap();
    await expect(
      page.getByRole("button", { name: "Pause showcase", exact: true }),
    ).toBeFocused();
    await expect(active).not.toHaveAttribute("id", initial as string, {
      timeout: 9000,
    });
  });
});

test("unknown inherited variant names fall back to the approved stage", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/landing.html?features=constructor");
  await expect(
    page.getByRole("tablist", { name: "Features", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(6);
  expect(errors).toEqual([]);
});

test("each non-essay illustration demonstrates its feature after selection", async ({
  page,
}) => {
  await recordMotion(page);
  await openLanding(page);
  const demos = [
    ["colleges", "lp-popover"],
    ["scholarships", "lp-stream"],
    ["activities", "lp-activity-list"],
    ["sat", "lp-word"],
    ["deadlines", "lp-deadline"],
  ];
  for (const [feature, target] of demos) {
    await page.locator(`#lp-stage-tab-${feature}`).click();
    await expect
      .poll(async () =>
        (await motions(page)).some((entry) =>
          entry.target.split(" ").includes(target),
        ),
      )
      .toBe(true);
  }
});

for (const width of [390, 1440]) {
  for (const [feature, selector] of [
    ["activities", ".lp-activity-list"],
    ["scholarships", ".lp-stream"],
  ]) {
    test(`${feature} scrolls seamlessly forever at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await openLanding(page);
      await page.locator(`#lp-stage-tab-${feature}`).click();
      const track = page.locator(`.lp-stage ${selector}`);
      await expect
        .poll(() =>
          track.evaluate((element) =>
            element
              .getAnimations()
              .some(
                (animation) =>
                  animation.effect?.getTiming().iterations === Infinity,
              ),
          ),
        )
        .toBe(true);
      const result = await track.evaluate((element) => {
        // Settle the stage entrance so geometry only measures the list's motion.
        for (const animation of element
          .closest(".lp-stage-panel")!
          .getAnimations({ subtree: true })) {
          if (animation.effect?.getTiming().iterations !== Infinity)
            animation.finish();
        }
        const animation = element
          .getAnimations()
          .find((item) => item.effect?.getTiming().iterations === Infinity)!;
        animation.pause();
        const timing = animation.effect!.getTiming();
        const cycles = element.querySelectorAll<HTMLElement>(
          "[data-scroll-cycle]",
        );
        const viewport = element.parentElement!;
        const filter = element
          .closest(".lp-sheet")!
          .querySelector(".lp-filters");
        const filterY = filter?.getBoundingClientRect().top;
        const delay = Number(timing.delay);
        const duration = Number(timing.duration);
        animation.currentTime = delay;
        const firstY = cycles[0].getBoundingClientRect().top;
        const initialY = new DOMMatrix(getComputedStyle(element).transform).m42;
        animation.currentTime = delay + duration - 0.01;
        const seamY = cycles[1].getBoundingClientRect().top;
        const coversWindow = [0, 0.25, 0.5, 0.75, 0.9999].every((progress) => {
          animation.currentTime = delay + duration * progress;
          return (
            element.getBoundingClientRect().top <=
              viewport.getBoundingClientRect().top + 1 &&
            element.getBoundingClientRect().bottom >=
              viewport.getBoundingClientRect().bottom - 1
          );
        });
        // Fractional durations can round to the preceding iteration at the exact boundary.
        animation.currentTime = delay + duration + 0.01;
        return {
          easing: timing.easing,
          duration,
          sameRows: cycles[0].textContent === cycles[1].textContent,
          cycleHeight: cycles[0].offsetHeight,
          firstY,
          seamY,
          initialY,
          finalY: new DOMMatrix(getComputedStyle(element).transform).m42,
          coversWindow,
          filterY,
          finalFilterY: filter?.getBoundingClientRect().top,
          filterAnimations: filter?.getAnimations().length ?? 0,
        };
      });
      expect(result.easing).toBe("linear");
      expect(result.duration).toBeGreaterThan(2000);
      expect(result.cycleHeight).toBeGreaterThan(240);
      expect(result.sameRows).toBe(true);
      expect(result.seamY).toBeCloseTo(result.firstY, 1);
      expect(result.finalY).toBeCloseTo(result.initialY, 1);
      expect(result.coversWindow).toBe(true);
      expect(result.finalFilterY).toBe(result.filterY);
      expect(result.filterAnimations).toBe(0);
    });
  }
}

test("explicit pause freezes the loop and Play starts a newly selected loop", async ({
  page,
}) => {
  await recordMotion(page);
  await openLanding(page);
  await page.locator("#lp-stage-tab-activities").click();
  const list = page.locator(".lp-stage .lp-activity-list");
  await expect
    .poll(() => list.evaluate((element) => element.getAnimations().length))
    .toBeGreaterThan(0);
  await page
    .getByRole("button", { name: "Pause showcase", exact: true })
    .click();
  await expect
    .poll(() =>
      list.evaluate((element) => element.getAnimations()[0]?.playState),
    )
    .toBe("paused");
  const time = await list.evaluate((element) =>
    Number(element.getAnimations()[0].currentTime),
  );
  await page.waitForTimeout(150);
  expect(
    await list.evaluate((element) =>
      Number(element.getAnimations()[0].currentTime),
    ),
  ).toBe(time);
  await page
    .getByRole("button", { name: "Play showcase", exact: true })
    .click();
  await page.locator(".lp-stage-panel").scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      list.evaluate((element) => element.getAnimations()[0]?.playState),
    )
    .toBe("running");
  expect(
    await list.evaluate((element) =>
      Number(element.getAnimations()[0].currentTime),
    ),
  ).toBeGreaterThanOrEqual(time);
  expect(
    (await motions(page)).filter((entry) =>
      entry.target.split(" ").includes("lp-activity-list"),
    ),
  ).toHaveLength(1);
  await page
    .getByRole("button", { name: "Pause showcase", exact: true })
    .click();
  await page.locator("#lp-stage-tab-scholarships").click();
  const stream = page.locator(".lp-stage .lp-stream");
  await expect(stream).toBeVisible();
  expect(
    await stream.evaluate((element) => getComputedStyle(element).transform),
  ).toBe("none");
  expect(
    (await motions(page)).some((entry) =>
      entry.target.split(" ").includes("lp-stream"),
    ),
  ).toBe(false);
  await page
    .getByRole("button", { name: "Play showcase", exact: true })
    .click();
  await page.locator(".lp-stage-panel").scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      stream.evaluate((element) => element.getAnimations()[0]?.playState),
    )
    .toBe("running");
});

test("reduced motion shows list illustrations without inner scrolling", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openLanding(page);
  for (const [feature, selector] of [
    ["activities", ".lp-activity-list"],
    ["scholarships", ".lp-stream"],
  ]) {
    await page.locator(`#lp-stage-tab-${feature}`).click();
    const list = page.locator(`.lp-stage ${selector}`);
    await expect(list).toBeVisible();
    expect(
      await list.evaluate((element) => element.getAnimations().length),
    ).toBe(0);
    expect(
      await list.evaluate((element) => getComputedStyle(element).transform),
    ).toBe("none");
  }
});

test.describe("touch illustration motion", () => {
  test.use({
    viewport: { width: 390, height: 1000 },
    hasTouch: true,
    isMobile: true,
  });
  test("a stationary showcase still demonstrates a manually selected feature", async ({
    page,
  }) => {
    await openLanding(page);
    await page.locator("#lp-stage-tab-activities").tap();
    await page.locator(".lp-stage-panel").scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("button", { name: "Play showcase", exact: true }),
    ).toBeVisible();
    const list = page.locator(".lp-stage .lp-activity-list");
    await expect
      .poll(() =>
        list.evaluate((element) => element.getAnimations()[0]?.playState),
      )
      .toBe("running");
  });
});
