import { describe, expect, test } from "vitest";

import type { Profile } from "@/api/workspace/types";
import type {
  DistributionBucket,
  Fact,
  SchoolFactsResponse,
} from "@/features/schools/facts/school-facts-types";

import { buildChanceLane, type ChanceLane } from "./chance-lane";
import { monotoneInterpolator } from "./monotone-cubic";
import { buildSchoolChancesModel } from "./school-chances-model";
import {
  schoolChancesFactFixtures,
  schoolChancesProfileFixtures,
  withAdmitRate,
} from "./school-chances-fixtures";

const profile = schoolChancesProfileFixtures.compatible;
const EPS = 1e-9;

/** A GPA distribution whose open low bucket's boundary sits exactly at the
 * scale minimum — the case that used to tie "just above 2.00" with "4.00". */
const adversarialGpaResponse: SchoolFactsResponse = factsWith([
  distribution("class_profile.gpa_distribution", "gpa", [
    { label: "Below 2.00", pct: 4 },
    { label: "2.00 - 2.49", lo: 2.0, hi: 2.49, pct: 6 },
    { label: "2.50 - 2.99", lo: 2.5, hi: 2.99, pct: 10 },
    { label: "3.00 - 3.49", lo: 3.0, hi: 3.49, pct: 20 },
    { label: "3.50 - 3.99", lo: 3.5, hi: 3.99, pct: 40 },
    { label: "4.00 and Above", pct: 20 },
  ]),
]);

function factsWith(facts: Fact[]): SchoolFactsResponse {
  return {
    ...schoolChancesFactFixtures.noCrawl,
    has_collegedata: true,
    sections: [
      {
        id: "first",
        title: "First",
        fetch_state: "ok",
        never_checked: false,
        line: null,
        foot: null,
        groups: [{ id: "one", label: null, foot: null, chart: null, facts }],
      },
    ],
  };
}

function distribution(
  key: string,
  scale: string,
  buckets: DistributionBucket[],
): Fact {
  return {
    key,
    label: key,
    tab: "admission",
    state: "value",
    kind: "distribution",
    display: "Reported breakdown",
    unit: "percent",
    value: { scale, buckets, omitted_buckets: [], sums_to: null },
    observed_at: "2026-01-01T00:00:00Z",
    reported_period: "2025-26",
    caveat_ids: [],
  };
}

/** classPercentile swept across the lane, by its own step, stays finite,
 * within [0,1], and never falls as the score rises. */
function assertBoundedAndMonotone(lane: ChanceLane): void {
  let previous = -Infinity;
  for (let value = lane.min; value <= lane.max + lane.step / 2; value += lane.step) {
    const share = lane.classPercentile(value);
    expect(Number.isFinite(share)).toBe(true);
    expect(share).toBeGreaterThanOrEqual(0);
    expect(share).toBeLessThanOrEqual(1);
    expect(share).toBeGreaterThanOrEqual(previous - EPS);
    previous = share;
  }
}

describe("buildChanceLane", () => {
  test("the GPA, SAT, and ACT lanes from the standard fixture stay finite, bounded, and monotone", () => {
    const response = withAdmitRate(schoolChancesFactFixtures.full, 15, "private");
    for (const metric of ["gpa", "sat", "act"] as const) {
      const lane = buildChanceLane(buildSchoolChancesModel(response, profile, metric));
      expect(lane).not.toBeNull();
      assertBoundedAndMonotone(lane!);
    }
  });

  test("an open low bucket at the scale minimum stays finite, bounded, and monotone", () => {
    const lane = buildChanceLane(
      buildSchoolChancesModel(adversarialGpaResponse, profile, "gpa"),
    );
    expect(lane).not.toBeNull();
    assertBoundedAndMonotone(lane!);
  });

  test("a 2.5 GPA ranks well below a 3.9 GPA when the low bucket is open at the scale minimum", () => {
    const lane = buildChanceLane(
      buildSchoolChancesModel(adversarialGpaResponse, profile, "gpa"),
    )!;
    expect(lane.classPercentile(2.5)).toBeLessThan(lane.classPercentile(3.9) - 0.3);
  });

  test("the focused range always contains a saved score far below the class", () => {
    const farBelow: Profile = { academics: { gpa_unweighted: "2.20", gpa_scale: "4.0" } };
    const response = withAdmitRate(schoolChancesFactFixtures.full, 15, "private");
    const lane = buildChanceLane(buildSchoolChancesModel(response, farBelow, "gpa"))!;
    expect(lane.saved).toBe(2.2);
    expect(lane.min).toBeLessThanOrEqual(lane.saved!);
    expect(lane.saved!).toBeLessThanOrEqual(lane.max);
  });
});

describe("monotoneInterpolator", () => {
  test("duplicate x knots collapse instead of producing NaN", () => {
    const curve = monotoneInterpolator([
      { x: 1, y: 0 },
      { x: 1, y: 0.5 },
      { x: 2, y: 0.5 },
      { x: 2, y: 1 },
    ]);
    for (const x of [0, 1, 1.5, 2, 3]) expect(Number.isFinite(curve(x))).toBe(true);
  });
});
