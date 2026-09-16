import { render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { describe, expect, test, vi } from "vitest";

import { ActComparison } from "./ActComparison";
import { GpaComparison } from "./GpaComparison";
import { profileScenario } from "./SchoolChancesPanel";
import { SatComparison } from "./SatComparison";
import {
  buildSchoolChancesModel,
  type ChancesScenarioInput,
  type SchoolChancesModel,
} from "./school-chances-model";
import {
  schoolChancesFactFixtures,
  schoolChancesProfileFixtures,
} from "./school-chances-fixtures";

expect.extend(toHaveNoViolations);

/** These tests exercise the summary/marker rendering `ScrubbablePlot`
 * composes, not its interaction — that's `ScrubbablePlot.test.tsx`'s job —
 * so every render below wires the same `profile`/`scenario` plumbing
 * `SchoolChancesPanel.tsx` does, with a no-op `onScenarioChange`. */
function scenarioProps(
  model: SchoolChancesModel,
  scenario: ChancesScenarioInput = {},
) {
  return { onScenarioChange: vi.fn(), profile: profileScenario(model), scenario };
}

describe("academic comparison visual grammar", () => {
  test("renders the GPA bucket profile as text-equivalent categorical data in the accessible summary, including gaps and the profile marker", async () => {
    const model = buildSchoolChancesModel(
      schoolChancesFactFixtures.partial,
      schoolChancesProfileFixtures.compatible,
      "gpa",
      { gpa: 3.9 },
    );
    const { container } = render(
      <GpaComparison model={model.gpa!} {...scenarioProps(model, { gpa: 3.9 })} />,
    );

    // The bucket grid died in P2 (school-chances-minimal-redesign §6) — the
    // shape already draws the same class profile. Every reported and
    // omitted bucket remains fully stated in the accessible summary.
    const figcaption = container.querySelector("figcaption");
    expect(figcaption).toHaveTextContent("3.75 - 3.99: 60%");
    expect(figcaption).toHaveTextContent("4.00 and Above: not reported");
    // The old "Your profile 3.82" / "Scenario 3.9" callout labels die with
    // GpaComparisonMarkers.tsx: the saved value is now a dashed rule with no
    // pill (plan §2.2), and the scenario pill shows only the raw value.
    expect(
      container.querySelector('[data-slot="you-mark"][data-variant="saved"]'),
    ).toHaveAttribute("data-variant", "saved");
    expect(
      container.querySelector('[data-slot="you-mark"][data-variant="scenario"]'),
    ).toHaveTextContent("3.9");
    // 60% is a 40-point gap from 100 — comfortably past the 5-point inline
    // threshold (plan §6, owner decision), so it stays visible on screen too.
    expect(
      screen.getByText(
        "Reported buckets total 60%; missing buckets are not treated as zero.",
      ),
    ).toBeVisible();
    expect(figcaption).toHaveTextContent(
      "Reported buckets total 60%; missing buckets are not treated as zero.",
    );
    expect(container.querySelector("figure > div")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  test("keeps a sums-to gap under the 5-point threshold out of view but still in the accessible summary", () => {
    const facts = structuredClone(schoolChancesFactFixtures.full);
    (
      facts.sections[0]!.groups[0]!.facts[0]!.value as { sums_to: number }
    ).sums_to = 96;
    const model = buildSchoolChancesModel(
      facts,
      schoolChancesProfileFixtures.compatible,
      "gpa",
    );
    const { container } = render(
      <GpaComparison model={model.gpa!} {...scenarioProps(model)} />,
    );

    expect(
      container.querySelector('[aria-hidden="true"]')?.textContent,
    ).not.toMatch(/Reported buckets total 96%/);
    expect(container.querySelector("figcaption")).toHaveTextContent(
      "Reported buckets total 96%; missing buckets are not treated as zero.",
    );
  });

  test("keeps SAT section lanes separate, prints bands and does not rely on a tooltip", async () => {
    const model = buildSchoolChancesModel(
      schoolChancesFactFixtures.full,
      schoolChancesProfileFixtures.compatible,
      "sat",
      { sat: { math: 770, ebrw: 740 } },
    );
    const { container } = render(
      <SatComparison
        model={model.sat!}
        testPolicy={model.testPolicy}
        {...scenarioProps(model, { sat: { math: 770, ebrw: 740 } })}
      />,
    );

    expect(screen.getByText("Math")).toBeVisible();
    expect(screen.getByText("Reading and Writing")).toBeVisible();
    // The "Middle 50% 690–760" / "Average 725" value-row text died with
    // ScoreBandDetails.tsx; the band and average are still fully stated in
    // the accessible summary, just not duplicated visibly.
    expect(container.querySelectorAll("figcaption")[0]).toHaveTextContent(
      "Middle 50% is 690 to 760",
    );
    expect(container.querySelectorAll("figcaption")[0]).toHaveTextContent(
      "Reported average is 725",
    );
    // Testing policy moved to the panel header (plan §3); it stays fully
    // stated in each lane's accessible summary.
    expect(container.querySelectorAll("figcaption")[0]).toHaveTextContent(
      "Testing policy: Considered if submitted",
    );
    // The total-context line the deleted ledger used to carry — its proper
    // home is the verdict sentence once SAT's own two-lane redesign lands
    // (P4, plan §4); until then it stays visible here rather than vanishing.
    expect(
      container.querySelector("[data-slot=sat-comparison] > p"),
    ).toHaveTextContent("Your SAT 1500 shown for context");
    expect(container.querySelector("[role=tooltip]")).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  test("uses the literal unscaled breakdown while retaining a valid ACT band and named markers", async () => {
    const invalidActFacts = structuredClone(schoolChancesFactFixtures.full);
    const distribution = invalidActFacts.sections[0]!.groups[0]!.facts.find(
      (fact) => fact.key === "class_profile.act_composite_distribution",
    )!;
    distribution.value = {
      ...(distribution.value as object),
      buckets: [{ label: "Score of 40 - 45", pct: 100 }],
    };
    const model = buildSchoolChancesModel(
      invalidActFacts,
      schoolChancesProfileFixtures.compatible,
      "act",
      { act: { composite: 34 } },
    );
    const fullAct = buildSchoolChancesModel(
      schoolChancesFactFixtures.full,
      schoolChancesProfileFixtures.compatible,
      "act",
      { act: { composite: 34 } },
    );
    const { container, rerender } = render(
      <ActComparison
        model={fullAct.act!}
        testPolicy={fullAct.testPolicy}
        {...scenarioProps(fullAct, { act: { composite: 34 } })}
      />,
    );

    expect(screen.getByText("Composite")).toBeVisible();
    // "Middle 50% 30–34" and "Your profile 33" died with ScoreBandDetails.tsx
    // and academic-comparison-marks.tsx; the scenario pill (the primary mark
    // once it differs from the saved profile) now shows just its value.
    expect(
      container.querySelector('[data-slot="you-mark"][data-variant="scenario"]'),
    ).toHaveTextContent("34");
    expect(
      container.querySelector('[data-slot="you-mark"][data-variant="saved"]'),
    ).toHaveAttribute("data-variant", "saved");

    rerender(
      <ActComparison
        model={model.act!}
        testPolicy={model.testPolicy}
        {...scenarioProps(model, { act: { composite: 34 } })}
      />,
    );
    // The visible "Reported breakdown — not plotted to scale" list died
    // with ScoreBreakdown.tsx (plan §6) — the shape draws the same class
    // profile, and the accessible summary still states the literal,
    // unscaled breakdown in full.
    const figcaption = container.querySelector("figcaption");
    expect(figcaption).toHaveTextContent(
      "Reported breakdown is not plotted to scale.",
    );
    expect(figcaption).toHaveTextContent("Score of 40 - 45: 100%");
    expect(await axe(container)).toHaveNoViolations();
  });

  test("keeps partial SAT and ACT distributions visibly and programmatically incomplete", () => {
    const facts = structuredClone(schoolChancesFactFixtures.full);
    const fact = (key: string) =>
      facts.sections[0]!.groups[0]!.facts.find(
        (candidate) => candidate.key === key,
      )!;
    (
      fact("class_profile.sat_math_distribution").value as { sums_to: number }
    ).sums_to = 80;
    (
      fact("class_profile.act_composite_distribution").value as {
        sums_to: number;
      }
    ).sums_to = 90;

    const sat = buildSchoolChancesModel(
      facts,
      schoolChancesProfileFixtures.compatible,
      "sat",
    );
    const act = buildSchoolChancesModel(
      facts,
      schoolChancesProfileFixtures.compatible,
      "act",
    );
    const { rerender } = render(
      <SatComparison model={sat.sat!} testPolicy={sat.testPolicy} {...scenarioProps(sat)} />,
    );

    const satLane = screen
      .getByRole("heading", { name: "Math" })
      .closest("section")!;
    expect(
      screen.getByText(
        "Reported buckets total 80%; missing buckets are not treated as zero.",
      ),
    ).toBeVisible();
    expect(satLane.querySelector("figcaption")).toHaveTextContent(
      "Reported buckets total 80%; missing buckets are not treated as zero.",
    );

    rerender(
      <ActComparison model={act.act!} testPolicy={act.testPolicy} {...scenarioProps(act)} />,
    );
    expect(
      screen.getByText(
        "Reported buckets total 90%; missing buckets are not treated as zero.",
      ),
    ).toBeVisible();
    expect(document.querySelector("figcaption")).toHaveTextContent(
      "Reported buckets total 90%; missing buckets are not treated as zero.",
    );
  });

  test("leaves its essential chart text available when reduced motion is requested", () => {
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
      const model = buildSchoolChancesModel(
        schoolChancesFactFixtures.full,
        schoolChancesProfileFixtures.compatible,
        "act",
      );
      const { container } = render(
        <ActComparison
          model={model.act!}
          testPolicy={model.testPolicy}
          {...scenarioProps(model)}
        />,
      );

      // "Middle 50% 30–34" died with ScoreBandDetails.tsx — the band is
      // still fully stated in the accessible summary.
      expect(container.querySelector("figcaption")).toHaveTextContent(
        "Middle 50% is 30 to 34",
      );
      expect(
        container.querySelector("[class*='motion-safe:animate']"),
      ).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("keeps every omitted GPA bucket, edge placement, and per-fact period in the accessible summary", () => {
    const facts = structuredClone(schoolChancesFactFixtures.partial);
    const distribution = facts.sections[0]!.groups[0]!.facts[0]!;
    (distribution.value as { buckets: unknown[] }).buckets.shift();
    distribution.reported_period = "distribution 2024";
    const model = buildSchoolChancesModel(
      facts,
      { academics: { gpa_unweighted: "2.00", gpa_scale: "4.0" } },
      "gpa",
      { gpa: 4 },
    );
    const { container } = render(
      <GpaComparison model={model.gpa!} {...scenarioProps(model, { gpa: 4 })} />,
    );

    // The bucket grid ("3.50 - 3.74: Not reported") and the standalone
    // "Reported distribution 2024" line both died with the P2 bucket-grid
    // deletion (plan §6) — the reported period now lives on the "Reported
    // band" number cell in SchoolChancesPanel.tsx, printed only when it
    // diverges from the rest of the screen. Both remain fully stated here.
    const figcaption = container.querySelector("figcaption");
    // "Below reported buckets" / "Scenario above reported buckets" edge
    // callouts died with GpaComparisonMarkers.tsx — the mark now positions
    // by its raw numeric value on the windowed axis instead (plan §2.2), and
    // the out-of-range state is still fully stated in the accessible
    // summary.
    expect(
      container.querySelector('[data-slot="you-mark"][data-variant="scenario"]'),
    ).toHaveTextContent("4");
    expect(figcaption).toHaveTextContent(
      "Your 2.00 GPA is below the reported buckets",
    );
    expect(figcaption).toHaveTextContent("Reported distribution period: distribution 2024.");
    expect(figcaption).toHaveTextContent("3.50 - 3.74: Not reported");
  });

  test("includes the exact student value in the GPA edge figure summary", () => {
    const model = buildSchoolChancesModel(
      schoolChancesFactFixtures.full,
      { academics: { gpa_unweighted: "2.00", gpa_scale: "4.0" } },
      "gpa",
    );
    const { container } = render(
      <GpaComparison model={model.gpa!} {...scenarioProps(model)} />,
    );

    expect(container.querySelector("figcaption")).toHaveTextContent(
      "2.00 GPA is below the reported buckets",
    );
  });

  test("retains exact school absence wording and state with its own reported period", () => {
    const facts = structuredClone(schoolChancesFactFixtures.absenceStates);
    const math = facts.sections[0]!.groups[0]!.facts.find(
      (fact) => fact.key === "class_profile.sat_math",
    )!;
    math.display = "The school did not provide this measure.";
    math.reported_period = "band 2023";
    const model = buildSchoolChancesModel(facts, null, "sat");
    const { container } = render(
      <SatComparison
        model={model.sat!}
        testPolicy={model.testPolicy}
        {...scenarioProps(model)}
      />,
    );

    expect(
      screen.getByText("The school did not provide this measure."),
    ).toHaveAttribute("data-school-state", "not_fetched");
    expect(screen.getByText("Reported band 2023")).toBeVisible();
    expect(container.querySelector("figcaption")).toHaveTextContent(
      "The school did not provide this measure.",
    );
  });

  // The test formerly here ("renders a usable score distribution with the
  // band fact's exact unavailable wording") asserted only on
  // ScoreBandDetails.tsx's `BandUnavailable` component — deleted in this
  // phase with no visual replacement (the class shape doesn't render band
  // unavailability text when other geometry exists; the accessible summary
  // still states it).

  test("prints score absent buckets and individual distribution, band, and average periods", () => {
    const facts = structuredClone(schoolChancesFactFixtures.full);
    const fact = (key: string) =>
      facts.sections[0]!.groups[0]!.facts.find(
        (candidate) => candidate.key === key,
      )!;
    const distribution = fact("class_profile.sat_math_distribution");
    distribution.reported_period = "distribution 2022";
    (distribution.value as { buckets: unknown[] }).buckets.push({
      label: "Score of 500 - 599",
      absence: "not_reported",
      absence_display: "Not reported by the school",
    });
    fact("class_profile.sat_math").reported_period = "band 2023";
    fact("class_profile.sat_math_avg").reported_period = "average 2024";
    const model = buildSchoolChancesModel(
      facts,
      schoolChancesProfileFixtures.compatible,
      "sat",
    );
    const { container } = render(
      <SatComparison
        model={model.sat!}
        testPolicy={model.testPolicy}
        {...scenarioProps(model)}
      />,
    );

    // The literal bucket list ("Score of 500 - 599: Not reported by the
    // school") died with ScoreBreakdown.tsx (plan §6) — the accessible
    // summary still carries it. The three periods genuinely diverge from
    // the rest of this screen (the ebrw lane stays on "2025-26"), so plan
    // §6's differing-period exception keeps them visible too.
    expect(screen.getByText("Reported band band 2023")).toBeVisible();
    expect(screen.getByText("Reported distribution 2022")).toBeVisible();
    expect(screen.getByText("Reported average average 2024")).toBeVisible();
    expect(container.querySelector("figcaption")).toHaveTextContent(
      "reported band 2023",
    );
    expect(container.querySelector("figcaption")).toHaveTextContent(
      "reported average 2024",
    );
    expect(container.querySelector("figcaption")).toHaveTextContent(
      "Score of 500 - 599: Not reported by the school",
    );
  });

  // The test formerly here ("visibly explains missing and incompatible score
  // profile markers") asserted on `profilePlacementMessage` rendering
  // visibly inside the has-geometry branch. That branch's visible value row
  // (ScoreValueRow) is deleted in this phase with no P1 replacement — the
  // placement message is still fully stated in the accessible summary
  // (`scoreSummary`'s `student` fallback), just not duplicated visibly until
  // P2 gives it a home in the three-number row (plan §3).

  // The five tests formerly here (measured-width collision boundaries, the
  // GPA marker rail's real geometry, score callout fluid-leader states,
  // clamped callout-label edges, and band-endpoint layout) asserted entirely
  // on `calloutLayout`/`endpointLabelLayout` and the components that
  // consumed them — `GpaComparisonMarkers.tsx`, `academic-comparison-marks.tsx`
  // and `ScoreBandDetails.tsx`. `ClassShape`/`YouMark` position everything by
  // the windowed axis instead of measured-width collision layout, so none of
  // that machinery exists to test any more.
});
