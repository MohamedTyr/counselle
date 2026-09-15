import type { Profile } from "@/api/workspace/types";
import type {
  DistributionBucket,
  Fact,
  SchoolFactsResponse,
} from "@/features/schools/facts/school-facts-types";

import { CHANCES_FACT_KEYS } from "./school-chances-contract";

/** Representative, frozen Phase-0 inputs; later phases must not mutate them. */
export const schoolChancesFactFixtures = deepFreeze({
  full: factsResponse([
    distribution("class_profile.gpa_distribution", "gpa", [
      { label: "4.00 and Above", pct: 20 },
      { label: "3.75 - 3.99", lo: 3.75, hi: 3.99, pct: 50 },
      { label: "3.50 - 3.74", lo: 3.5, hi: 3.74, pct: 30 },
    ]),
    scalar("class_profile.average_gpa", 3.7),
    band("class_profile.sat_math", 690, 760),
    scalar("class_profile.sat_math_avg", 725),
    distribution("class_profile.sat_math_distribution", "sat_math", [
      { label: "Score of 700 - 800", pct: 55 },
      { label: "Score of 600 - 700", pct: 45 },
    ]),
    band("class_profile.sat_ebrw", 680, 750),
    scalar("class_profile.sat_ebrw_avg", 715),
    distribution("class_profile.sat_ebrw_distribution", "sat_ebrw", [
      { label: "Score of 700 - 800", pct: 50 },
      { label: "Score of 600 - 700", pct: 50 },
    ]),
    band("class_profile.act_composite", 30, 34, 1, 36),
    scalar("class_profile.act_composite_avg", 32),
    distribution("class_profile.act_composite_distribution", "act_composite", [
      { label: "Score of 30 - 36", pct: 60 },
      { label: "Score of 24 - 29", pct: 40 },
    ]),
    scalar("admissions.test_policy_sat_or_act", "Considered if submitted"),
  ]),
  partial: factsResponse([
    distribution(
      "class_profile.gpa_distribution",
      "gpa",
      [
        { label: "4.00 and Above", absence: "not_reported" },
        { label: "3.75 - 3.99", lo: 3.75, hi: 3.99, pct: 60 },
      ],
      {
        omitted_buckets: [{ label: "3.50 - 3.74", display: "Not reported" }],
        sums_to: 60,
      },
    ),
  ]),
  allAbsent: factsResponse([
    distribution("class_profile.gpa_distribution", "gpa", [
      { label: "4.00 and Above", absence: "not_reported" },
      { label: "3.75 - 3.99", lo: 3.75, hi: 3.99, absence: "not_reported" },
    ]),
  ]),
  /** Endpoint-level absence states; distinct from a value distribution whose buckets are all absent. */
  absenceStates: factsResponse([
    absentFact("class_profile.average_gpa", "not_reported"),
    absentFact("class_profile.sat_math", "not_fetched"),
    absentFact("class_profile.sat_ebrw", "not_published"),
    absentFact("class_profile.act_composite", "not_collected"),
  ]),
  stale: factsResponse(
    [
      distribution("class_profile.gpa_distribution", "gpa", [
        { label: "4.00 and Above", pct: 100 },
      ]),
    ],
    {
      is_stale: true,
      freshness_line: "Last checked January 2025 — this may be out of date",
    },
  ),
  malformed: factsResponse([
    distribution("class_profile.sat_ebrw_distribution", "SAT EBRW score", [
      { label: "Score of 900 - 950", pct: 100 },
    ]),
    band("class_profile.sat_ebrw", 680, 750),
  ]),
  noCrawl: factsResponse([], { has_collegedata: false, freshness_line: null }),
});

export const schoolChancesProfileFixtures = deepFreeze({
  compatible: {
    academics: { gpa_unweighted: "3.82", gpa_scale: "4.0" },
    testing: {
      sat: { total: 1500, math: 760, ebrw: 740 },
      act: { composite: 33 },
    },
  } satisfies Profile,
  missingRow: null,
  partial: { testing: { sat: { total: 1450, math: 730 } } } satisfies Profile,
  incompatible: {
    academics: { gpa_unweighted: "4.5", gpa_scale: "5.0" },
  } satisfies Profile,
  requestFailure: { message: "Could not load your profile." },
});

function factsResponse(
  facts: Fact[],
  overrides: Partial<SchoolFactsResponse> = {},
): SchoolFactsResponse {
  return {
    identity: {
      unitid: 166027,
      name: "Fixture University",
      city: "Somewhere",
      state: "CA",
      control: "private",
      undergraduates: 1000,
      website_url: "https://fixture.example.edu",
      domain: "fixture.example.edu",
    },
    has_collegedata: true,
    observed_at: "2026-09-15T00:00:00Z",
    is_stale: false,
    freshness_line: "Checked September 2026",
    deadlines: {
      rows: [],
      foot: "Confirm on the school's site before you apply.",
    },
    sections: [
      {
        id: "getting-in",
        title: "Getting in",
        fetch_state: "ok",
        never_checked: false,
        line: null,
        foot: null,
        groups: [
          { id: "comparison", label: null, foot: null, chart: null, facts },
        ],
      },
    ],
    caveats: [],
    ...overrides,
  };
}

function distribution(
  key: Extract<(typeof CHANCES_FACT_KEYS)[number], `${string}_distribution`>,
  scale: string,
  buckets: DistributionBucket[],
  overrides: {
    omitted_buckets?: { label: string; display: string }[];
    sums_to?: number | null;
  } = {},
): Fact {
  const reported = buckets.reduce(
    (total, bucket) =>
      total + (typeof bucket.pct === "number" ? bucket.pct : 0),
    0,
  );
  return {
    key,
    label: key,
    tab: "admission",
    state: "value",
    kind: "distribution",
    display: `${buckets.length} buckets reported`,
    unit: "percent",
    value: {
      scale,
      buckets,
      omitted_buckets: overrides.omitted_buckets ?? [],
      sums_to: overrides.sums_to ?? (reported || null),
    },
    observed_at: "2026-09-15T00:00:00Z",
    reported_period: "2025-26",
    caveat_ids: [],
  };
}

function scalar(key: string, value: number | string): Fact {
  return {
    key,
    label: key,
    tab: "admission",
    state: "value",
    kind: "scalar",
    display: String(value),
    unit: null,
    value,
    observed_at: "2026-09-15T00:00:00Z",
    reported_period: "2025-26",
    caveat_ids: [],
  };
}

function absentFact(key: string, state: Exclude<Fact["state"], "value">): Fact {
  const display = {
    not_reported: "Not reported",
    not_fetched: "Not checked",
    not_published: "Not on file",
    not_collected: "Not collected",
  }[state];
  return {
    key,
    label: key,
    tab: "admission",
    state,
    kind: "scalar",
    display,
    unit: null,
    value: null,
    observed_at: null,
    reported_period: null,
    caveat_ids: [],
  };
}

function band(
  key: string,
  p25: number,
  p75: number,
  min = 200,
  max = 800,
): Fact {
  return {
    key,
    label: key,
    tab: "admission",
    state: "value",
    kind: "band",
    display: `${p25}-${p75}`,
    unit: null,
    value: { p25, p75, min, max, submitted_percent: null },
    observed_at: "2026-09-15T00:00:00Z",
    reported_period: "2025-26",
    caveat_ids: [],
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
