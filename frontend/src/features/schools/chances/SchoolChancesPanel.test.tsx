import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    // the raw value.
    await waitFor(() =>
      expect(
        container.querySelector('[data-slot="you-mark"][data-variant="you"]'),
      ).toHaveTextContent("3.825"),
    );
    expect(screen.queryByRole("slider", { name: "Explore GPA" })).toBeNull();
    expect(
      screen.getByText(
        "Your saved GPA is more precise than this 0.01 explorer. Enter a two-decimal scenario to start.",
      ),
    ).toBeVisible();
  });

  test("starts a missing profile metric empty and enables its slider only after a valid commit", async () => {
    render(
      <SchoolChancesPanel
        data={schoolChancesFactFixtures.full}
        metricParam="gpa"
        profile={null}
      />,
    );

    const input = await screen.findByLabelText("GPA scenario");
    expect(screen.queryByLabelText("Explore GPA")).toBeNull();
    expect(screen.getByText("Enter a value to start exploring")).toBeVisible();

    fireEvent.pointerDown(input);
    fireEvent.input(input, { target: { value: "3.8" } });
    fireEvent.blur(input);

    expect(await screen.findByLabelText("Explore GPA")).toHaveAttribute(
      "aria-valuenow",
      "3.8",
    );
    expect(screen.getByLabelText("Explore GPA")).toHaveFocus();
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

    expect(await screen.findByLabelText("GPA scenario")).toHaveValue("");
    expect(screen.queryByLabelText("Explore GPA")).toBeNull();
    expect(screen.getByText("Enter a value to start exploring")).toBeVisible();
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
    const input = await screen.findByLabelText("GPA scenario");
    fireEvent.input(input, { target: { value: "3.8" } });
    fireEvent.blur(input);

    expect(
      await screen.findByRole("button", { name: "Reset to your GPA" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Reset to your GPA" }));
    expect(screen.queryByLabelText("Explore GPA")).toBeNull();
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
    ["gpa", "GPA scenario", "3.82", "3.82"],
    ["sat", "Math scenario", "760", "760"],
    ["act", "ACT composite scenario", "33", "33"],
  ] as const)(
    "does not create a second scenario surface when %s equals the saved profile",
    async (metric, inputName, value, marker) => {
      const { container } = render(
        <SchoolChancesPanel
          data={schoolChancesFactFixtures.full}
          metricParam={metric}
          profile={schoolChancesProfileFixtures.compatible}
        />,
      );

      const input = await screen.findByLabelText(inputName);
      fireEvent.input(input, { target: { value } });
      fireEvent.blur(input);

      const matchingMarks = () =>
        [...container.querySelectorAll('[data-slot="you-mark"]')].filter(
          (mark) => mark.textContent === marker,
        );
      await waitFor(() => expect(matchingMarks()).toHaveLength(1));
      expect(matchingMarks()[0]).toHaveAttribute("data-variant", "you");
      expect(screen.queryByText(/Your profile/)).toBeNull();
      expect(
        document.querySelector("[data-slot=school-chances-scenario-position]"),
      ).toBeNull();
      expect(screen.queryByText(/^Scenario set to /)).toBeNull();
      expect(screen.queryByRole("button", { name: /Reset/ })).toBeNull();
    },
  );

  test("reveals a metric only after its profile-loaded plot mounts, once per metric", async () => {
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
    expect(firstGpaReveal).toHaveClass("motion-safe:animate-in");

    rerender(
      <SchoolChancesPanel
        data={schoolChancesFactFixtures.full}
        metricParam="sat"
      />,
    );
    const satReveal = await screen.findByTestId("school-chances-plot-reveal");
    expect(satReveal).toHaveClass("motion-safe:animate-in");

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
    expect(returnedGpaReveal).not.toHaveClass("motion-safe:animate-in");
  });

  test("keeps the first metric reveal through incidental rerenders without replaying it", async () => {
    const { rerender } = render(
      <SchoolChancesPanel
        data={schoolChancesFactFixtures.full}
        metricParam="gpa"
        profile={schoolChancesProfileFixtures.compatible}
      />,
    );

    const firstReveal = await screen.findByTestId("school-chances-plot-reveal");
    expect(firstReveal).toHaveAttribute("data-reveal-state", "first-visit");
    expect(firstReveal).toHaveClass(
      "motion-safe:animate-in",
      "duration-200",
      "ease-out",
    );

    // Scenario edits and Reset are parent updates and must not interrupt it.
    const scenarioInput = await screen.findByLabelText("GPA scenario");
    fireEvent.input(scenarioInput, { target: { value: "3.9" } });
    fireEvent.blur(scenarioInput);
    expect(screen.getByTestId("school-chances-plot-reveal")).toBe(firstReveal);
    expect(firstReveal).toHaveAttribute("data-reveal-state", "first-visit");
    expect(firstReveal).toHaveClass("motion-safe:animate-in");
    fireEvent.click(screen.getByRole("button", { name: "Reset to your GPA" }));
    expect(screen.getByTestId("school-chances-plot-reveal")).toBe(firstReveal);
    expect(firstReveal).toHaveClass("motion-safe:animate-in");

    // A refetch-style parent update must not interrupt the one reveal.
    rerender(
      <SchoolChancesPanel
        data={{ ...schoolChancesFactFixtures.full }}
        metricParam="gpa"
        profile={schoolChancesProfileFixtures.compatible}
      />,
    );
    expect(screen.getByTestId("school-chances-plot-reveal")).toBe(firstReveal);
    expect(firstReveal).toHaveAttribute("data-reveal-state", "first-visit");
    expect(firstReveal).toHaveClass("motion-safe:animate-in");

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
    expect(revisited).toHaveAttribute("data-reveal-state", "visited");
    expect(revisited).not.toHaveClass("motion-safe:animate-in");
  });

  test("does not reveal a first-view plot when reduced motion is requested", async () => {
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
      expect(reveal).toHaveAttribute("data-reveal-state", "visited");
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
      await screen.findByLabelText("Explore SAT Math"),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Explore SAT Reading and Writing"),
    ).toBeNull();
  });

  test("rejects invalid entry without changing the last valid scenario and only announces committed changes", async () => {
    renderPanel();
    const input = await screen.findByLabelText("GPA scenario");
    fireEvent.input(input, { target: { value: "4.01" } });
    fireEvent.blur(input);
    expect(await screen.findByText("Use increments of 0.01")).toBeVisible();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "gpa-scenario-error");
    expect(screen.getByLabelText("Explore GPA")).toHaveAttribute(
      "aria-valuenow",
      "3.82",
    );

    fireEvent.input(input, { target: { value: "3.9" } });
    fireEvent.blur(input);
    expect(await screen.findByText("Scenario set to 3.90 GPA.")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Reset to your GPA" }),
    ).toBeVisible();
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
});
