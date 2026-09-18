import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useSearchParams } from "react-router";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { SchoolChancesPanel } from "./SchoolChancesPanel";
import { CHANCES_TRUTH_FOOTER } from "./school-chances-copy";
import {
  schoolChancesFactFixtures,
  schoolChancesProfileFixtures,
} from "./school-chances-fixtures";

const profileQuery = vi.hoisted(() => ({
  current: null as unknown,
}));

vi.mock("@/api/workspace/hooks/profile", () => ({
  useProfile: () => profileQuery.current,
}));

beforeEach(() => {
  profileQuery.current = {
    data: schoolChancesProfileFixtures.compatible,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  };
});

function PanelHarness() {
  const [params, setParams] = useSearchParams();
  return (
    <>
      <SchoolChancesPanel
        data={schoolChancesFactFixtures.full}
        metricParam={params.get("metric")}
        onMetricChange={(metric) =>
          setParams(
            (current) => {
              const next = new URLSearchParams(current);
              next.set("metric", metric);
              return next;
            },
            { replace: true },
          )
        }
      />
      <output data-testid="search">{params.toString()}</output>
    </>
  );
}

function renderPanel(initial?: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[`/app/schools/166027?${initial ?? "tab=chances"}`]}
      >
        <PanelHarness />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Drives `ScrubbablePlot`'s exact-entry path (plan §5) the way a student
 * would: `Enter` on the focused plot, type, `Enter` to commit. */
async function typeExactValue(slider: HTMLElement, value: string) {
  fireEvent.keyDown(slider, { key: "Enter" });
  const input = await screen.findByLabelText("Enter an exact value");
  fireEvent.input(input, { target: { value } });
  fireEvent.keyDown(input, { key: "Enter" });
}

/** The verdict sentence (`school-chances-copy.ts`'s `metricInterpretation`)
 * scoped to its own span — for a lane with no saved value, a per-lane plot
 * caption (`score-plot-copy.ts`'s `profilePlacementMessage`, a banned file
 * for this task) can render the identical absence clause beside the chart,
 * so an unscoped `getByText` on that exact string is ambiguous. */
const VERDICT_SELECTOR = { selector: '[data-slot="school-chances-interpretation-text"]' };
function findVerdict(text: string | RegExp) {
  return screen.findByText(text, VERDICT_SELECTOR);
}
function queryVerdict(text: string | RegExp) {
  return screen.queryByText(text, VERDICT_SELECTOR);
}

describe("SchoolChancesPanel", () => {
  test("uses the deterministic comparable default, preserves other search params, and renders the one flat frame", async () => {
    renderPanel("tab=chances&from=school-list&metric=not-a-metric");

    // The "How your academics compare" heading died with the P2 recompose
    // (plan §3) — the tab is already called Compare and the verdict
    // sentence below says what the panel is; it was a label for a labelled
    // thing. There is deliberately no heading here to find any more.
    expect(
      await screen.findByText(
        "Your 3.82 GPA sits in the 3.75 - 3.99 reported band.",
      ),
    ).toBeVisible();
    expect(
      document.querySelector('[data-slot="school-chances-panel"] h2'),
    ).toBeNull();
    expect(screen.getByText("Checked September 2026")).toBeVisible();
    expect(
      screen.getByRole("radio", { name: "GPA", checked: true }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Reported entering-class data — not a cutoff or a chance.",
      ),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("radio", { name: "SAT" }));
    await waitFor(() =>
      expect(
        screen.getByRole("radio", { name: "SAT", checked: true }),
      ).toBeVisible(),
    );
    expect(screen.getByTestId("search")).toHaveTextContent("tab=chances");
    expect(screen.getByTestId("search")).toHaveTextContent("from=school-list");
    expect(screen.getByTestId("search")).toHaveTextContent("metric=sat");
  });

  test("keeps off-grid saved values exact while leaving that explorer lane empty", async () => {
    const { container } = render(
      <SchoolChancesPanel
        data={schoolChancesFactFixtures.full}
        metricParam="gpa"
        profile={{ academics: { gpa_unweighted: "3.825", gpa_scale: "4.0" } }}
      />,
    );

    // The "You " label prefix died with academic-comparison-marks.tsx /
    // GpaComparisonMarkers.tsx (P1 shape rewrite) — the pill now shows only
    // the raw value, off-grid or not (P3's `ScrubbablePlot` draws the mark
    // from the raw saved value, never the 0.01-grid-snapped seed).
    await waitFor(() =>
      expect(
        container.querySelector('[data-slot="you-mark"][data-variant="you"]'),
      ).toHaveTextContent("3.825"),
    );
    // The plot is still a slider — off-grid only means nothing has been
    // typed onto its own step grid yet, not that the control disappears.
    expect(await screen.findByRole("slider", { name: "GPA" })).toHaveAttribute(
      "aria-valuenow",
      "3.825",
    );
    expect(
      screen.getByText(
        "Your saved GPA is more precise than this 0.01 explorer. Enter a two-decimal scenario to start.",
      ),
    ).toBeVisible();
  });

  test("starts a missing profile metric with no visible mark, then draws one after a valid exact-entry commit", async () => {
    render(
      <SchoolChancesPanel
        data={schoolChancesFactFixtures.full}
        metricParam="gpa"
        profile={null}
      />,
    );

    // The plot is present and focusable with nothing to compare against yet
    // — it never shows an invented starting position (ScrubbablePlot.tsx's
    // own honesty note), so there is no pill to find.
    const slider = await screen.findByRole("slider", { name: "GPA" });
    expect(
      document.querySelector('[data-slot="you-mark"]'),
    ).toBeNull();
    // FIX 1: the same honesty guard on the ARIA channel — no invented
    // aria-valuenow, and an explicit statement of absence a screen reader
    // actually announces instead.
    expect(slider).not.toHaveAttribute("aria-valuenow");
    expect(slider).toHaveAttribute("aria-valuetext", "No GPA set");

    await typeExactValue(slider, "3.8");

    expect(slider).toHaveAttribute("aria-valuenow", "3.8");
    expect(slider).toHaveAttribute("aria-valuetext", "Scenario set to 3.80 GPA.");
    expect(slider).toHaveFocus();
  });

  test("does not relabel an incompatible or scale-less GPA as a 4.0 GPA", async () => {
    const { rerender } = render(
      <SchoolChancesPanel
        data={schoolChancesFactFixtures.full}
        metricParam="gpa"
        profile={{ academics: { gpa_unweighted: "4.50", gpa_scale: "5.0" } }}
      />,
    );

    expect(await screen.findByText("4.50 / 5.0")).toBeVisible();
    expect(screen.queryByText("4.50 / 4.0")).toBeNull();

    rerender(
      <SchoolChancesPanel
        data={schoolChancesFactFixtures.full}
        metricParam="gpa"
        profile={{ academics: { gpa_unweighted: "3.82" } }}
      />,
    );
    expect(await screen.findByText("3.82")).toBeVisible();
    expect(screen.queryByText("3.82 / 4.0")).toBeNull();
  });

  test.each([
    ["not_reported", "The school did not report this band."],
    ["malformed", "The reported band has invalid bounds."],
  ] as const)(
    "keeps score interpretation independent when the distribution is usable but the band is %s",
    async (state, display) => {
      const facts = structuredClone(schoolChancesFactFixtures.full);
      const band = facts.sections[0]!.groups[0]!.facts.find(
        (fact) => fact.key === "class_profile.sat_math",
      )!;
      band.display = display;
      band.reported_period = "band 2024";
      if (state === "not_reported") {
        band.state = state;
        band.value = null;
      } else {
        band.state = "value";
        band.value = { p25: 800, p75: 700, min: 200, max: 800 };
      }

      render(
        <SchoolChancesPanel
          data={facts}
          metricParam="sat"
          profile={schoolChancesProfileFixtures.compatible}
        />,
      );

      const interpretation = document.querySelector(
        '[data-slot="school-chances-interpretation"]',
      );
      expect(interpretation).not.toBeNull();
      expect(interpretation!).toHaveTextContent("Middle 50% unavailable");
      expect(interpretation!).not.toHaveTextContent("Reported breakdown");
    },
  );

  test("uses a truthful comparison failure when both score distribution and band are invalid", async () => {
    const facts = structuredClone(schoolChancesFactFixtures.full);
    const group = facts.sections[0]!.groups[0]!;
    const band = group.facts.find(
      (fact) => fact.key === "class_profile.sat_math",
    )!;
    band.state = "value";
    band.value = { p25: 800, p75: 700, min: 200, max: 800 };
    const distribution = group.facts.find(
      (fact) => fact.key === "class_profile.sat_math_distribution",
    )!;
    distribution.state = "value";
    distribution.value = {
      ...(distribution.value as object),
      buckets: [{ label: "Score of 900 - 950", pct: 100 }],
    };

    render(
      <SchoolChancesPanel
        data={facts}
        metricParam="sat"
        profile={schoolChancesProfileFixtures.compatible}
      />,
    );

    const interpretation = document.querySelector(
      '[data-slot="school-chances-interpretation"]',
    );
    expect(interpretation).not.toBeNull();
    expect(interpretation!).toHaveTextContent("Data could not be compared");
  });

  test("does not seed the GPA explorer from an unvalidated empty profile value", async () => {
    render(
      <SchoolChancesPanel
        data={schoolChancesFactFixtures.full}
        metricParam="gpa"
        profile={{ academics: { gpa_unweighted: "", gpa_scale: "4.0" } }}
      />,
    );

    const slider = await screen.findByRole("slider", { name: "GPA" });
    expect(document.querySelector('[data-slot="you-mark"]')).toBeNull();
    expect(screen.queryByText(/Your saved GPA is more precise/)).toBeNull();

    await typeExactValue(slider, "3.8");
    expect(slider).toHaveAttribute("aria-valuenow", "3.8");
  });

  test("does not treat GPA average-only data as a comparable default", async () => {
    const facts = structuredClone(schoolChancesFactFixtures.full);
    const distribution = facts.sections[0]!.groups[0]!.facts.find(
      (fact) => fact.key === "class_profile.gpa_distribution",
    )!;
    distribution.state = "not_reported";
    distribution.value = null;

    render(
      <SchoolChancesPanel
        data={facts}
        metricParam="not-a-metric"
        profile={schoolChancesProfileFixtures.compatible}
      />,
    );

    expect(
      await screen.findByRole("radio", { name: "SAT", checked: true }),
    ).toBeVisible();
  });

  test("resets an entered scenario without a saved profile value", async () => {
    render(
      <SchoolChancesPanel
        data={schoolChancesFactFixtures.full}
        metricParam="gpa"
        profile={null}
      />,
    );
    const slider = await screen.findByRole("slider", { name: "GPA" });
    await typeExactValue(slider, "3.8");

    // The three old "Reset to your GPA" / "Reset SAT" / "Reset to your ACT"
    // variants collapse into one word (plan §5) — which metric is being
    // reset is unambiguous from context.
    expect(await screen.findByRole("button", { name: "Reset" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(document.querySelector('[data-slot="you-mark"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
  });

  test("uses the response-owned SAT footer wording verbatim", async () => {
    const facts = structuredClone(schoolChancesFactFixtures.full);
    facts.sections[0]!.groups[0]!.foot = "Exact reported-score context.";
    render(
      <SchoolChancesPanel
        data={facts}
        metricParam="sat"
        profile={schoolChancesProfileFixtures.compatible}
      />,
    );
    expect(
      await screen.findByText(/Exact reported-score context\./),
    ).toBeVisible();
  });

  test("uses only a matching, usable score band's response-owned group foot", async () => {
    const facts = structuredClone(schoolChancesFactFixtures.full);
    const group = facts.sections[0]!.groups[0]!;
    facts.sections[0]!.groups = [
      {
        ...group,
        id: "sat-bands",
        foot: "SAT group foot, exactly as reported.",
        facts: group.facts.filter((fact) =>
          fact.key.startsWith("class_profile.sat_"),
        ),
      },
      {
        ...group,
        id: "act-band",
        foot: "ACT group foot, exactly as reported.",
        facts: group.facts.filter((fact) =>
          fact.key.startsWith("class_profile.act_"),
        ),
      },
    ];

    const { rerender } = render(
      <SchoolChancesPanel
        data={facts}
        metricParam="sat"
        profile={schoolChancesProfileFixtures.compatible}
      />,
    );
    expect(await screen.findByText(/SAT group foot/)).toHaveTextContent(
      `${CHANCES_TRUTH_FOOTER} SAT group foot, exactly as reported.`,
    );
    expect(screen.queryByText(/ACT group foot/)).toBeNull();

    rerender(
      <SchoolChancesPanel
        data={facts}
        metricParam="act"
        profile={schoolChancesProfileFixtures.compatible}
      />,
    );
    expect(await screen.findByText(/ACT group foot/)).toHaveTextContent(
      `${CHANCES_TRUTH_FOOTER} ACT group foot, exactly as reported.`,
    );
    expect(screen.queryByText(/SAT group foot/)).toBeNull();
  });

  test("keeps the footer to the base truth when a score band is absent or malformed", async () => {
    const facts = structuredClone(schoolChancesFactFixtures.full);
    const group = facts.sections[0]!.groups[0]!;
    group.foot = "A foot that must not be inferred without a usable band.";
    for (const key of ["class_profile.sat_math", "class_profile.sat_ebrw"]) {
      const fact = group.facts.find((candidate) => candidate.key === key)!;
      fact.state = "not_reported";
      fact.value = null;
    }

    const { rerender } = render(
      <SchoolChancesPanel
        data={facts}
        metricParam="sat"
        profile={schoolChancesProfileFixtures.compatible}
      />,
    );
    expect(
      document.querySelector("[data-slot=school-chances-footer]"),
    ).toHaveTextContent(CHANCES_TRUTH_FOOTER);
    expect(
      document.querySelector("[data-slot=school-chances-footer]")?.textContent,
    ).toBe(CHANCES_TRUTH_FOOTER);

    const malformed = structuredClone(facts);
    const malformedBand = malformed.sections[0]!.groups[0]!.facts.find(
      (fact) => fact.key === "class_profile.sat_math",
    )!;
    malformedBand.state = "value";
    malformedBand.value = { p25: 800, p75: 700, min: 200, max: 800 };
    rerender(
      <SchoolChancesPanel
        data={malformed}
        metricParam="sat"
        profile={schoolChancesProfileFixtures.compatible}
      />,
    );
    expect(
      document.querySelector("[data-slot=school-chances-footer]")?.textContent,
    ).toBe(CHANCES_TRUTH_FOOTER);
  });

  // The `marker` column below used to be the old "You 3.82" callout label
  // (academic-comparison-marks.tsx / GpaComparisonMarkers.tsx); the pill now
  // shows only the raw value, so `marker` is just `value` again — kept as
  // its own column so the table still documents intent per row.
  test.each([
    ["gpa", "GPA", "3.82", "3.82"],
    ["sat", "SAT Math", "760", "760"],
    ["act", "ACT composite", "33", "33"],
  ] as const)(
    "does not create a second scenario surface when %s equals the saved profile",
    async (metric, ariaLabel, value, marker) => {
      const { container } = render(
        <SchoolChancesPanel
          data={schoolChancesFactFixtures.full}
          metricParam={metric}
          profile={schoolChancesProfileFixtures.compatible}
        />,
      );

      const slider = await screen.findByRole("slider", { name: ariaLabel });
      await typeExactValue(slider, value);

      const matchingMarks = () =>
        [...container.querySelectorAll('[data-slot="you-mark"]')].filter(
          (mark) => mark.textContent === marker,
        );
      await waitFor(() => expect(matchingMarks()).toHaveLength(1));
      expect(matchingMarks()[0]).toHaveAttribute("data-variant", "you");
      expect(screen.queryByText(/Your profile/)).toBeNull();
      expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
    },
  );

  test("FIX 3b/3c: reveals every GPA<->SAT<->ACT switch, not only a metric's first visit — 160ms, opacity + blur(3px)", async () => {
    profileQuery.current = {
      data: undefined,
      isPending: true,
      isError: false,
      refetch: vi.fn(),
    };
    const { rerender } = render(
      <SchoolChancesPanel
        data={schoolChancesFactFixtures.full}
        metricParam="gpa"
      />,
    );

    expect(
      document.querySelector("[data-slot=school-chances-skeleton]"),
    ).toBeVisible();
    profileQuery.current = {
      data: schoolChancesProfileFixtures.compatible,
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    };
    rerender(
      <SchoolChancesPanel
        data={schoolChancesFactFixtures.full}
        metricParam="gpa"
      />,
    );
    const firstGpaReveal = await screen.findByTestId(
      "school-chances-plot-reveal",
    );
    expect(firstGpaReveal).toHaveClass(
      "motion-safe:animate-in",
      "motion-safe:fade-in",
      "motion-safe:blur-in-3",
      "duration-[160ms]",
      "ease-out",
    );

    rerender(
      <SchoolChancesPanel
        data={schoolChancesFactFixtures.full}
        metricParam="sat"
      />,
    );
    const satReveal = await screen.findByTestId("school-chances-plot-reveal");
    expect(satReveal).toHaveClass("motion-safe:animate-in", "motion-safe:blur-in-3");

    // The common case (plan-reviewer's own framing): a student flipping
    // back to a metric they've already seen this session must still get
    // the reveal — an instant hard cut there was the actual defect.
    rerender(
      <SchoolChancesPanel
        data={schoolChancesFactFixtures.full}
        metricParam="gpa"
      />,
    );
    const returnedGpaReveal = await screen.findByTestId(
      "school-chances-plot-reveal",
    );
    expect(returnedGpaReveal).not.toBe(firstGpaReveal);
    expect(returnedGpaReveal).toHaveClass(
      "motion-safe:animate-in",
      "motion-safe:blur-in-3",
    );
  });

  test("keeps one metric's reveal mount through incidental rerenders without replaying it", async () => {
    const { rerender } = render(
      <SchoolChancesPanel
        data={schoolChancesFactFixtures.full}
        metricParam="gpa"
        profile={schoolChancesProfileFixtures.compatible}
      />,
    );

    const firstReveal = await screen.findByTestId("school-chances-plot-reveal");
    expect(firstReveal).toHaveAttribute("data-reveal-state", "revealing");
    expect(firstReveal).toHaveClass("motion-safe:animate-in");

    // Scenario edits and Reset are parent updates on the SAME metric (the
    // caller's `key={metric}` does not change) and must not remount, and so
    // must not replay, the reveal.
    const slider = await screen.findByRole("slider", { name: "GPA" });
    await typeExactValue(slider, "3.9");
    expect(screen.getByTestId("school-chances-plot-reveal")).toBe(firstReveal);
    expect(firstReveal).toHaveAttribute("data-reveal-state", "revealing");
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByTestId("school-chances-plot-reveal")).toBe(firstReveal);

    // A refetch-style parent update must not interrupt the one reveal.
    rerender(
      <SchoolChancesPanel
        data={{ ...schoolChancesFactFixtures.full }}
        metricParam="gpa"
        profile={schoolChancesProfileFixtures.compatible}
      />,
    );
    expect(screen.getByTestId("school-chances-plot-reveal")).toBe(firstReveal);
    expect(firstReveal).toHaveAttribute("data-reveal-state", "revealing");

    // A metric switch, unlike the above, DOES remount (and so DOES replay
    // the reveal — FIX 3b's own point).
    rerender(
      <SchoolChancesPanel
        data={schoolChancesFactFixtures.full}
        metricParam="sat"
        profile={schoolChancesProfileFixtures.compatible}
      />,
    );
    rerender(
      <SchoolChancesPanel
        data={schoolChancesFactFixtures.full}
        metricParam="gpa"
        profile={schoolChancesProfileFixtures.compatible}
      />,
    );
    const revisited = await screen.findByTestId("school-chances-plot-reveal");
    expect(revisited).not.toBe(firstReveal);
    expect(revisited).toHaveAttribute("data-reveal-state", "revealing");
    expect(revisited).toHaveClass("motion-safe:animate-in");
  });

  test("does not reveal a plot when reduced motion is requested", async () => {
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: query === "(prefers-reduced-motion: reduce)",
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as MediaQueryList,
    );

    try {
      render(
        <SchoolChancesPanel
          data={schoolChancesFactFixtures.full}
          metricParam="gpa"
          profile={schoolChancesProfileFixtures.compatible}
        />,
      );
      const reveal = await screen.findByTestId("school-chances-plot-reveal");
      expect(reveal).toHaveAttribute("data-reveal-state", "static");
      expect(reveal).not.toHaveClass("motion-safe:animate-in");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("does not offer an explorer when GPA has only an uncomparable average", async () => {
    const averageOnly = structuredClone(schoolChancesFactFixtures.full);
    averageOnly.sections[0]!.groups[0]!.facts =
      averageOnly.sections[0]!.groups[0]!.facts.filter(
        (fact) => fact.key === "class_profile.average_gpa",
      );

    render(
      <SchoolChancesPanel
        data={averageOnly}
        metricParam="gpa"
        profile={schoolChancesProfileFixtures.compatible}
      />,
    );

    await screen.findByText("Reported average 3.7");
    expect(screen.queryByLabelText("Explore GPA")).toBeNull();
    expect(screen.queryByText("Local scenario only")).toBeNull();
  });

  test("treats all-absent GPA buckets as unavailable with no axes or explorer", async () => {
    render(
      <SchoolChancesPanel
        data={schoolChancesFactFixtures.allAbsent}
        metricParam="gpa"
        profile={schoolChancesProfileFixtures.compatible}
      />,
    );
    // FIX 2: the distribution's own absence line no longer duplicates
    // itself inside the chart (whose contents are `aria-hidden` anyway) —
    // the number row's "Reported band"/"Of the class" cells are the one
    // visible place "Not reported" is now stated.
    expect(
      (
        await screen.findAllByText("Not reported", {
          selector: '[data-slot="school-chances-number-absent"]',
        })
      ).length,
    ).toBe(2);
    expect(
      document.querySelector(
        "[data-slot=gpa-comparison-unavailable] [data-school-state]",
      ),
    ).toBeNull();
    expect(
      document.querySelector("[data-slot=gpa-comparison-chart]"),
    ).toBeNull();
    expect(screen.queryByText("Explore")).toBeNull();
  });

  test("hides the SAT explorer lane that has neither a band nor a usable distribution", async () => {
    const facts = structuredClone(schoolChancesFactFixtures.full);
    facts.sections[0]!.groups[0]!.facts =
      facts.sections[0]!.groups[0]!.facts.filter(
        (fact) =>
          ![
            "class_profile.sat_ebrw",
            "class_profile.sat_ebrw_distribution",
          ].includes(fact.key),
      );
    render(
      <SchoolChancesPanel
        data={facts}
        metricParam="sat"
        profile={schoolChancesProfileFixtures.compatible}
      />,
    );
    expect(
      await screen.findByRole("slider", { name: "SAT Math" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("slider", { name: "SAT Reading and Writing" }),
    ).toBeNull();
  });

  test("rejects invalid entry without changing the last valid scenario, and reuses scenarioSetCopy() as the slider's own aria-valuetext", async () => {
    renderPanel();
    const slider = await screen.findByRole("slider", { name: "GPA" });
    expect(slider).toHaveAttribute("aria-valuenow", "3.82");

    fireEvent.keyDown(slider, { key: "Enter" });
    const input = await screen.findByLabelText("Enter an exact value");
    fireEvent.input(input, { target: { value: "4.01" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // Off-grid entry (plan §5) shows `errorCopy()` inline, under the pill,
    // and stays in edit mode without committing the bad value.
    expect(await screen.findByText("Use increments of 0.01")).toBeVisible();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(slider).toHaveAttribute("aria-valuenow", "3.82");

    fireEvent.input(input, { target: { value: "3.9" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // `aria-valuetext` reuses `scenarioSetCopy()` verbatim (plan §5) — the
    // old sr-only live-region announcement collapses into the native
    // mechanism a `role="slider"` already has.
    await waitFor(() =>
      expect(slider).toHaveAttribute("aria-valuetext", "Scenario set to 3.90 GPA."),
    );
    expect(slider).toHaveAttribute("aria-valuenow", "3.9");
    expect(screen.getByRole("button", { name: "Reset" })).toBeVisible();
  });

  test("renders the three-number row's absence grammar instead of blanks or dashes", async () => {
    render(
      <SchoolChancesPanel
        data={schoolChancesFactFixtures.allAbsent}
        metricParam="gpa"
        profile={null}
      />,
    );

    await screen.findAllByText("Not reported", {
      selector: '[data-slot="school-chances-number-absent"]',
    });
    const row = document.querySelector(
      '[data-slot="school-chances-numbers"]',
    );
    expect(row).not.toBeNull();
    // "You" (no saved profile) and "Reported band"/"Of the class" (every
    // bucket absent) all fall back to the DESIGN.md §15.5 absence
    // treatment — never blank, never a dash.
    const absentCells = row!.querySelectorAll(
      '[data-slot="school-chances-number-absent"]',
    );
    expect(absentCells.length).toBe(3);
    for (const cell of absentCells) {
      expect(cell.textContent).not.toBe("");
      expect(cell.textContent).not.toBe("—");
      expect(cell.textContent).not.toBe("-");
    }
    expect(screen.getByText("Not added")).toBeVisible();
    // FIX 2: "Not reported" used to appear a second time inside the chart's
    // own (aria-hidden) fallback text, duplicating these same two cells —
    // it now appears exactly where the row states it and nowhere else.
    expect(screen.getAllByText("Not reported")).toHaveLength(2);
  });

  test("only prints a per-field reported period on the number row when it diverges from the rest of the screen", async () => {
    const uniform = render(
      <SchoolChancesPanel
        data={schoolChancesFactFixtures.full}
        metricParam="act"
        profile={schoolChancesProfileFixtures.compatible}
      />,
    );
    // Every ACT fact in the fixture reports the same "2025-26" period, so
    // the number row states it once via the header freshness line instead
    // of repeating it beside every number (plan §6).
    expect(
      document.querySelector('[data-slot="school-chances-numbers"]'),
    ).not.toHaveTextContent("Reported 2025-26");
    uniform.unmount();

    const facts = structuredClone(schoolChancesFactFixtures.full);
    const band = facts.sections[0]!.groups[0]!.facts.find(
      (fact) => fact.key === "class_profile.act_composite",
    )!;
    band.reported_period = "2019-20";
    render(
      <SchoolChancesPanel
        data={facts}
        metricParam="act"
        profile={schoolChancesProfileFixtures.compatible}
      />,
    );
    expect(
      await screen.findByText("Reported 2019-20"),
    ).toBeVisible();
  });

  /**
   * Plan §4: `SatComparison`'s deleted "Your SAT 1500 shown for context"
   * caption moves into the verdict sentence rather than vanishing — the
   * one screen-reader-reachable place for that fact now that it no longer
   * has a paragraph of its own.
   */
  test("folds the saved SAT total into the verdict sentence instead of a floating caption", async () => {
    render(
      <SchoolChancesPanel
        data={schoolChancesFactFixtures.full}
        metricParam="sat"
        profile={schoolChancesProfileFixtures.compatible}
      />,
    );

    const interpretation = await screen.findByText(
      /Your SAT 1500 shown for context\.$/,
    );
    expect(interpretation).toBeVisible();
    expect(interpretation.closest('[data-slot="school-chances-interpretation"]')).not.toBeNull();
    expect(
      document.querySelector('[data-slot="sat-comparison"] > p'),
    ).toBeNull();
  });

  test("omits the SAT total context sentence when the student has no saved total", async () => {
    render(
      <SchoolChancesPanel
        data={schoolChancesFactFixtures.full}
        metricParam="sat"
        profile={null}
      />,
    );

    await screen.findByText(
      "Add your SAT section scores to place yourself on these charts.",
    );
    expect(screen.queryByText(/shown for context/)).toBeNull();
  });

  /**
   * FIX 2/7: §5's "the verdict updates live" requirement — previously
   * unimplemented (the interpretation copy read only `.profile`, never
   * `.scenario`), and previously untested.
   */
  describe("scenario-aware verdict (FIX 2)", () => {
    test("dragging the GPA scenario updates the verdict live, framed as a hypothetical", async () => {
      render(
        <SchoolChancesPanel
          data={schoolChancesFactFixtures.full}
          metricParam="gpa"
          profile={schoolChancesProfileFixtures.compatible}
        />,
      );

      expect(
        await screen.findByText(
          "Your 3.82 GPA sits in the 3.75 - 3.99 reported band.",
        ),
      ).toBeVisible();

      const slider = screen.getByRole("slider", { name: "GPA" });
      await typeExactValue(slider, "3.60");

      expect(
        await screen.findByText(
          "If your GPA were 3.60, it would sit in the 3.50 - 3.74 reported band.",
        ),
      ).toBeVisible();
      // The old, unedited verdict is gone — never shown alongside the
      // hypothetical.
      expect(
        screen.queryByText(
          "Your 3.82 GPA sits in the 3.75 - 3.99 reported band.",
        ),
      ).toBeNull();
    });

    test("resetting the scenario back to the saved value restores the exact original verdict copy", async () => {
      render(
        <SchoolChancesPanel
          data={schoolChancesFactFixtures.full}
          metricParam="gpa"
          profile={schoolChancesProfileFixtures.compatible}
        />,
      );
      const slider = screen.getByRole("slider", { name: "GPA" });
      await typeExactValue(slider, "3.60");
      await screen.findByText(
        "If your GPA were 3.60, it would sit in the 3.50 - 3.74 reported band.",
      );

      fireEvent.click(screen.getByRole("button", { name: "Reset" }));

      expect(
        await screen.findByText(
          "Your 3.82 GPA sits in the 3.75 - 3.99 reported band.",
        ),
      ).toBeVisible();
    });

    test("a scenario never papers over the absence message for a student with no saved GPA — it now shows both", async () => {
      render(
        <SchoolChancesPanel
          data={schoolChancesFactFixtures.full}
          metricParam="gpa"
          profile={null}
        />,
      );
      const slider = await screen.findByRole("slider", { name: "GPA" });
      expect(
        screen.getByText(
          "Add your unweighted GPA on a 4.0 scale to place yourself on this chart.",
        ),
      ).toBeVisible();

      await typeExactValue(slider, "3.60");

      // Whole-plan close-out review, defect 2: the plot stays interactive
      // for a missing value, and plan §5 says the verdict updates live —
      // so the hypothetical must now be described. Honesty guard (still
      // enforced, stronger contract): the absence wording must never be
      // dropped to make room for it — both facts render in one sentence.
      expect(
        await screen.findByText(
          "If your GPA were 3.60, it would sit in the 3.50 - 3.74 reported band. Add your unweighted GPA on a 4.0 scale to place yourself on this chart.",
        ),
      ).toBeVisible();
    });

    test("dragging the ACT scenario away from the saved value describes the hypothetical", async () => {
      render(
        <SchoolChancesPanel
          data={schoolChancesFactFixtures.full}
          metricParam="act"
          profile={schoolChancesProfileFixtures.compatible}
        />,
      );
      const slider = await screen.findByRole("slider", { name: "ACT composite" });
      await typeExactValue(slider, "29");

      expect(
        await screen.findByText(
          /^A hypothetical ACT composite of 29 would be (within|below|above) the reported middle 50%\.$/,
        ),
      ).toBeVisible();
    });

    test("dragging an SAT lane's scenario away from its saved value describes that lane's own hypothetical, not the other lane's static comparison", async () => {
      render(
        <SchoolChancesPanel
          data={schoolChancesFactFixtures.full}
          metricParam="sat"
          profile={schoolChancesProfileFixtures.compatible}
        />,
      );
      const ebrwSlider = await screen.findByRole("slider", {
        name: "SAT Reading and Writing",
      });
      await typeExactValue(ebrwSlider, "600");

      // Plan §4: the saved SAT total (1500 on the `compatible` fixture) now
      // rides along in the verdict sentence rather than its own floating
      // caption, on every SAT sentence including a live scenario.
      expect(
        await screen.findByText(
          /^A hypothetical SAT Reading and Writing score of 600 would be (within|below|above) the reported middle 50%\. Your SAT 1500 shown for context\.$/,
        ),
      ).toBeVisible();
    });

    // Defect 2 (browser-audit fix round): both SAT lanes actively scrubbed
    // at once must both be described — the old selection picked math
    // unconditionally and silently dropped whichever lane the student was
    // actually looking at.
    test("dragging both SAT lanes at once addresses both in the verdict, not just math", async () => {
      render(
        <SchoolChancesPanel
          data={schoolChancesFactFixtures.full}
          metricParam="sat"
          profile={schoolChancesProfileFixtures.compatible}
        />,
      );
      const mathSlider = await screen.findByRole("slider", { name: "SAT Math" });
      const ebrwSlider = await screen.findByRole("slider", {
        name: "SAT Reading and Writing",
      });
      // Math nudges one step within its band (690-760); EBRW goes
      // dramatically above its band (680-750) — two different states, so
      // the fix must produce two sentences, not one that hedges both.
      await typeExactValue(mathSlider, "750");
      await typeExactValue(ebrwSlider, "800");

      expect(
        await screen.findByText(
          "A hypothetical SAT Math score of 750 would be within the reported middle 50%. A hypothetical SAT Reading and Writing score of 800 would be above the reported middle 50%. Your SAT 1500 shown for context.",
        ),
      ).toBeVisible();
    });
  });

  describe("whole-plan close-out review fixes", () => {
    test("defect 1: scrubbing an unsaved Math lane does not erase the correct, still-current Reading and Writing verdict", async () => {
      render(
        <SchoolChancesPanel
          data={schoolChancesFactFixtures.full}
          metricParam="sat"
          profile={{ testing: { sat: { ebrw: 740 } } }}
        />,
      );
      // At rest: only Reading and Writing is saved, so the verdict
      // describes that lane.
      expect(
        await findVerdict("Your SAT Reading and Writing score is within the reported middle 50%."),
      ).toBeVisible();

      // The Math lane has no saved value but stays interactive — only
      // `incompatible_profile_value` disables the plot. Scrubbing it must
      // not silently drop the still-correct EBRW sentence.
      const mathSlider = await screen.findByRole("slider", { name: "SAT Math" });
      await typeExactValue(mathSlider, "750");

      expect(
        await findVerdict("Your SAT Reading and Writing score is within the reported middle 50%."),
      ).toBeVisible();
    });

    test("defect 2: scrubbing ACT with no saved composite describes the hypothetical and still states the absence", async () => {
      render(
        <SchoolChancesPanel
          data={schoolChancesFactFixtures.full}
          metricParam="act"
          profile={null}
        />,
      );
      const slider = await screen.findByRole("slider", { name: "ACT composite" });
      expect(
        await findVerdict("Add your ACT composite to place yourself on this chart."),
      ).toBeVisible();

      await typeExactValue(slider, "29");

      expect(
        await findVerdict(
          /^A hypothetical ACT composite of 29 would be (within|below|above) the reported middle 50%\. Add your ACT composite to place yourself on this chart\.$/,
        ),
      ).toBeVisible();
    });

    test("defect 2: scrubbing an SAT lane with neither section saved describes that lane's hypothetical and still states the section absence", async () => {
      render(
        <SchoolChancesPanel
          data={schoolChancesFactFixtures.full}
          metricParam="sat"
          profile={null}
        />,
      );
      expect(
        await findVerdict("Add your SAT section scores to place yourself on these charts."),
      ).toBeVisible();

      const mathSlider = await screen.findByRole("slider", { name: "SAT Math" });
      await typeExactValue(mathSlider, "750");

      expect(
        await findVerdict(
          "A hypothetical SAT Math score of 750 would be within the reported middle 50%. Add your SAT Math score to place yourself on this chart.",
        ),
      ).toBeVisible();
    });

    test("defect 2: scrubbing both SAT lanes with neither saved describes both hypotheticals and states both absences", async () => {
      render(
        <SchoolChancesPanel
          data={schoolChancesFactFixtures.full}
          metricParam="sat"
          profile={null}
        />,
      );
      const mathSlider = await screen.findByRole("slider", { name: "SAT Math" });
      const ebrwSlider = await screen.findByRole("slider", {
        name: "SAT Reading and Writing",
      });
      await typeExactValue(mathSlider, "750");
      await typeExactValue(ebrwSlider, "800");

      expect(
        await findVerdict(
          "A hypothetical SAT Math score of 750 would be within the reported middle 50%. A hypothetical SAT Reading and Writing score of 800 would be above the reported middle 50%. Add your SAT Math score to place yourself on this chart. Add your SAT Reading and Writing score to place yourself on this chart.",
        ),
      ).toBeVisible();
    });

    test("no scenario set: GPA, SAT, and ACT absence copy is byte-identical to the pre-fix wording, except GPA's now-consolidated wording", async () => {
      const { unmount } = render(
        <SchoolChancesPanel
          data={schoolChancesFactFixtures.full}
          metricParam="gpa"
          profile={null}
        />,
      );
      // Duplication-close-out fix: GPA's caption below the plot
      // (`GpaComparison.tsx`'s `gpaProfileMessage`) used to restate this
      // same absence with the added "on a 4.0 scale" detail the verdict
      // itself didn't carry. The caption is now suppressed for a missing
      // GPA (this verdict always states it), so the surviving sentence
      // carries the richer wording instead of losing that detail.
      expect(
        await findVerdict(
          "Add your unweighted GPA on a 4.0 scale to place yourself on this chart.",
        ),
      ).toBeVisible();
      unmount();

      const { unmount: unmountAct } = render(
        <SchoolChancesPanel
          data={schoolChancesFactFixtures.full}
          metricParam="act"
          profile={null}
        />,
      );
      expect(
        await findVerdict("Add your ACT composite to place yourself on this chart."),
      ).toBeVisible();
      unmountAct();

      render(
        <SchoolChancesPanel
          data={schoolChancesFactFixtures.full}
          metricParam="sat"
          profile={null}
        />,
      );
      expect(
        await findVerdict("Add your SAT section scores to place yourself on these charts."),
      ).toBeVisible();
    });
  });

  describe("close-out: duplicated absence text (plan §0's original defect, reopened by the live-verdict fix)", () => {
    /** Counts elements whose ENTIRE text is exactly `phrase` — the default,
     * exact `getByText` match. A lane's own missing-value caption
     * (`score-plot-copy.ts`'s `profilePlacementMessage` /
     * `GpaComparison.tsx`'s `gpaProfileMessage`) is always a standalone
     * `<p>` containing nothing but this phrase, so it matches exactly. The
     * verdict sentence, once a hypothetical or a sibling lane's own
     * absence is folded into it, is a longer sentence with this phrase as
     * only a substring — an exact match never counts it, so this
     * genuinely isolates "is the caption still rendered", independent of
     * whatever the verdict says. */
    function queryCaptions(phrase: string) {
      return screen.queryAllByText(phrase);
    }

    test("GPA: a missing saved value states its absence exactly once on screen, and once in the accessible summary", async () => {
      const { container } = render(
        <SchoolChancesPanel
          data={schoolChancesFactFixtures.full}
          metricParam="gpa"
          profile={null}
        />,
      );
      const absence =
        "Add your unweighted GPA on a 4.0 scale to place yourself on this chart.";

      // Exactly one visible statement — the verdict. The old caption below
      // the plot (`gpaProfileMessage`) is suppressed now that the verdict
      // always carries this fact for a missing GPA.
      expect(await screen.findByText(absence)).toBeVisible();
      expect(queryCaptions(absence)).toHaveLength(1);

      // The accessible summary is a separate channel (`ChartFigure`'s
      // sr-only figcaption) and must still carry the same fact — parity,
      // not suppression.
      expect(container.querySelector("figcaption")).toHaveTextContent(absence);
    });

    test("ACT: a missing saved value states its absence exactly once on screen, and once in the accessible summary", async () => {
      const { container } = render(
        <SchoolChancesPanel
          data={schoolChancesFactFixtures.full}
          metricParam="act"
          profile={null}
        />,
      );
      const absence = "Add your ACT composite to place yourself on this chart.";

      expect(await findVerdict(absence)).toBeVisible();
      expect(queryCaptions(absence)).toHaveLength(1);
      expect(container.querySelector("figcaption")).toHaveTextContent(absence);
    });

    test("SAT, one section saved and one missing, neither scrubbed: the verdict never mentions the missing section, so its caption is the only place stating it — not suppressed", async () => {
      // `partial` saves only Math (730); EBRW has no saved value. At rest
      // (no scrub), `satVerdict` describes the saved Math lane only — it
      // never states the EBRW absence anywhere else, so EBRW's caption is
      // load-bearing here and must NOT be suppressed.
      render(
        <SchoolChancesPanel
          data={schoolChancesFactFixtures.full}
          metricParam="sat"
          profile={schoolChancesProfileFixtures.partial}
        />,
      );
      const ebrwAbsence =
        "Add your SAT Reading and Writing score to place yourself on this chart.";

      expect(await screen.findByText("Math")).toBeVisible();
      expect(queryCaptions(ebrwAbsence)).toHaveLength(1);
      // EBRW's own accessible summary (not Math's — each lane carries its
      // own figcaption) states the same fact for parity.
      const ebrwFigure = screen
        .getByRole("heading", { name: "Reading and Writing" })
        .closest("section")!;
      expect(ebrwFigure.querySelector("figcaption")).toHaveTextContent(ebrwAbsence);
      // The verdict itself never says this — confirms the caption is the
      // sole visible statement, not a duplicate of it.
      expect(queryVerdict(ebrwAbsence)).toBeNull();
    });

    test("SAT, neither section saved, neither scrubbed: the generic combined verdict doesn't name either section, so both captions remain — not a duplicate of a section-specific fact", async () => {
      render(
        <SchoolChancesPanel
          data={schoolChancesFactFixtures.full}
          metricParam="sat"
          profile={null}
        />,
      );
      const mathAbsence = "Add your SAT Math score to place yourself on this chart.";
      const ebrwAbsence =
        "Add your SAT Reading and Writing score to place yourself on this chart.";

      expect(queryCaptions(mathAbsence)).toHaveLength(1);
      expect(queryCaptions(ebrwAbsence)).toHaveLength(1);
    });

    test("SAT, neither section saved, only Math scrubbed: Math's caption is suppressed (the verdict now states it), EBRW's caption stays (the verdict never mentions EBRW)", async () => {
      render(
        <SchoolChancesPanel
          data={schoolChancesFactFixtures.full}
          metricParam="sat"
          profile={null}
        />,
      );
      const mathSlider = await screen.findByRole("slider", { name: "SAT Math" });
      await typeExactValue(mathSlider, "750");

      const mathAbsence = "Add your SAT Math score to place yourself on this chart.";
      const ebrwAbsence =
        "Add your SAT Reading and Writing score to place yourself on this chart.";

      // Math's absence is now folded into the verdict's hypothetical
      // sentence (covered by the "defect 2" test above) — its standalone
      // caption must be gone, not a second copy.
      expect(queryCaptions(mathAbsence)).toHaveLength(0);
      // EBRW is still unscrubbed and unmentioned by the verdict — its own
      // caption remains the sole statement of that fact.
      expect(queryCaptions(ebrwAbsence)).toHaveLength(1);
    });

    test("worst case — SAT, neither section saved, BOTH scrubbed: each section's absence states exactly once, inside the verdict, with neither lane's caption rendered", async () => {
      render(
        <SchoolChancesPanel
          data={schoolChancesFactFixtures.full}
          metricParam="sat"
          profile={null}
        />,
      );
      const mathSlider = await screen.findByRole("slider", { name: "SAT Math" });
      const ebrwSlider = await screen.findByRole("slider", {
        name: "SAT Reading and Writing",
      });
      await typeExactValue(mathSlider, "750");
      await typeExactValue(ebrwSlider, "800");

      const mathAbsence = "Add your SAT Math score to place yourself on this chart.";
      const ebrwAbsence =
        "Add your SAT Reading and Writing score to place yourself on this chart.";

      // Before the fix this compounded to 4 statements of these 2 facts
      // (each stated once in the verdict, once more in each lane's own
      // caption). Now: zero standalone captions...
      expect(queryCaptions(mathAbsence)).toHaveLength(0);
      expect(queryCaptions(ebrwAbsence)).toHaveLength(0);
      // ...and the verdict — one sentence — states both exactly once.
      const verdict = await findVerdict(
        "A hypothetical SAT Math score of 750 would be within the reported middle 50%. A hypothetical SAT Reading and Writing score of 800 would be above the reported middle 50%. Add your SAT Math score to place yourself on this chart. Add your SAT Reading and Writing score to place yourself on this chart.",
      );
      expect(verdict).toBeVisible();
      // Unrelated, pre-existing, untouched behavior worth naming so this
      // isn't mistaken for a gap this fix introduced: once a lane is
      // actively scrubbed, `scoreSummary`'s own accessible-summary text
      // reports the scenario mark ("Scenario 750.") in place of the
      // placement message — that swap predates this fix and is orthogonal
      // to it, so it is not asserted here.
    });
  });

  describe("close-out: duplicated absence text for an INCOMPATIBLE saved value (plan §0's original defect, missed by the missing-value-only fix above)", () => {
    /** Same exact-match isolation as the missing-value describe block
     * above — a lane's own caption is always a standalone `<p>` containing
     * nothing but this phrase, so an exact match never also counts the
     * longer verdict sentence a hypothetical or sibling absence might be
     * folded into. */
    function queryCaptions(phrase: string) {
      return screen.queryAllByText(phrase);
    }

    test("GPA on a 5.0 scale: the 'cannot be placed' fact states exactly once on screen (verdict), and once in the accessible summary", async () => {
      const { container } = render(
        <SchoolChancesPanel
          data={schoolChancesFactFixtures.full}
          metricParam="gpa"
          profile={schoolChancesProfileFixtures.incompatible}
        />,
      );
      const verdictText =
        "Your GPA is saved on a 5.0 scale, so it cannot be placed on this 4.0-scale chart.";
      const captionText =
        "Your GPA uses a different scale and cannot be placed on this 4.0-scale chart.";

      // The verdict states it once, in its own wording.
      expect(await findVerdict(verdictText)).toBeVisible();
      // The plot's own caption — a second, differently-worded restatement
      // of the identical fact — must be gone now, not a duplicate.
      expect(queryCaptions(captionText)).toHaveLength(0);

      // The accessible summary is a separate channel and must still carry
      // the fact — parity, not suppression.
      expect(container.querySelector("figcaption")).toHaveTextContent(captionText);
    });

    test("GPA on a 5.0 scale with no usable distribution: the fallback panel doesn't restate it either", async () => {
      const facts = structuredClone(schoolChancesFactFixtures.full);
      const distribution = facts.sections[0]!.groups[0]!.facts.find(
        (fact) => fact.key === "class_profile.gpa_distribution",
      )!;
      distribution.state = "not_reported";
      distribution.value = null;

      render(
        <SchoolChancesPanel
          data={facts}
          metricParam="gpa"
          profile={schoolChancesProfileFixtures.incompatible}
        />,
      );
      const verdictText =
        "Your GPA is saved on a 5.0 scale, so it cannot be placed on this 4.0-scale chart.";
      const captionText =
        "Your GPA uses a different scale and cannot be placed on this 4.0-scale chart.";

      expect(await findVerdict(verdictText)).toBeVisible();
      expect(queryCaptions(captionText)).toHaveLength(0);
    });

    test("ACT composite outside 1-36: the 'cannot be placed' fact states exactly once on screen (verdict), and once in the accessible summary", async () => {
      const { container } = render(
        <SchoolChancesPanel
          data={schoolChancesFactFixtures.full}
          metricParam="act"
          profile={{ testing: { act: { composite: 99 } } }}
        />,
      );
      const verdictText = "Your ACT composite cannot be placed on this chart.";
      const captionText = "Your ACT composite cannot be placed on this 1–36 chart.";

      expect(await findVerdict(verdictText)).toBeVisible();
      expect(queryCaptions(captionText)).toHaveLength(0);
      expect(container.querySelector("figcaption")).toHaveTextContent(captionText);
    });

    test("SAT: an incompatible saved section next to a saved, in-range sibling still states its own 'cannot be placed' fact once — the verdict describes the sibling instead, so this lane's caption stays load-bearing", async () => {
      // Math is out of the 200-800 domain (incompatible); EBRW is a normal
      // saved value. `satVerdict`'s fallback picks the "value" lane
      // (EBRW) for the verdict, so it never mentions Math's incompatible
      // state anywhere else — Math's own caption remains the sole visible
      // statement of that fact and must NOT be suppressed (never zero).
      render(
        <SchoolChancesPanel
          data={schoolChancesFactFixtures.full}
          metricParam="sat"
          profile={{ testing: { sat: { math: 900, ebrw: 740 } } }}
        />,
      );
      const mathCaption = "Your SAT Math score cannot be placed on this 200–800 chart.";

      expect(await screen.findByText("Math")).toBeVisible();
      expect(queryCaptions(mathCaption)).toHaveLength(1);
      expect(queryVerdict(mathCaption)).toBeNull();
    });
  });

  describe("number row tracks the active scenario (defect 1 fix)", () => {
    test("dragging the GPA scenario updates every cell in the number row, marks 'You' as a hypothetical, and Reset restores the exact original cells", async () => {
      render(
        <SchoolChancesPanel
          data={schoolChancesFactFixtures.full}
          metricParam="gpa"
          profile={schoolChancesProfileFixtures.compatible}
        />,
      );
      const row = () =>
        document.querySelector('[data-slot="school-chances-numbers"]')!;
      const originalCells = row().textContent;

      const slider = screen.getByRole("slider", { name: "GPA" });
      await typeExactValue(slider, "4.00");

      // The verdict and the number row must tell one story: the verdict
      // names the top band ("4.00 and Above", 20% of the class per the
      // `full` fixture's distribution) and the cells must name the same
      // band and the same percentage — never the saved 3.82's middle band.
      await screen.findByText(
        "If your GPA were 4.00, it would sit in the 4.00 and Above reported band.",
      );
      expect(row()).toHaveTextContent("You4.00 / 4.0");
      expect(row()).toHaveTextContent("Reported band4.00 and Above");
      expect(row()).toHaveTextContent("Of the class20%");
      // The "You" cell is visually marked as a hypothetical using the same
      // `--school-chances-scenario` token the mark itself uses.
      const youValue = row().querySelector(
        '[data-scenario="true"]',
      ) as HTMLElement;
      expect(youValue).not.toBeNull();
      expect(youValue.textContent).toBe("4.00 / 4.0");

      fireEvent.click(screen.getByRole("button", { name: "Reset" }));

      await screen.findByText(
        "Your 3.82 GPA sits in the 3.75 - 3.99 reported band.",
      );
      // Character-for-character back to the pre-scenario content.
      expect(row().textContent).toBe(originalCells);
      expect(row().querySelector('[data-scenario="true"]')).toBeNull();
    });

    test("the ACT 'You' cell tracks an active scenario while Middle 50% and Reported average stay the school-level constants", async () => {
      render(
        <SchoolChancesPanel
          data={schoolChancesFactFixtures.full}
          metricParam="act"
          profile={schoolChancesProfileFixtures.compatible}
        />,
      );
      const row = () =>
        document.querySelector('[data-slot="school-chances-numbers"]')!;
      const slider = await screen.findByRole("slider", { name: "ACT composite" });
      await typeExactValue(slider, "29");

      expect(row()).toHaveTextContent("You29");
      // School-level constants never move with the student's scenario.
      expect(row()).toHaveTextContent("Middle 50%30–34");
      expect(row()).toHaveTextContent("Reported average32");

      fireEvent.click(screen.getByRole("button", { name: "Reset" }));
      await screen.findByText(
        "Your ACT composite is within the reported middle 50%.",
      );
      expect(row()).toHaveTextContent("You33");
    });

    // Absence-wins: `stale` reports only a top GPA bucket the saved 3.82
    // falls below, so the saved-value cells read "Not available" even
    // though the verdict states a real, non-scenario fact. Dragging a
    // scenario into that reported bucket must bring the cells into
    // agreement with the verdict rather than leaving them on stale text.
    test("stale-facts: the number row agrees with a scenario placed inside the school's only reported bucket", async () => {
      render(
        <SchoolChancesPanel
          data={schoolChancesFactFixtures.stale}
          metricParam="gpa"
          profile={schoolChancesProfileFixtures.compatible}
        />,
      );
      const row = () =>
        document.querySelector('[data-slot="school-chances-numbers"]')!;

      await screen.findByText("Your 3.82 GPA is below the reported buckets.");
      expect(row()).toHaveTextContent("Reported bandNot available");
      expect(row()).toHaveTextContent("Of the classNot available");

      const slider = screen.getByRole("slider", { name: "GPA" });
      await typeExactValue(slider, "4.00");

      await screen.findByText(
        "If your GPA were 4.00, it would sit in the 4.00 and Above reported band.",
      );
      expect(row()).toHaveTextContent("Reported band4.00 and Above");
      expect(row()).toHaveTextContent("Of the class100%");
    });
  });

  /**
   * An incompatible saved value (a GPA on another scale, a score outside its
   * instrument's own domain) can never be placed on this chart no matter
   * what the student scrubs to — the verdict already says so permanently.
   * The interactive control must not exist either: it used to render a
   * working `role="slider"` regardless, taking a tab stop and announcing
   * `aria-valuetext` changes for a scenario the verdict would ignore.
   * `missing_profile_value` (the student simply hasn't entered a value yet)
   * is the other state that collapses to the same `savedValue={null}` prop
   * and MUST stay fully interactive — both are asserted here so a fix that
   * only handles one state doesn't ship unnoticed.
   */
  describe("an incompatible saved value suppresses the slider (not just the verdict)", () => {
    test("GPA on a 5.0 scale: no slider, no tab stop, verdict copy states the real scale", async () => {
      render(
        <SchoolChancesPanel
          data={schoolChancesFactFixtures.full}
          metricParam="gpa"
          profile={schoolChancesProfileFixtures.incompatible}
        />,
      );

      expect(
        await screen.findByText(
          "Your GPA is saved on a 5.0 scale, so it cannot be placed on this 4.0-scale chart.",
        ),
      ).toBeVisible();
      expect(screen.queryByRole("slider", { name: "GPA" })).toBeNull();
      expect(
        screen.queryByText("Drag to try a different score"),
      ).toBeNull();
    });

    test("ACT composite outside 1-36: no slider, no tab stop", async () => {
      render(
        <SchoolChancesPanel
          data={schoolChancesFactFixtures.full}
          metricParam="act"
          profile={{ testing: { act: { composite: 99 } } }}
        />,
      );

      expect(
        await screen.findByText("Your ACT composite cannot be placed on this chart."),
      ).toBeVisible();
      expect(
        screen.queryByRole("slider", { name: "ACT composite" }),
      ).toBeNull();
      expect(
        screen.queryByText("Drag to try a different score"),
      ).toBeNull();
    });

    test("a missing (never-entered) GPA stays fully scrubbable — the absence guard must not over-apply", async () => {
      render(
        <SchoolChancesPanel
          data={schoolChancesFactFixtures.full}
          metricParam="gpa"
          profile={null}
        />,
      );

      const slider = await screen.findByRole("slider", { name: "GPA" });
      expect(slider).toHaveAttribute("tabindex", "0");
      expect(
        screen.getByText("Drag to try a different score"),
      ).toBeVisible();

      await typeExactValue(slider, "3.60");

      expect(slider).toHaveAttribute("aria-valuenow", "3.6");
      // The absence guard still wins in the verdict sentence (existing
      // coverage above) — this test's own job is only the control itself.
    });

    test("a missing (never-entered) ACT composite stays fully scrubbable", async () => {
      render(
        <SchoolChancesPanel
          data={schoolChancesFactFixtures.full}
          metricParam="act"
          profile={null}
        />,
      );

      const slider = await screen.findByRole("slider", { name: "ACT composite" });
      expect(slider).toHaveAttribute("tabindex", "0");

      await typeExactValue(slider, "29");
      expect(slider).toHaveAttribute("aria-valuenow", "29");
    });
  });

  /**
   * Item 3 (fix round 2): the scrubbing store used to be one module-level
   * singleton shared by every mounted `ScrubbablePlot` on the page, so a
   * drag on one `SchoolChancesPanel`'s plot set `aria-busy="true"` on
   * every OTHER panel's verdict too — confirmed live on the 19-fixture dev
   * gallery, fixed by scoping the store per panel instance
   * (`ScrubbingProvider`/`createScrubbingStore`, `ScrubbablePlot.tsx`).
   * Nothing in this suite rendered two panels side by side before this
   * test, so the fix shipped unprotected against a regression.
   */
  test("item 3: dragging one panel's plot never sets aria-busy on a sibling panel's verdict", () => {
    render(
      <>
        <div data-testid="panel-a">
          <SchoolChancesPanel data={schoolChancesFactFixtures.full} metricParam="gpa" />
        </div>
        <div data-testid="panel-b">
          <SchoolChancesPanel data={schoolChancesFactFixtures.full} metricParam="gpa" />
        </div>
      </>,
    );

    const panelA = screen.getByTestId("panel-a");
    const panelB = screen.getByTestId("panel-b");
    const sliderA = within(panelA).getByRole("slider", { name: "GPA" });
    const verdictA = panelA.querySelector(
      '[data-slot="school-chances-interpretation"]',
    )!;
    const verdictB = panelB.querySelector(
      '[data-slot="school-chances-interpretation"]',
    )!;

    // jsdom has neither real layout nor pointer capture — same minimal
    // stub `ScrubbablePlot.test.tsx`'s `mockControlGeometry` uses.
    Object.defineProperties(sliderA, {
      hasPointerCapture: { value: vi.fn(() => false) },
      releasePointerCapture: { value: vi.fn() },
      setPointerCapture: { value: vi.fn() },
    });

    expect(verdictA).toHaveAttribute("aria-busy", "false");
    expect(verdictB).toHaveAttribute("aria-busy", "false");

    fireEvent.pointerDown(sliderA, { button: 0, clientX: 210, pointerId: 1 });

    expect(verdictA).toHaveAttribute("aria-busy", "true");
    expect(verdictB).toHaveAttribute("aria-busy", "false");

    fireEvent.pointerUp(sliderA, { clientX: 210, pointerId: 1 });

    expect(verdictA).toHaveAttribute("aria-busy", "false");
    expect(verdictB).toHaveAttribute("aria-busy", "false");
  });
});
