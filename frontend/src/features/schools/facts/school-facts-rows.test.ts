import { describe, expect, test } from "vitest";

import {
  compressAbsences,
  toFactRow,
  type FactRow,
} from "@/features/schools/facts/school-facts-rows";
import type { Fact } from "@/features/schools/facts/school-facts-types";

/*
 * Honesty-critical: this is the one place a run of absences collapses, and
 * the one place a reported `0` could accidentally be mistaken for one.
 */

function fact(overrides: Partial<Fact> & Pick<Fact, "key" | "label">): Fact {
  return {
    tab: "admission",
    state: "not_reported",
    kind: "scalar",
    display: "Not reported",
    unit: null,
    value: null,
    observed_at: null,
    reported_period: null,
    caveat_ids: [],
    ...overrides,
  };
}

const absent = (key: string, label: string, display: string): FactRow =>
  toFactRow(fact({ key, label, display }));

describe("toFactRow", () => {
  test("a reported 0 keeps state \"value\" — never demoted by its own content", () => {
    const row = toFactRow(
      fact({
        key: "k",
        label: "Waitlist accepted",
        state: "value",
        display: "0",
        reported_period: "2025-26",
      }),
    );
    expect(row.state).toBe("value");
    expect(row.display).toBe("0");
    expect(row.reportedPeriod).toBe("2025-26");
  });

  test("a fact with no reported_period carries no suffix", () => {
    const row = toFactRow(
      fact({ key: "k", label: "Admit rate", state: "value", display: "4.6%" }),
    );
    expect(row.reportedPeriod).toBeNull();
  });

  test("reportedPeriod is dropped for a non-value state even if the wire sent one", () => {
    /* Only a rendered VALUE gets the vintage suffix — a not_reported row has
     * no vintage to date. */
    const row = toFactRow(
      fact({
        key: "k",
        label: "Admit rate",
        state: "not_reported",
        display: "Not reported",
        reported_period: "2025-26",
      }),
    );
    expect(row.reportedPeriod).toBeNull();
  });
});

describe("compressAbsences", () => {
  test("three absences for the same reason become one row that keeps every label", () => {
    const out = compressAbsences([
      absent("a", "In-state applicants", "Not reported"),
      absent("b", "In-state admitted", "Not reported"),
      absent("c", "Out-of-state applicants", "Not reported"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].display).toBe("Not reported");
    expect(out[0].state).toBe("not_reported");
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
      absent("a", "In-state applicants", "Not reported"),
      absent("b", "In-state admitted", "Not reported"),
    ];
    expect(compressAbsences(rows)).toEqual(rows);
  });

  test("the five wire states never merge into one another", () => {
    /* "Not reported", "Not checked", "Not on file", "Not checked yet" and
     * "Not collected" are five different claims — merging any two would be
     * exactly the collapse plan §5.1 exists to forbid. */
    const rows: FactRow[] = [
      absent("a", "One", "Not reported"),
      absent("b", "Two", "Not checked"),
      absent("c", "Three", "Not on file"),
    ];
    expect(compressAbsences(rows)).toEqual(rows);
  });

  test("reported values never merge, however identical their display", () => {
    const rows: FactRow[] = ["English", "Mathematics", "Science"].map(
      (label, index) =>
        toFactRow(
          fact({ key: `k${index}`, label, state: "value", display: "4" }),
        ),
    );
    expect(compressAbsences(rows)).toEqual(rows);
  });

  test("no label is lost across a compressed run", () => {
    const rows = [
      absent("a", "One", "Not reported"),
      absent("b", "Two", "Not reported"),
      absent("c", "Three", "Not reported"),
      absent("d", "Four", "Not reported"),
    ];
    const out = compressAbsences(rows);
    expect(out).toHaveLength(1);
    expect(out[0].label.split("; ")).toHaveLength(4);
    expect(out[0].key.split("+")).toHaveLength(4);
  });
});
