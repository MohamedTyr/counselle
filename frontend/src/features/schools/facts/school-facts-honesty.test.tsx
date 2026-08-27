import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { FactTable } from "@/features/schools/facts/FactTable";
import { SchoolFactsSection } from "@/features/schools/facts/SchoolFactsSection";
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
import type {
  SchoolFacts,
  SectionId,
} from "@/features/schools/facts/school-facts-types";

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

/** A plain row: no provenance, no caveats. Phase 4's surface has its own. */
function plainRow(
  key: string,
  label: string,
  value: string,
  reported: boolean,
): FactTableRow {
  return { key, label, value, reported, provenance: [], caveats: [] };
}

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
        rows={[plainRow("k", "Example metric", value, false)]}
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
          plainRow("k", "Off the waitlist", "0", true),
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
        rows={[plainRow("k", "Share", "<1%", true)]}
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
  const absent = (key: string, label: string, value: string): FactTableRow =>
    plainRow(key, label, value, false);

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
      (label, index) => plainRow(`k${index}`, label, "4", true),
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

describe("an unreadable chart ceiling demotes values, never drops them", () => {
  test("a plotted value survives the fallback to rows", () => {
    /*
     * `barDomain` returns null when the configured denominator cannot be
     * read as a number, and the whole group collapses to rows rather than
     * self-scaling against a ceiling nobody supplied.
     *
     * The collapse used to rebuild its rows through `takeRows`, which skips
     * refs the numeric split had already marked seen — so any value that had
     * PASSED the gate fell out of the page entirely. A group with three
     * counts rendered two. This is the block invariant ("nothing is ever in
     * neither") and it is checked with a hand-built packet because no
     * fixture currently reaches that branch.
     */
    const yale = schoolFactsFixture(YALE)!;
    const facts = { ...yale.facts };
    /* The denominator becomes prose; the counts stay numbers. */
    facts["admissions.waitlist_offered_count"] = {
      ...facts["admissions.waitlist_offered_count"],
      state: { kind: "reported", display: "about a thousand", raw: "~1000" },
    };

    const blocks = sectionBlocks(
      { ...yale, facts },
      sectionById("getting-in"),
    );
    const waitlist = blocks.find((block) => block.id === "waitlist");
    expect(waitlist?.kind, "the group should have collapsed to rows").toBe(
      "rows",
    );

    const named = (waitlist?.rows ?? []).flatMap((row) =>
      row.label.split("; "),
    );
    for (const label of [
      "Students offered a waitlist place",
      "Students who accepted a place",
      "Students admitted from the waitlist",
    ]) {
      expect(named, `${label} fell out of the page`).toContain(label);
    }
  });
});

describe("provenance and caveats reach the screen", () => {
  const evidence = (pageNumber: number, excerpt: string, section: string) => ({
    pageNumber,
    excerpt,
    section,
    row: null,
    column: null,
  });

  test("a value with evidence is a real button, not a hover target", () => {
    /* A hover card does not exist on a phone. The disclosure has to be
     * something a finger and a keyboard can both reach. */
    render(
      <FactTable
        rows={[
          {
            ...plainRow("k", "SAT composite", "1500–1560", true),
            provenance: [
              {
                label: "SAT composite",
                evidence: evidence(4, "SAT Composite 25th 1500", "C9"),
              },
            ],
          },
        ]}
      />,
    );
    const trigger = screen.getByRole("button");
    expect(trigger.textContent).toBe("1500–1560");
    /* The accessible name carries the value AND the metric, so the button
     * is not announced as a bare number with no subject. */
    expect(trigger.getAttribute("aria-label")).toContain("SAT composite");
  });

  test("a value with no evidence renders no button", () => {
    /* An affordance that opens an empty card is worse than none: it
     * promises a source we do not have. */
    render(<FactTable rows={[plainRow("k", "Admit rate", "4.6%", true)]} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("every proof in a compressed run survives, each still named", () => {
    /* Four merged absences carry four pages. Keeping one of the four would
     * attribute one metric's proof to the other three. */
    const rows = compressAbsences(
      ["In-state applicants", "In-state admitted", "Out-of-state applicants"].map(
        (label, index) => ({
          ...plainRow(`k${index}`, label, "not applicable", false),
          provenance: [
            {
              label,
              evidence: {
                ...evidence(3, `C1. ${label} — private institution.`, "C1"),
                isAbsenceProof: true,
              },
            },
          ],
        }),
      ),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].provenance).toHaveLength(3);
    expect(rows[0].provenance.map((proof) => proof.label)).toEqual([
      "In-state applicants",
      "In-state admitted",
      "Out-of-state applicants",
    ]);
  });

  test("a severe caveat renders on the row, in words, not by colour", () => {
    const caveat = {
      id: "act-submitters-low",
      severity: "severe" as const,
      text: "Only 41% of the class submitted an ACT score.",
    };
    render(
      <FactTable
        rows={[
          {
            ...plainRow("k", "ACT composite", "34–35", true),
            caveats: [caveat],
          },
        ]}
      />,
    );
    /* The sentence itself, never replaced by the badge — and a word beside
     * it, so the warning survives greyscale and a screen reader. */
    expect(screen.getByText(caveat.text)).toBeInTheDocument();
    expect(screen.getByText("Read with")).toBeInTheDocument();
  });

  test("an ordinary caveat gets no badge — if everything is severe, nothing is", () => {
    render(
      <FactTable
        rows={[
          {
            ...plainRow("k", "SAT composite", "1500–1560", true),
            caveats: [
              {
                id: "sat-submitters",
                severity: "ordinary" as const,
                text: "62% of the enrolled class submitted an SAT score.",
              },
            ],
          },
        ]}
      />,
    );
    expect(screen.queryByText("Read with")).toBeNull();
  });

  test("a severe caveat is never behind the overflow fold", () => {
    /* The overflow bucket is the one group that collapses. A row whose
     * number cannot be read correctly without its caveat is hoisted above
     * the toggle rather than folded — DESIGN §15.2's "never hide an error
     * behind a click", applied to the one warning this page has.
     *
     * Built as a packet of unplaced refs, which is exactly what lands in
     * "Other published values", so this exercises the real render path. */
    const yale = schoolFactsFixture(YALE)!;
    const facts: SchoolFacts["facts"] = {};
    for (let index = 0; index < 12; index += 1) {
      /* Zero-padded: strays render in sorted ref order, so unpadded names
       * would put "…_11" fourth and the fold would land elsewhere. */
      const ref = `admissions.stray_metric_${String(index).padStart(2, "0")}`;
      facts[ref] = {
        ref,
        label: `Filler metric ${String(index).padStart(2, "0")}`,
        /* Reported, so the run does not compress — this test is about the
         * FOLD, and twelve identical absences would collapse to one row
         * before they ever reached it. */
        state: { kind: "reported", display: "Yes", raw: true },
        evidence: null,
        contexts: [],
        caveatRefs: [],
      };
    }
    facts["admissions.stray_withheld"] = {
      ref: "admissions.stray_withheld",
      label: "Withheld metric",
      state: { kind: "suppressed" },
      evidence: null,
      contexts: [],
      caveatRefs: ["suppressed"],
    };

    render(
      <SchoolFactsSection
        data={{ ...yale, facts, derived: {}, degreeShares: [] }}
        section={sectionById("getting-in")}
      />,
    );

    /* Collapsed by default: something past the eighth row is not on screen. */
    expect(screen.getByText(/Show \d+ more/)).toBeInTheDocument();
    expect(screen.queryByText("Filler metric 11")).toBeNull();
    /* But the severe one, and its sentence, are. */
    expect(screen.getByText("Withheld metric")).toBeInTheDocument();
    expect(
      screen.getByText(yale.caveats["suppressed"].text),
    ).toBeInTheDocument();
  });
});

