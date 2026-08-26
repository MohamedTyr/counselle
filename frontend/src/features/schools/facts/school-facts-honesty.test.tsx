import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { FactTable } from "@/features/schools/facts/FactTable";
import { schoolFactsFixture } from "@/features/schools/facts/school-facts-fixtures";
import {
  sectionRows,
  type FactTableRow,
} from "@/features/schools/facts/school-facts-rows";
import { sectionById } from "@/features/schools/facts/school-facts-sections";
import type { SectionId } from "@/features/schools/facts/school-facts-types";

/*
 * All honesty-critical. There is no coverage target here and no reflexive
 * render test — each of these guards a way a two-column table could quietly
 * tell a student something untrue, and a screenshot review would not catch
 * any of them.
 */

const YALE = 130794;

function rowsFor(unitid: number, section: SectionId): FactTableRow[] {
  return sectionRows(schoolFactsFixture(unitid)!, sectionById(section));
}

function findRow(rows: FactTableRow[], label: string): FactTableRow {
  const row = rows.find((item) => item.label === label);
  expect(row, `no row labelled "${label}"`).toBeDefined();
  return row!;
}

describe("every absence renders as words", () => {
  const cases: Array<[string, string]> = [
    ["not reported", "not reported"],
    ["not applicable", "not applicable"],
    ["withheld by the school", "withheld by the school"],
    ["not in this form edition", "not in this form edition"],
    ["no verified value", "no verified value"],
  ];

  test.each(cases)("%s survives the table", (value, copy) => {
    const { container } = render(
      <FactTable
        rows={[{ key: "k", label: "Example metric", value, reported: false }]}
      />,
    );
    expect(screen.getByText(copy)).toBeInTheDocument();
    /* The failure this guards: a blank cell, a dash, or a zero standing in
     * for an absence. Any of those reads as "we know, and it's nothing." */
    const cell = container.querySelectorAll("td")[1];
    expect(cell?.textContent?.trim()).not.toBe("");
    expect(cell?.textContent).not.toMatch(/^[-—–0]$/);
    expect(cell?.textContent).not.toContain("N/A");
  });

  test("a reported 0 renders as a value, not as an absence", () => {
    const { container } = render(
      <FactTable
        rows={[{ key: "k", label: "Off the waitlist", value: "0", reported: true }]}
      />,
    );
    const cell = container.querySelectorAll("td")[1];
    expect(cell.textContent).toBe("0");
    /* Zero is a fact — nobody came off the waitlist — so it carries the
     * value's weight and never the absent italic. */
    expect(cell.className).toContain("font-medium");
    expect(cell.className).not.toContain("italic");
  });

  test("a string percent keeps its qualifier verbatim", () => {
    render(
      <FactTable
        rows={[{ key: "k", label: "Share", value: "<1%", reported: true }]}
      />,
    );
    expect(screen.getByText("<1%")).toBeInTheDocument();
  });

  test("no section ever builds a row with an empty value", () => {
    const sections: SectionId[] = [
      "getting-in",
      "money",
      "academics",
      "campus-life",
      "outcomes",
      "applying",
    ];
    for (const unitid of [YALE, 167358, 190567]) {
      for (const section of sections) {
        for (const row of rowsFor(unitid, section)) {
          expect(row.value.trim(), `${unitid} ${section} ${row.label}`).not.toBe(
            "",
          );
          expect(row.value).not.toMatch(/^[-—–]$/);
        }
      }
    }
  });
});

describe("not_in_template_version is a third state", () => {
  test("it never renders as a no", () => {
    const fact =
      schoolFactsFixture(YALE)!.facts[
        "class_profile.class_rank_top_tenth_percent"
      ];
    expect(fact.state.kind).toBe("not_in_template_version");

    /* A row absent from this school's form edition is a fact about the form.
     * Reading it as "No" would turn "the question wasn't asked" into "the
     * school answered no". */
    const row = findRow(rowsFor(YALE, "getting-in"), fact.label);
    expect(row.value).toBe("not in this form edition");
    expect(row.reported).toBe(false);

    render(<FactTable rows={[row]} />);
    expect(screen.queryByText("No")).toBeNull();
    expect(screen.queryByText("false")).toBeNull();
  });
});

describe("a derived value with an unavailable input does not compute", () => {
  test("it says not available rather than a number", () => {
    /* Northeastern's applicant count is unreported, so the admit rate has no
     * denominator. A rate rendered anyway is the most convincing wrong number
     * this page could produce. */
    const northeastern = schoolFactsFixture(167358)!;
    expect(northeastern.derived.admit_rate.state.kind).not.toBe("reported");
    expect(northeastern.derived.admit_rate.blockedBy).toMatch(/not reported/);

    const row = findRow(rowsFor(167358, "getting-in"), "Admit rate");
    expect(row.value).toBe("not available");
    expect(row.reported).toBe(false);
    expect(row.value).not.toMatch(/NaN|Infinity|^0%$/);
  });
});

describe("rounds keep their three states apart", () => {
  test("not offered and not reported never collapse", () => {
    const rows = rowsFor(YALE, "applying");
    /* A student who reads "not offered" stops looking. Being wrong about
     * that costs them a round. */
    expect(findRow(rows, "ED").value).toBe("not offered");
    expect(findRow(rows, "EA").value).toBe("not reported");
  });
});
