import { render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { describe, expect, test, vi } from "vitest";

import { ActComparison } from "./ActComparison";
import { AcademicComparisonPlot } from "./AcademicComparisonPlot";
import { GpaComparison } from "./GpaComparison";
import { SatComparison } from "./SatComparison";
import {
  calloutLayout,
  endpointLabelLayout,
} from "./academic-comparison-geometry";
import { buildSchoolChancesModel } from "./school-chances-model";
import {
  schoolChancesFactFixtures,
  schoolChancesProfileFixtures,
} from "./school-chances-fixtures";

expect.extend(toHaveNoViolations);

describe("academic comparison visual grammar", () => {
  test("renders the GPA bucket profile as text-equivalent categorical data, including gaps and the profile marker", async () => {
    const model = buildSchoolChancesModel(
      schoolChancesFactFixtures.partial,
      schoolChancesProfileFixtures.compatible,
      "gpa",
      { gpa: 3.9 },
    );
    const { container } = render(<GpaComparison model={model.gpa!} />);

    expect(screen.getByText("3.75 - 3.99")).toBeVisible();
    expect(screen.getByText("60%")).toBeVisible();
    expect(screen.getByText("4.00 and Above: Not reported")).toBeVisible();
    expect(screen.getByText("Your profile 3.82")).toBeVisible();
    expect(screen.getByText("Scenario 3.9")).toBeVisible();
    expect(
      screen.getByText(
        "Reported buckets total 60%; missing buckets are not treated as zero.",
      ),
    ).toBeVisible();
    expect(container.querySelector("figure > div")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  test("keeps SAT section lanes separate, prints bands and does not rely on a tooltip", async () => {
    const model = buildSchoolChancesModel(
      schoolChancesFactFixtures.full,
      schoolChancesProfileFixtures.compatible,
      "sat",
      { sat: { math: 770, ebrw: 740 } },
    );
    const { container } = render(
      <SatComparison model={model.sat!} testPolicy={model.testPolicy} />,
    );

    expect(screen.getByText("Math")).toBeVisible();
    expect(screen.getByText("Reading and Writing")).toBeVisible();
    expect(screen.getAllByText(/^Middle 50% \d/)).toHaveLength(2);
    expect(screen.getByText("Middle 50% 690–760")).toBeVisible();
    expect(screen.getByText("Average 725")).toBeVisible();
    expect(
      container.querySelector("[data-slot=sat-comparison] > p"),
    ).toHaveTextContent("Testing policy: Considered if submitted");
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
      <ActComparison model={fullAct.act!} testPolicy={fullAct.testPolicy} />,
    );

    expect(screen.getByText("Composite")).toBeVisible();
    expect(screen.getByText("Middle 50% 30–34")).toBeVisible();
    expect(screen.getByText("Your profile 33")).toBeVisible();
    expect(screen.getByText("Scenario 34")).toBeVisible();

    rerender(
      <ActComparison model={model.act!} testPolicy={model.testPolicy} />,
    );
    expect(
      screen.getByText("Reported breakdown — not plotted to scale"),
    ).toBeVisible();
    expect(screen.getByText("Score of 40 - 45: 100%")).toBeVisible();
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
      <SatComparison model={sat.sat!} testPolicy={sat.testPolicy} />,
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

    rerender(<ActComparison model={act.act!} testPolicy={act.testPolicy} />);
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
        <ActComparison model={model.act!} testPolicy={model.testPolicy} />,
      );

      expect(screen.getByText("Middle 50% 30–34")).toBeVisible();
      expect(
        container.querySelector("[class*='motion-safe:animate']"),
      ).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("keeps every omitted GPA bucket, edge placement, and per-fact period in the visible and screen-reader equivalents", () => {
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
    const { container } = render(<GpaComparison model={model.gpa!} />);

    expect(screen.getByText("3.50 - 3.74: Not reported")).toBeVisible();
    expect(
      screen
        .getAllByText("Below reported buckets")
        .some((element) => element.dataset.placement === "below-edge"),
    ).toBe(true);
    expect(
      screen
        .getAllByText("Scenario above reported buckets")
        .some((element) => element.dataset.placement === "above-edge"),
    ).toBe(true);
    expect(screen.getByText("Reported distribution 2024")).toBeVisible();
    expect(container.querySelector("figcaption")).toHaveTextContent(
      "3.50 - 3.74: Not reported",
    );
  });

  test("includes the exact student value in the GPA edge figure summary", () => {
    const model = buildSchoolChancesModel(
      schoolChancesFactFixtures.full,
      { academics: { gpa_unweighted: "2.00", gpa_scale: "4.0" } },
      "gpa",
    );
    const { container } = render(<GpaComparison model={model.gpa!} />);

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
      <SatComparison model={model.sat!} testPolicy={model.testPolicy} />,
    );

    expect(
      screen.getByText("The school did not provide this measure."),
    ).toHaveAttribute("data-school-state", "not_fetched");
    expect(screen.getByText("Reported band 2023")).toBeVisible();
    expect(container.querySelector("figcaption")).toHaveTextContent(
      "The school did not provide this measure.",
    );
  });

  test("renders a usable score distribution with the band fact's exact unavailable wording", () => {
    const facts = structuredClone(schoolChancesFactFixtures.full);
    const band = facts.sections[0]!.groups[0]!.facts.find(
      (fact) => fact.key === "class_profile.sat_math",
    )!;
    band.state = "not_published";
    band.display = "The school did not publish this middle-50% band.";
    band.reported_period = "band 2021";
    band.value = null;
    const model = buildSchoolChancesModel(
      facts,
      schoolChancesProfileFixtures.compatible,
      "sat",
    );

    render(<SatComparison model={model.sat!} testPolicy={model.testPolicy} />);

    expect(
      screen.getByText("The school did not publish this middle-50% band."),
    ).toHaveAttribute("data-band-state", "not_published");
    expect(screen.getByText("Reported band 2021")).toBeVisible();
  });

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
      <SatComparison model={model.sat!} testPolicy={model.testPolicy} />,
    );

    expect(
      screen.getByText("Score of 500 - 599: Not reported by the school"),
    ).toBeVisible();
    expect(screen.getByText("Reported distribution 2022")).toBeVisible();
    expect(screen.getByText("Reported band 2023")).toBeVisible();
    expect(screen.getByText("Reported average 2024")).toBeVisible();
    expect(container.querySelector("figcaption")).toHaveTextContent(
      "Score of 500 - 599: Not reported by the school",
    );
  });

  test("visibly explains missing and incompatible score profile markers", () => {
    const missing = buildSchoolChancesModel(
      schoolChancesFactFixtures.full,
      null,
      "act",
    );
    const incompatible = buildSchoolChancesModel(
      schoolChancesFactFixtures.full,
      { testing: { act: { composite: 40 } } },
      "act",
    );
    const { rerender } = render(
      <ActComparison model={missing.act!} testPolicy={missing.testPolicy} />,
    );
    expect(
      screen.getByText(
        "Add your ACT composite to place yourself on this chart.",
      ),
    ).toBeVisible();

    rerender(
      <ActComparison
        model={incompatible.act!}
        testPolicy={incompatible.testPolicy}
      />,
    );
    expect(
      screen.getByText(
        "Your ACT composite cannot be placed on this 1–36 chart.",
      ),
    ).toBeVisible();
  });

  test("uses measured width for the exact 64px collision boundary and a deterministic narrow value row", () => {
    expect(calloutLayout([0.2, 0.4], 320)).toBe("separate");
    expect(calloutLayout([0.2, 0.399], 320)).toBe("rail");
    expect(calloutLayout([0.2, 0.9], 159)).toBe("value-row");

    const model = buildSchoolChancesModel(
      schoolChancesFactFixtures.full,
      schoolChancesProfileFixtures.compatible,
      "gpa",
      { gpa: 3.9 },
    );
    const { rerender } = render(
      <GpaComparison availableWidth={159} model={model.gpa!} />,
    );
    expect(screen.getByTestId("gpa-marker-rail")).toHaveAttribute(
      "data-callout-layout",
      "value-row",
    );
    rerender(<GpaComparison availableWidth={200} model={model.gpa!} />);
    expect(screen.getByTestId("gpa-marker-rail")).toHaveAttribute(
      "data-callout-layout",
      "rail",
    );
  });

  test("uses a real two-row rail and clamped elbows for tied GPA buckets and outside edges", () => {
    const tied = buildSchoolChancesModel(
      schoolChancesFactFixtures.full,
      schoolChancesProfileFixtures.compatible,
      "gpa",
      { gpa: 3.9 },
    );
    const outside = buildSchoolChancesModel(
      schoolChancesFactFixtures.full,
      { academics: { gpa_unweighted: "2", gpa_scale: "4" } },
      "gpa",
      { gpa: 1 },
    );
    const { container, rerender } = render(
      <GpaComparison availableWidth={200} model={tied.gpa!} />,
    );
    expect(screen.getByTestId("gpa-marker-rail")).toHaveAttribute(
      "data-callout-layout",
      "rail",
    );
    expect(
      container.querySelector("[data-slot=gpa-comparison-callout-leaders]"),
    ).toHaveAttribute("viewBox", "0 0 100 56");

    rerender(<GpaComparison availableWidth={200} model={outside.gpa!} />);
    const rail = screen.getByTestId("gpa-marker-rail");
    expect(rail).toHaveAttribute("data-callout-layout", "rail");
    expect(screen.getByText("Below reported buckets")).toHaveAttribute(
      "data-placement",
      "below-edge",
    );
    expect(screen.getByText("Scenario below reported buckets")).toHaveAttribute(
      "data-placement",
      "below-edge",
    );
    expect(
      container.querySelectorAll(
        "[data-slot=gpa-comparison-edge-marks] [data-placement=below-edge]",
      ),
    ).toHaveLength(2);

    rerender(<GpaComparison availableWidth={159} model={outside.gpa!} />);
    expect(screen.getByTestId("gpa-marker-rail")).toHaveAttribute(
      "data-callout-layout",
      "value-row",
    );
  });

  test("uses normalized fluid leader geometry and all three width states for score callouts", () => {
    const model = buildSchoolChancesModel(
      schoolChancesFactFixtures.full,
      schoolChancesProfileFixtures.compatible,
      "act",
      { act: { composite: 34 } },
    );
    const lane = model.act!;
    const { container, rerender } = render(
      <AcademicComparisonPlot
        availableWidth={159}
        lane={lane}
        title="Composite"
      />,
    );
    expect(
      container.querySelector("[data-slot=academic-comparison-callout-rail]"),
    ).toBeNull();
    expect(
      container.querySelector("[data-slot=academic-comparison-markers]"),
    ).toHaveAttribute("data-callout-layout", "value-row");

    rerender(
      <AcademicComparisonPlot
        availableWidth={200}
        lane={lane}
        title="Composite"
      />,
    );
    expect(
      container.querySelector("[data-slot=academic-comparison-callout-rail]"),
    ).toHaveAttribute("data-callout-layout", "rail");
    expect(
      container.querySelector(
        "[data-slot=academic-comparison-callout-leaders]",
      ),
    ).toHaveAttribute("viewBox", "0 0 100 56");

    const separatedLane = buildSchoolChancesModel(
      schoolChancesFactFixtures.full,
      schoolChancesProfileFixtures.compatible,
      "act",
      { act: { composite: 20 } },
    ).act!;
    rerender(
      <AcademicComparisonPlot
        availableWidth={400}
        lane={separatedLane}
        title="Composite"
      />,
    );
    expect(
      container.querySelector("[data-slot=academic-comparison-callout-rail]"),
    ).toHaveAttribute("data-callout-layout", "separate");
  });

  test("clamps score callout labels at the domain edges in wide and narrow layouts", () => {
    const model = buildSchoolChancesModel(
      schoolChancesFactFixtures.full,
      {
        testing: { act: { composite: 1 } },
      },
      "act",
      { act: { composite: 36 } },
    );
    const { container, rerender } = render(
      <AcademicComparisonPlot
        availableWidth={400}
        lane={model.act!}
        title="Composite"
      />,
    );

    expect(
      container.querySelector("[data-slot=academic-comparison-callout-rail]"),
    ).toHaveAttribute("data-callout-layout", "separate");
    expect(screen.getByText("Your profile 1")).toHaveStyle({
      left: "0%",
      transform: "translateX(0)",
    });
    expect(screen.getByText("Scenario 36")).toHaveStyle({
      left: "100%",
      transform: "translateX(-100%)",
    });

    rerender(
      <AcademicComparisonPlot
        availableWidth={159}
        lane={model.act!}
        title="Composite"
      />,
    );
    expect(
      container.querySelector("[data-slot=academic-comparison-callout-rail]"),
    ).toBeNull();
    expect(
      container.querySelector("[data-slot=academic-comparison-markers]"),
    ).toHaveAttribute("data-callout-layout", "value-row");
    expect(screen.getByText("Your profile 1")).not.toHaveAttribute("style");
    expect(screen.getByText("Scenario 36")).not.toHaveAttribute("style");
  });

  test("anchors band endpoints until their actual measured width overlaps", () => {
    expect(endpointLabelLayout(0.2, 0.8, 300)).toBe("endpoints");
    expect(endpointLabelLayout(0.49, 0.51, 300)).toBe("middle");
    const model = buildSchoolChancesModel(
      schoolChancesFactFixtures.full,
      schoolChancesProfileFixtures.compatible,
      "act",
    );
    const { container, rerender } = render(
      <AcademicComparisonPlot
        availableWidth={500}
        lane={model.act!}
        title="Composite"
      />,
    );
    expect(
      container.querySelector("[data-slot=academic-comparison-band-endpoints]"),
    ).toHaveAttribute("data-band-layout", "endpoints");
    rerender(
      <AcademicComparisonPlot
        availableWidth={20}
        lane={model.act!}
        title="Composite"
      />,
    );
    expect(
      container.querySelector("[data-slot=academic-comparison-band-endpoints]"),
    ).toHaveAttribute("data-band-layout", "middle");
  });
});
