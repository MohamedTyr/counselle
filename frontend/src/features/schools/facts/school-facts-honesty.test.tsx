import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { CaveatLine } from "@/features/schools/facts/CaveatLine";
import { DerivedFactRow, FactRow } from "@/features/schools/facts/FactRow";
import {
  coverageFraction,
  coverageLine,
} from "@/features/schools/facts/school-facts-format";
import { schoolFactsFixture } from "@/features/schools/facts/school-facts-fixtures";
import type {
  Caveat,
  DerivedFact,
  Fact,
  FactState,
} from "@/features/schools/facts/school-facts-types";

/*
 * Five tests, all honesty-critical. There is no coverage target here and no
 * reflexive render test — these exist because each one guards a way the page
 * could quietly tell a student something untrue, and a screenshot review
 * would not catch any of them.
 */

const caveats: Record<string, Caveat> = {
  ordinary: { id: "ordinary", severity: "ordinary", text: "of aid recipients" },
  severe: {
    id: "severe",
    severity: "severe",
    text: "Only 38% of the class submitted an SAT score — this band describes the top third, not the class.",
  },
};

function factWith(state: FactState, caveatRefs: string[] = []): Fact {
  return {
    ref: "admissions.example",
    label: "Example metric",
    state,
    evidence: null,
    contexts: [],
    caveatRefs,
  };
}

function renderRow(fact: Fact) {
  return render(
    <dl>
      <FactRow caveats={caveats} edition={null} fact={fact} />
    </dl>,
  );
}

describe("FactRow renders every absence as words", () => {
  const cases: Array<[FactState["kind"], string]> = [
    ["not_reported", "not reported"],
    ["not_applicable", "not applicable"],
    ["suppressed", "withheld by the school"],
    ["not_in_template_version", "not in this form edition"],
    ["no_verified_value", "no verified value"],
  ];

  test.each(cases)("%s renders as %s", (kind, copy) => {
    const { container } = renderRow(factWith({ kind } as FactState));
    expect(screen.getByText(copy)).toBeInTheDocument();
    /* The failure this guards: a blank cell, a dash, or a zero standing in
     * for an absence. Any of those reads as "we know, and it's nothing." */
    const value = container.querySelector("dd");
    expect(value?.textContent?.trim()).not.toBe("");
    expect(value?.textContent).not.toMatch(/^[-—–0]$/);
    expect(value?.textContent).not.toContain("N/A");
  });

  test("a reported 0 renders as a value, not as an absence", () => {
    const { container } = renderRow(
      factWith({ kind: "reported", display: "0", raw: 0 }),
    );
    const value = within(container.querySelector("dd")!).getByText("0");
    expect(value).toBeInTheDocument();
    /* Zero is a fact — nobody came off the waitlist — so it carries the
     * value's weight and never the absent italic. */
    expect(value.className).toContain("font-medium");
    expect(value.className).not.toContain("italic");
  });

  test("a string percent keeps its qualifier verbatim", () => {
    renderRow(factWith({ kind: "reported", display: "<1%", raw: "<1%" }));
    expect(screen.getByText("<1%")).toBeInTheDocument();
  });
});

describe("a caveat cannot be dropped", () => {
  test("a fact with caveatRefs renders its caveat as visible text", () => {
    renderRow(
      factWith({ kind: "reported", display: "94%", raw: 94 }, ["ordinary"]),
    );
    expect(screen.getByText("of aid recipients")).toBeVisible();
  });

  test("the caveat lives inside the value's own <dd>", () => {
    /* This is the whole reason it is not a tooltip: a screen reader reading
     * the definition reads the qualifier with it. */
    const { container } = renderRow(
      factWith({ kind: "reported", display: "94%", raw: 94 }, ["ordinary"]),
    );
    const definitions = [...container.querySelectorAll("dd")];
    expect(
      definitions.some((node) =>
        node.textContent?.includes("of aid recipients"),
      ),
    ).toBe(true);
  });

  test("a severe caveat is not colour alone", () => {
    render(<CaveatLine caveat={caveats.severe} />);
    const line = screen.getByText(caveats.severe.text).closest("p")!;
    /* Weight, a glyph, and a title — it has to survive greyscale, a screen
     * reader, and a printout. */
    expect(line.className).toContain("font-medium");
    expect(line.getAttribute("title")).toBe(caveats.severe.text);
    expect(line.querySelector("svg")).not.toBeNull();
  });
});

describe("coverage is reported as a contract", () => {
  test("M comes from the manifest and K is stated separately", () => {
    const line = coverageLine(
      { verified: 24, configured: 28, notInTemplate: 4, packet: "accepted" },
      {
        academicYear: 2025,
        documentId: "d",
        documentUrl: null,
        currentness: "current",
        stalenessReason: null,
        partialDomainCount: 0,
        configuredDomainCount: 13,
        currentDefinitionMatch: true,
      },
    );
    expect(line).toContain("24 of 28 verified");
    expect(line).toContain("4 not in this form edition");
    /* "missing" would fold a fact about the school's form edition into a
     * claim about a gap in our data. */
    expect(line).not.toContain("missing");
  });

  test("a section with no packet shows an em dash, never 0 of N", () => {
    expect(
      coverageFraction({
        verified: 0,
        configured: 24,
        notInTemplate: 0,
        packet: "missing",
      }),
    ).toBe("—");
  });
});

describe("not_in_template_version is a third state", () => {
  test("it never renders as a no, and it carries page proof", () => {
    const yale = schoolFactsFixture(130794)!;
    const fact = yale.facts["class_profile.class_rank_top_tenth_percent"];
    expect(fact.state.kind).toBe("not_in_template_version");
    /* A verified assertion needs a physical page and an excerpt proving the
     * row does not exist. A blank cell, failed OCR, or a model that could
     * not find the metric is not proof. */
    expect(fact.evidence?.isAbsenceProof).toBe(true);
    expect(fact.evidence?.pageNumber).toBeGreaterThan(0);
    expect(fact.evidence?.excerpt.length).toBeGreaterThan(0);

    renderRow(fact);
    expect(screen.getByText("not in this form edition")).toBeInTheDocument();
    expect(screen.queryByText("No")).toBeNull();
    expect(screen.queryByText("false")).toBeNull();
  });
});

describe("a derived value with an unavailable input does not compute", () => {
  test("it says not available and names what stopped it", () => {
    const derived: DerivedFact = {
      key: "admit_rate",
      label: "Admit rate",
      state: { kind: "not_reported" },
      formula: "admitted ÷ applicants",
      inputs: [],
      blockedBy:
        "Applicants not reported, so the admit rate cannot be calculated.",
      caveatRefs: [],
    };
    render(
      <dl>
        <DerivedFactRow caveats={caveats} derived={derived} edition={null} />
      </dl>,
    );
    expect(screen.getByText("not available")).toBeInTheDocument();
    expect(screen.getByText(derived.blockedBy!)).toBeVisible();
    /* Never a partial computation and never a zero denominator: an admit
     * rate rendered from a missing applicant count is the most convincing
     * wrong number this page could produce. */
    expect(screen.queryByText("0%")).toBeNull();
    expect(screen.queryByText("NaN")).toBeNull();
    expect(screen.queryByText("Infinity")).toBeNull();
  });

  test("the Northeastern fixture exercises that path", () => {
    const northeastern = schoolFactsFixture(167358)!;
    expect(northeastern.derived.admit_rate.state.kind).not.toBe("reported");
    expect(northeastern.derived.admit_rate.blockedBy).toMatch(/not reported/);
  });
});
