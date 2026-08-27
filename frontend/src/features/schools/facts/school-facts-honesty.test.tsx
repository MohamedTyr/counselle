import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { FactTable } from "@/features/schools/facts/FactTable";
import { schoolFactsFixture } from "@/features/schools/facts/school-facts-fixtures";
import {
  sectionBlocks,
  type SectionBlock,
} from "@/features/schools/facts/school-facts-blocks";
import {
  compressAbsences,
  type FactTableRow,
} from "@/features/schools/facts/school-facts-rows";
import { sectionById } from "@/features/schools/facts/school-facts-sections";
import type { SectionId } from "@/features/schools/facts/school-facts-types";

const SECTIONS: SectionId[] = [
  "getting-in",
  "money",
  "academics",
  "campus-life",
  "outcomes",
  "applying",
];

/** Yale, Northeastern, and a school with no readable CDS at all. */
const FIXTURES = [130794, 167358, 190567];

/*
 * All honesty-critical. There is no coverage target here and no reflexive
 * render test — each of these guards a way a two-column table could quietly
 * tell a student something untrue, and a screenshot review would not catch
 * any of them.
 */

const YALE = 130794;

function blocksFor(unitid: number, section: SectionId): SectionBlock[] {
  return sectionBlocks(schoolFactsFixture(unitid)!, sectionById(section));
}

/** Every unplotted value in a section, across every block. */
function rowsFor(unitid: number, section: SectionId): FactTableRow[] {
  return blocksFor(unitid, section).flatMap((block) => block.rows);
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
        rows={[
          { key: "k", label: "Off the waitlist", value: "0", reported: true },
        ]}
      />,
    );
    const cell = container.querySelectorAll("td")[1];
    expect(cell.textContent).toBe("0");
    /* Zero is a fact — nobody came off the waitlist — so it reads in the
     * value ink and never in the absent italic. Weight is a HIERARCHY
     * signal here (headline vs body), so it is not what separates a value
     * from an absence; ink and slant are. */
    expect(cell.className).toContain("--school-fact-value");
    expect(cell.className).not.toContain("italic");
    expect(cell.className).not.toContain("--school-fact-absent");
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
    for (const unitid of FIXTURES) {
      for (const section of SECTIONS) {
        for (const row of rowsFor(unitid, section)) {
          expect(
            row.value.trim(),
            `${unitid} ${section} ${row.label}`,
          ).not.toBe("");
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

/*
 * ── charts ───────────────────────────────────────────────────────────────
 *
 * A chart fails differently from a table. A table's worst case is an ugly
 * cell; a chart's worst case is a bar of zero width that a reader takes for
 * a measurement of nothing. These guard the geometry.
 */

describe("a chart never plots a value we do not have", () => {
  test("every entry is either plotted or written out — never neither", () => {
    for (const unitid of FIXTURES) {
      for (const section of SECTIONS) {
        for (const block of blocksFor(unitid, section)) {
          const plotted =
            block.kind === "bars"
              ? block.points.length
              : block.kind === "ordinal"
                ? block.items.length
                : block.kind === "bands"
                  ? block.bands.length
                  : 0;
          /* An empty block is the bug this catches: it means the builder
           * dropped entries on the floor rather than demoting them to rows. */
          expect(
            plotted + block.rows.length,
            `${unitid} ${section} ${block.id} rendered nothing`,
          ).toBeGreaterThan(0);
        }
      }
    }
  });

  test("no plotted point carries a non-numeric or non-finite value", () => {
    for (const unitid of FIXTURES) {
      for (const section of SECTIONS) {
        for (const block of blocksFor(unitid, section)) {
          if (block.kind !== "bars") continue;
          for (const point of block.points) {
            expect(Number.isFinite(point.value)).toBe(true);
            /* The number is never the only channel: the display string is
             * printed beside the mark, and it is what a screen reader and a
             * greyscale print get. */
            expect(point.display.trim()).not.toBe("");
          }
        }
      }
    }
  });

  test("a share with no parsed percent becomes a row, never a bar", () => {
    /* Yale publishes "<1%" for one field of study. The qualifier IS the
     * value — parsing it to 0.9 would invent precision, and plotting it as
     * zero would say nobody graduates in it. */
    const shares = schoolFactsFixture(YALE)!.degreeShares;
    const stringPercent = shares.find((share) => share.percent === null);
    expect(stringPercent, "fixture lost its <1% share").toBeDefined();

    const block = blocksFor(YALE, "academics").find(
      (item) => item.id === "degree-shares",
    );
    expect(block?.kind).toBe("bars");
    if (block?.kind !== "bars") throw new Error("unreachable");

    expect(
      block.points.some((point) => point.key.includes(stringPercent!.ref)),
    ).toBe(false);
    const row = block.rows.find((item) =>
      item.key.includes(stringPercent!.ref),
    );
    expect(row?.value).toBe(
      stringPercent!.state.kind === "reported"
        ? stringPercent!.state.display
        : row?.value,
    );
  });

  test("counts scale to the largest bar, never to a sum", () => {
    /* Scaling to a total would let one unreported bin silently shrink every
     * other bar — the "a blank reads as zero" failure, in geometry. */
    const block = blocksFor(YALE, "academics").find(
      (item) => item.id === "class-sizes",
    );
    expect(block?.kind).toBe("bars");
    if (block?.kind !== "bars") throw new Error("unreachable");

    const values = block.points.map((point) => point.value);
    const sum = values.reduce((total, value) => total + value, 0);
    expect(block.max).toBe(Math.max(...values));
    expect(block.max).toBeLessThan(sum);
  });

  test("an ordinal level outside the vocabulary is not guessed at a rank", () => {
    const block = blocksFor(YALE, "getting-in").find(
      (item) => item.id === "selection-factors",
    );
    expect(block?.kind).toBe("ordinal");
    if (block?.kind !== "ordinal") throw new Error("unreachable");

    for (const item of block.items) {
      /* Every plotted item's rank came from the configured vocabulary, and
       * its own words are still printed beside the steps. */
      expect(block.levels[item.level]?.toLowerCase()).toBe(
        item.display.trim().toLowerCase(),
      );
    }
    /* Sorted heaviest first, so the top of the block IS the answer. */
    const levels = block.items.map((item) => item.level);
    expect([...levels].sort((a, b) => b - a)).toEqual(levels);
  });

  test("a band needs all three percentiles, in order", () => {
    const block = blocksFor(YALE, "getting-in").find(
      (item) => item.id === "test-detail",
    );
    expect(block?.kind).toBe("bands");
    if (block?.kind !== "bands") throw new Error("unreachable");

    for (const band of block.bands) {
      expect(band.p25).toBeLessThanOrEqual(band.p50);
      expect(band.p50).toBeLessThanOrEqual(band.p75);
      /* Each test keeps its own scale, and the band sits inside it. A
       * percentile outside its own domain is a misread, not a chart. */
      expect(band.p25).toBeGreaterThanOrEqual(band.min);
      expect(band.p75).toBeLessThanOrEqual(band.max);
    }
  });

  test("a missing denominator collapses the chart rather than self-scaling", () => {
    /*
     * Northeastern does not report its applicant count. Scaling the funnel
     * to the largest bar that survived would draw "3,850 admitted" at full
     * width — a picture of everyone getting in, from a school that never
     * said how many applied.
     */
    const northeastern = schoolFactsFixture(167358)!;
    const applicants = northeastern.facts["admissions.applicants_total"];
    expect(applicants?.state.kind).not.toBe("reported");

    const block = blocksFor(167358, "getting-in").find(
      (item) => item.id === "applicant-pool",
    );
    expect(block?.kind).toBe("rows");
    /* And the values are still all there, as words. */
    expect(block?.rows.some((row) => row.label === "Total applicants")).toBe(
      true,
    );
  });

  test("a share is always measured against 100, never against its largest bar", () => {
    for (const unitid of FIXTURES) {
      for (const section of SECTIONS) {
        for (const block of blocksFor(unitid, section)) {
          if (block.kind !== "bars" || block.unit !== "percent") continue;
          /* 53% drawn full-width because it happened to lead the group
           * would read as "everyone". */
          expect(block.max).toBe(100);
        }
      }
    }
  });

  test("cumulative completion never exceeds its cohort", () => {
    /* The bars are counts of one cohort against that cohort. A bar past the
     * ceiling would mean more students finished than started, which is a
     * denominator bug rendered as a confident picture. */
    for (const unitid of FIXTURES) {
      const block = blocksFor(unitid, "outcomes").find(
        (item) => item.id === "time-to-degree",
      );
      if (block?.kind !== "bars") continue;
      for (const point of block.points) {
        expect(point.value).toBeLessThanOrEqual(block.max);
      }
    }
  });

  test("a school with no CDS renders no chart at all", () => {
    /* An empty axis frame reads as "we measured, and there was nothing".
     * The empty state has to be words. */
    for (const section of SECTIONS) {
      for (const block of blocksFor(190567, section)) {
        if (block.kind === "rows") continue;
        const plotted =
          block.kind === "bars"
            ? block.points.length
            : block.kind === "ordinal"
              ? block.items.length
              : block.bands.length;
        expect(plotted, `${section} ${block.id} drew an empty chart`).toBe(0);
      }
    }
  });
});

describe("compressing a run of absences never hides one", () => {
  const absent = (key: string, label: string, value: string): FactTableRow => ({
    key,
    label,
    value,
    reported: false,
  });

  test("three absences for the same reason become one row that keeps every label", () => {
    const out = compressAbsences([
      absent("a", "In-state applicants", "not applicable"),
      absent("b", "In-state admitted", "not applicable"),
      absent("c", "Out-of-state applicants", "not applicable"),
    ]);

    expect(out).toHaveLength(1);
    /* The reason is on screen at full size — this is a compression, not a
     * fold. A student can still see WHICH metrics we have nothing for. */
    expect(out[0].value).toBe("not applicable");
    expect(out[0].reported).toBe(false);
    for (const label of [
      "In-state applicants",
      "In-state admitted",
      "Out-of-state applicants",
    ]) {
      expect(out[0].label).toContain(label);
    }
  });

  test("two absences are left alone — a pair is not a wall", () => {
    const rows = [
      absent("a", "In-state applicants", "not applicable"),
      absent("b", "In-state admitted", "not applicable"),
    ];
    expect(compressAbsences(rows)).toEqual(rows);
  });

  test("absences for DIFFERENT reasons never merge", () => {
    /* "not reported" and "not applicable" are different claims about a
     * school. Merging them would invent a reason for two of the three. */
    const rows = [
      absent("a", "One", "not reported"),
      absent("b", "Two", "not applicable"),
      absent("c", "Three", "not reported"),
    ];
    expect(compressAbsences(rows)).toEqual(rows);
  });

  test("reported values never merge, however identical", () => {
    const rows: FactTableRow[] = ["English", "Mathematics", "Science"].map(
      (label, index) => ({
        key: `k${index}`,
        label,
        value: "4",
        reported: true,
      }),
    );
    expect(compressAbsences(rows)).toEqual(rows);
  });

  test("no label is lost from any section of any fixture", () => {
    /* The structural guarantee, checked against the real data rather than a
     * constructed run: compression may change how many ROWS render, never
     * which metrics are named. */
    for (const unitid of FIXTURES) {
      for (const section of SECTIONS) {
        for (const block of blocksFor(unitid, section)) {
          const named = block.rows.flatMap((row) => row.label.split("; "));
          expect(new Set(named).size, `${unitid} ${section} ${block.id}`).toBe(
            named.length,
          );
          for (const row of block.rows) {
            /* One label per merged key. A row whose key says it swallowed
             * four metrics but only names three has lost one. */
            expect(
              row.label.split("; ").length,
              `${block.id} row ${row.key} lost a label`,
            ).toBe(row.key.split("+").length);
          }
        }
      }
    }
  });
});
