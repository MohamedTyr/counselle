import { describe, expect, test } from "vitest";

import type {
  DistributionBucket,
  Fact,
  SchoolFactsResponse,
} from "@/features/schools/facts/school-facts-types";

import {
  buildSchoolChancesModel,
  collectChancesFacts,
} from "./school-chances-model";
import {
  schoolChancesFactFixtures,
  schoolChancesProfileFixtures,
} from "./school-chances-fixtures";

const profile = schoolChancesProfileFixtures.compatible;

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
  overrides: Partial<Fact> & { sums_to?: number | null } = {},
): Fact {
  return {
    key,
    label: key,
    tab: "admission",
    state: "value",
    kind: "distribution",
    display: "Reported breakdown",
    unit: "percent",
    value: {
      scale,
      buckets,
      omitted_buckets: [],
      sums_to: overrides.sums_to ?? null,
    },
    observed_at: "2026-01-01T00:00:00Z",
    reported_period: "2025-26",
    caveat_ids: [],
    ...overrides,
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
    observed_at: "2026-01-01T00:00:00Z",
    reported_period: "2025-26",
    caveat_ids: [],
  };
}

describe("school chances pure model", () => {
  test("collects allowlisted facts across nested sections and fails closed on duplicates", () => {
    const first = distribution("class_profile.gpa_distribution", "gpa", [
      { label: "3.00 - 3.49", pct: 100 },
    ]);
    const duplicate = { ...first, display: "Different" };
    const response = factsWith([first]);
    response.sections.push({
      ...response.sections[0]!,
      id: "second",
      groups: [{ ...response.sections[0]!.groups[0]!, facts: [duplicate] }],
    });

    const collected = collectChancesFacts(response);
    expect(collected.duplicateKeys).toEqual(["class_profile.gpa_distribution"]);
    expect(collected.facts["class_profile.gpa_distribution"]).toBeNull();
    expect(buildSchoolChancesModel(response, profile, "gpa").school.state).toBe(
      "malformed",
    );
  });

  test("uses only the frozen fact/Profile allowlists and preserves response display metadata", () => {
    const response = factsWith([
      distribution("activities.hours", "gpa", [
        { label: "3.00 - 3.49", pct: 100 },
      ]),
      distribution("class_profile.gpa_distribution", "gpa", [
        { label: "3.00 - 3.49", pct: 100 },
      ]),
    ]);
    const model = buildSchoolChancesModel(
      response,
      {
        academics: { gpa_unweighted: "3.25", gpa_scale: "4" },
        testing: { act: { composite: 31, sections: { english: "35" } } },
      },
      "gpa",
    );

    expect(model.gpa?.profile.display).toBe("3.25");
    expect(model.gpa?.distribution?.reportedPeriod).toBe("2025-26");
    expect(model.freshnessLine).toBeNull();
    expect(model).not.toHaveProperty("activities");
    expect(model).not.toHaveProperty("classification");
  });

  test("orders GPA buckets low-to-high immutably and preserves zero versus absent", () => {
    const source = distribution(
      "class_profile.gpa_distribution",
      "gpa",
      [
        { label: "4.00 and Above", pct: 0 },
        { label: "3.50 - 3.99", pct: 60 },
        { label: "Below 3.50", absence: "not_reported" },
      ],
      { sums_to: 60 },
    );
    const response = factsWith([source]);
    const model = buildSchoolChancesModel(response, profile, "gpa");

    expect(
      model.gpa?.distribution?.buckets.map((bucket) => bucket.label),
    ).toEqual(["Below 3.50", "3.50 - 3.99", "4.00 and Above"]);
    expect(model.gpa?.distribution?.buckets[2]).toMatchObject({ pct: 0 });
    expect(model.gpa?.distribution?.buckets[0]).toMatchObject({
      absence: "not_reported",
      pct: null,
    });
    expect(model.gpa?.distribution?.sumsTo).toBe(60);
    expect(
      (source.value as { buckets: DistributionBucket[] }).buckets.map(
        (bucket) => bucket.label,
      ),
    ).toEqual(["4.00 and Above", "3.50 - 3.99", "Below 3.50"]);
  });

  test("uses parseable GPA buckets to reverse a high-to-low source without losing unparseable categories", () => {
    const response = factsWith([
      distribution("class_profile.gpa_distribution", "gpa", [
        { label: "4.00 and Above", pct: 20 },
        { label: "School did not publish this category", pct: 10 },
        { label: "3.50 - 3.99", pct: 70 },
      ]),
    ]);

    const model = buildSchoolChancesModel(response, profile, "gpa");

    expect(
      model.gpa?.distribution?.buckets.map((bucket) => bucket.label),
    ).toEqual([
      "3.50 - 3.99",
      "School did not publish this category",
      "4.00 and Above",
    ]);
    expect(model.gpa?.profile.comparison).toEqual({
      state: "unplaceable_profile_value",
      label: null,
    });
  });

  test("treats all-absent buckets as unavailable and preserves endpoint absence words", () => {
    const allAbsent = buildSchoolChancesModel(
      schoolChancesFactFixtures.allAbsent,
      profile,
      "gpa",
    );
    expect(allAbsent.school).toMatchObject({ state: "not_reported" });
    expect(
      allAbsent.gpa?.distribution?.buckets.every(
        (bucket) => bucket.pct === null,
      ),
    ).toBe(true);

    const absent = buildSchoolChancesModel(
      schoolChancesFactFixtures.absenceStates,
      profile,
      "sat",
    );
    expect(absent.sat?.lanes[0]?.school).toEqual({
      state: "not_fetched",
      display: "Not checked",
      reportedPeriod: null,
    });
    expect(absent.sat?.lanes[1]?.school).toEqual({
      state: "not_published",
      display: "Not on file",
      reportedPeriod: null,
    });
  });

  test("requires a numerically explicit 4.0 GPA scale and keeps off-grid precision exact", () => {
    const response = factsWith([
      distribution("class_profile.gpa_distribution", "gpa", [
        { label: "3.75 - 3.99", pct: 100 },
      ]),
    ]);
    for (const scale of ["4", "4.0", "4.00"]) {
      expect(
        buildSchoolChancesModel(
          response,
          { academics: { gpa_unweighted: "3.825", gpa_scale: scale } },
          "gpa",
        ).gpa?.profile,
      ).toMatchObject({ state: "value", display: "3.825", value: 3.825 });
    }
    expect(
      buildSchoolChancesModel(
        response,
        { academics: { gpa_unweighted: "3.82", gpa_scale: "5.0" } },
        "gpa",
      ).gpa?.profile.state,
    ).toBe("incompatible_profile_value");
    expect(
      buildSchoolChancesModel(
        response,
        { academics: { gpa_unweighted: "four", gpa_scale: "4.0" } },
        "gpa",
      ).gpa?.profile.state,
    ).toBe("incompatible_profile_value");
  });

  test("places GPA values with strict Below, inclusive and Above, shared endpoints, and outside states", () => {
    const response = factsWith([
      distribution("class_profile.gpa_distribution", "gpa", [
        { label: "4.00 and Above", pct: 20 },
        { label: "3.50 - 4.00", pct: 40 },
        { label: "Below 3.50", pct: 40 },
      ]),
    ]);
    const compare = (gpa: string) =>
      buildSchoolChancesModel(
        response,
        { academics: { gpa_unweighted: gpa, gpa_scale: "4" } },
        "gpa",
      ).gpa?.profile.comparison;
    expect(compare("3.49")).toMatchObject({
      state: "in_bucket",
      label: "Below 3.50",
    });
    expect(compare("3.50")).toMatchObject({
      state: "in_bucket",
      label: "3.50 - 4.00",
    });
    expect(compare("4.00")).toMatchObject({
      state: "in_bucket",
      label: "4.00 and Above",
    });

    const finite = factsWith([
      distribution("class_profile.gpa_distribution", "gpa", [
        { label: "3.00 - 3.49", pct: 100 },
      ]),
    ]);
    expect(
      buildSchoolChancesModel(
        finite,
        { academics: { gpa_unweighted: "2.9", gpa_scale: "4" } },
        "gpa",
      ).gpa?.profile.comparison.state,
    ).toBe("below_reported_buckets");
    expect(
      buildSchoolChancesModel(
        finite,
        { academics: { gpa_unweighted: "3.6", gpa_scale: "4" } },
        "gpa",
      ).gpa?.profile.comparison.state,
    ).toBe("above_reported_buckets");
  });

  test("refuses GPA placement for ambiguous labels and wider range overlap", () => {
    const ambiguous = factsWith([
      distribution("class_profile.gpa_distribution", "gpa", [
        { label: "Mystery range", pct: 50 },
        { label: "3.50 - 3.99", pct: 50 },
      ]),
    ]);
    expect(
      buildSchoolChancesModel(ambiguous, profile, "gpa").gpa?.profile.comparison
        .state,
    ).toBe("unplaceable_profile_value");

    const overlap = factsWith([
      distribution("class_profile.gpa_distribution", "gpa", [
        { label: "3.00 - 3.80", pct: 50 },
        { label: "3.50 - 4.00", pct: 50 },
      ]),
    ]);
    expect(buildSchoolChancesModel(overlap, profile, "gpa").school.state).toBe(
      "malformed",
    );
  });

  test("rejects out-of-scale GPA closed bounds and dishonest open-label bounds", () => {
    for (const buckets of [
      [{ label: "-0.10 - 3.00", lo: -0.1, hi: 3, pct: 100 }],
      [{ label: "3.00 - 4.10", lo: 3, hi: 4.1, pct: 100 }],
      [{ label: "Below 0.00", pct: 100 }],
      [{ label: "4.10 and Above", pct: 100 }],
    ]) {
      expect(
        buildSchoolChancesModel(
          factsWith([
            distribution("class_profile.gpa_distribution", "gpa", buckets),
          ]),
          profile,
          "gpa",
        ).school.state,
      ).toBe("malformed");
    }
  });

  test("uses any finite numeric average GPA as a text-only fallback and keeps an unusable distribution explicit", () => {
    const average: Fact = {
      key: "class_profile.average_gpa",
      label: "Average GPA",
      tab: "admission",
      state: "value",
      kind: "scalar",
      display: "4.71",
      unit: null,
      value: 4.71,
      observed_at: "2026-01-01T00:00:00Z",
      reported_period: "2024-25",
      caveat_ids: [],
    };
    for (const unusable of [
      distribution("class_profile.gpa_distribution", "wrong_scale", [
        { label: "3.00 - 3.50", pct: 100 },
      ]),
      distribution("class_profile.gpa_distribution", "gpa", [
        { label: "3.00 - 4.50", pct: 100 },
      ]),
    ]) {
      const model = buildSchoolChancesModel(
        factsWith([unusable, average]),
        profile,
        "gpa",
        { gpa: 3.8 },
      );
      expect(model.school).toEqual({
        state: "school_value",
        display: "4.71",
        reportedPeriod: "2024-25",
      });
      expect(model.gpa?.schoolSource).toBe("average_fallback");
      expect(model.gpa?.distributionState).toMatchObject({
        state:
          unusable.value.scale === "wrong_scale"
            ? "distribution_unscaled"
            : "malformed",
        usable: false,
        display: "Reported breakdown",
        reportedPeriod: "2025-26",
      });
      expect(model.gpa?.average).toEqual({
        display: "4.71",
        reportedPeriod: "2024-25",
      });
      expect(model.gpa?.profile.comparison).toBeNull();
      expect(model.gpa?.scenario?.comparison).toBeNull();
    }
    expect(
      buildSchoolChancesModel(factsWith([average]), profile, "gpa").school,
    ).toEqual({
      state: "school_value",
      display: "4.71",
      reportedPeriod: "2024-25",
    });
  });

  test("rejects nonnumeric, nonfinite, or negative average GPA fallbacks", () => {
    for (const value of ["3.7", -0.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      const model = buildSchoolChancesModel(
        factsWith([
          distribution("class_profile.gpa_distribution", "wrong_scale", [
            { label: "3.00 - 3.50", pct: 100 },
          ]),
          {
            key: "class_profile.average_gpa",
            label: "Average GPA",
            tab: "admission",
            state: "value",
            kind: "scalar",
            display: String(value),
            unit: null,
            value,
            observed_at: "2026-01-01T00:00:00Z",
            reported_period: "2024-25",
            caveat_ids: [],
          },
        ]),
        profile,
        "gpa",
      );
      expect(model.school.state).toBe("distribution_unscaled");
      expect(model.gpa?.average).toBeNull();
    }
  });

  test("validates inclusive bands and preserves score sections without synthesizing SAT totals", () => {
    const response = factsWith([
      band("class_profile.sat_math", 700, 760),
      band("class_profile.sat_ebrw", 680, 750),
    ]);
    const model = buildSchoolChancesModel(
      response,
      { testing: { sat: { total: 1500, math: 700, ebrw: 750 } } },
      "sat",
    );
    expect(model.sat?.totalContext).toEqual({ display: 1500, value: 1500 });
    expect(
      model.sat?.lanes.map((lane) => lane.profile.comparison?.state),
    ).toEqual(["within_band", "within_band"]);
    expect(model.sat).not.toHaveProperty("schoolTotalBand");
    expect(model.sat?.lanes).toHaveLength(2);
    expect(
      buildSchoolChancesModel(
        response,
        { testing: { sat: { total: 1500 } } },
        "sat",
      ).sat?.lanes.map((lane) => lane.profile.state),
    ).toEqual(["missing_profile_value", "missing_profile_value"]);
  });

  test("keeps a valid score band and marker when distribution geometry is invalid, with literal fallback", () => {
    const response = factsWith([
      band("class_profile.sat_math", 690, 760),
      distribution("class_profile.sat_math_distribution", "sat_math", [
        { label: "Score of 900 - 950", pct: 100 },
      ]),
    ]);
    const lane = buildSchoolChancesModel(response, profile, "sat").sat
      ?.lanes[0];
    expect(lane?.school.state).toBe("school_value");
    expect(lane?.distributionState).toEqual({
      state: "distribution_unscaled",
      usable: false,
      display: "Reported breakdown",
      reportedPeriod: "2025-26",
    });
    expect(lane?.distribution?.buckets).toEqual([
      expect.objectContaining({ label: "Score of 900 - 950", pct: 100 }),
    ]);
    expect(lane?.band).toMatchObject({ p25: 690, p75: 760 });
    expect(lane?.profile.comparison.state).toBe("within_band");
  });

  test("exports distribution state and usability for every score lane without changing aggregate availability", () => {
    const response = factsWith([
      band("class_profile.sat_math", 690, 760),
      distribution("class_profile.sat_math_distribution", "sat_math", [
        { label: "700 - 800", pct: 100 },
      ]),
      band("class_profile.sat_ebrw", 680, 750),
      distribution("class_profile.sat_ebrw_distribution", "wrong_scale", [
        { label: "700 - 800", pct: 100 },
      ]),
    ]);

    const lanes = buildSchoolChancesModel(response, profile, "sat").sat?.lanes;

    expect(lanes?.map((lane) => lane.school.state)).toEqual([
      "school_value",
      "school_value",
    ]);
    expect(lanes?.map((lane) => lane.distributionState)).toEqual([
      {
        state: "school_value",
        usable: true,
        display: "Reported breakdown",
        reportedPeriod: "2025-26",
      },
      {
        state: "distribution_unscaled",
        usable: false,
        display: "Reported breakdown",
        reportedPeriod: "2025-26",
      },
    ]);
  });

  test("keeps state, display, and period together from the winning score fact across absence combinations", () => {
    const absence = (
      key: string,
      state: Exclude<Fact["state"], "value">,
      display: string,
      reportedPeriod: string | null,
    ): Fact => ({
      key,
      label: key,
      tab: "admission",
      state,
      kind: "scalar",
      display,
      unit: null,
      value: null,
      observed_at: null,
      reported_period: reportedPeriod,
      caveat_ids: [],
    });
    const cases = [
      {
        distribution: absence(
          "class_profile.sat_math_distribution",
          "not_reported",
          "Distribution not reported",
          "2023-24",
        ),
        band: absence(
          "class_profile.sat_math",
          "not_fetched",
          "Band was not checked",
          null,
        ),
        expected: {
          state: "not_fetched",
          display: "Band was not checked",
          reportedPeriod: null,
        },
      },
      {
        distribution: absence(
          "class_profile.sat_math_distribution",
          "not_published",
          "Distribution not on file",
          "2022-23",
        ),
        band: absence(
          "class_profile.sat_math",
          "not_reported",
          "Band not reported",
          "2025-26",
        ),
        expected: {
          state: "not_published",
          display: "Distribution not on file",
          reportedPeriod: "2022-23",
        },
      },
      {
        distribution: absence(
          "class_profile.sat_math_distribution",
          "not_collected",
          "Distribution not collected",
          null,
        ),
        band: absence(
          "class_profile.sat_math",
          "not_reported",
          "Band not reported",
          "2025-26",
        ),
        expected: {
          state: "not_collected",
          display: "Distribution not collected",
          reportedPeriod: null,
        },
      },
      {
        distribution: absence(
          "class_profile.sat_math_distribution",
          "not_reported",
          "Distribution not reported",
          "2022-23",
        ),
        band: absence(
          "class_profile.sat_math",
          "not_published",
          "Band not on file",
          "2024-25",
        ),
        expected: {
          state: "not_published",
          display: "Band not on file",
          reportedPeriod: "2024-25",
        },
      },
    ];
    for (const {
      distribution: distributionFact,
      band: bandFact,
      expected,
    } of cases) {
      expect(
        buildSchoolChancesModel(
          factsWith([distributionFact, bandFact]),
          profile,
          "sat",
        ).sat?.lanes[0]?.school,
      ).toEqual(expected);
    }
  });

  test("parses only finite in-domain SAT and ACT averages while preserving fractional averages", () => {
    const average = (key: string, value: unknown): Fact => ({
      key,
      label: key,
      tab: "admission",
      state: "value",
      kind: "scalar",
      display: String(value),
      unit: null,
      value,
      observed_at: "2026-01-01T00:00:00Z",
      reported_period: "2025-26",
      caveat_ids: [],
    });
    const model = buildSchoolChancesModel(
      factsWith([
        average("class_profile.sat_math_avg", 725.5),
        average("class_profile.sat_ebrw_avg", 715),
      ]),
      profile,
      "sat",
    );
    expect(model.sat?.lanes.map((lane) => lane.average?.value)).toEqual([
      725.5, 715,
    ]);
    expect(
      buildSchoolChancesModel(
        factsWith([average("class_profile.act_composite_avg", 31.25)]),
        profile,
        "act",
      ).act?.average?.value,
    ).toBe(31.25);
    expect(
      buildSchoolChancesModel(
        factsWith([average("class_profile.act_composite_avg", Number.NaN)]),
        profile,
        "act",
      ).act?.average,
    ).toBeNull();
    for (const value of [0, 36.01, Number.POSITIVE_INFINITY, "thirty"]) {
      expect(
        buildSchoolChancesModel(
          factsWith([average("class_profile.act_composite_avg", value)]),
          profile,
          "act",
        ).act?.average,
      ).toBeNull();
    }
    for (const value of [199.9, 800.1, Number.NaN, "715"]) {
      expect(
        buildSchoolChancesModel(
          factsWith([average("class_profile.sat_math_avg", value)]),
          profile,
          "sat",
        ).sat?.lanes[0]?.average,
      ).toBeNull();
    }
  });

  test("adds optional metric-specific scenarios without snapping and compares SAT lanes independently", () => {
    const response = factsWith([
      distribution("class_profile.gpa_distribution", "gpa", [
        { label: "3.50 - 3.99", pct: 100 },
      ]),
      band("class_profile.sat_math", 690, 760),
      band("class_profile.sat_ebrw", 680, 750),
      band("class_profile.act_composite", 30, 34, 1, 36),
    ]);
    const gpa = buildSchoolChancesModel(response, profile, "gpa", {
      gpa: 3.825,
    });
    expect(gpa.gpa?.scenario).toEqual({
      value: 3.825,
      comparison: { state: "in_bucket", label: "3.50 - 3.99" },
    });

    const sat = buildSchoolChancesModel(response, profile, "sat", {
      sat: { math: 760.5 },
    });
    expect(sat.sat?.lanes.map((lane) => lane.scenario)).toEqual([
      { value: 760.5, comparison: { state: "above_band" } },
      null,
    ]);

    const act = buildSchoolChancesModel(response, profile, "act", {
      act: { composite: 30.5 },
    });
    expect(act.act?.scenario).toEqual({
      value: 30.5,
      comparison: { state: "within_band" },
    });
  });

  test("enforces exact fact-bound scale, percent and sums_to validation, and categorical fallback", () => {
    const cases: Fact[] = [
      distribution("class_profile.sat_math_distribution", "sat_ebrw", [
        { label: "700 - 800", pct: 100 },
      ]),
      distribution("class_profile.sat_math_distribution", "sat_math", [
        { label: "700 - 800", pct: 101 },
      ]),
      distribution(
        "class_profile.sat_math_distribution",
        "sat_math",
        [{ label: "700 - 800", pct: 100 }],
        { sums_to: 101 },
      ),
      distribution("class_profile.sat_math_distribution", "sat_math", [
        { label: "700 - 800", pct: Number.NaN },
      ]),
    ];
    for (const fact of cases) {
      expect(
        buildSchoolChancesModel(factsWith([fact]), profile, "sat").sat?.lanes[0]
          ?.school.state,
      ).toBe("distribution_unscaled");
    }
    const unitWrong = distribution(
      "class_profile.sat_math_distribution",
      "sat_math",
      [{ label: "700 - 800", pct: 100 }],
      { unit: "count" },
    );
    expect(
      buildSchoolChancesModel(factsWith([unitWrong]), profile, "sat").sat
        ?.lanes[0]?.school.state,
    ).toBe("distribution_unscaled");
  });

  test("accepts only score label grammars, domains and endpoint-only overlap", () => {
    const validSat = factsWith([
      distribution("class_profile.sat_math_distribution", "sat_math", [
        { label: "Score of 700 - 800", pct: 50 },
        { label: "600–700", pct: 50 },
      ]),
    ]);
    expect(
      buildSchoolChancesModel(validSat, profile, "sat").sat?.lanes[0]?.school
        .state,
    ).toBe("school_value");

    const validAct = factsWith([
      distribution(
        "class_profile.act_composite_distribution",
        "act_composite",
        [
          { label: "Score of 24 or Below", pct: 50 },
          { label: "24 - 36", pct: 50 },
        ],
      ),
    ]);
    expect(
      buildSchoolChancesModel(validAct, profile, "act").act?.school.state,
    ).toBe("school_value");

    for (const buckets of [
      [{ label: "Score of 36 and Above", pct: 100 }],
      [{ label: "Score of 800 - 700", pct: 100 }],
      [
        { label: "Score of 600 - 750", pct: 50 },
        { label: "700 - 800", pct: 50 },
      ],
    ]) {
      expect(
        buildSchoolChancesModel(
          factsWith([
            distribution(
              "class_profile.sat_math_distribution",
              "sat_math",
              buckets,
            ),
          ]),
          profile,
          "sat",
        ).sat?.lanes[0]?.school.state,
      ).toBe("distribution_unscaled");
    }
  });

  test("marks malformed band domains independently and uses ACT composite only", () => {
    const response = factsWith([
      band("class_profile.act_composite", 30, 34, 0, 36),
      distribution(
        "class_profile.act_composite_distribution",
        "act_composite",
        [{ label: "30 - 36", pct: 100 }],
      ),
    ]);
    const act = buildSchoolChancesModel(
      response,
      { testing: { act: { composite: 33, sections: { english: "36" } } } },
      "act",
    ).act;
    expect(act?.band).toBeNull();
    expect(act?.school.state).toBe("school_value");
    expect(act).not.toHaveProperty("sections");
  });

  test("returns new values without mutating frozen inputs", () => {
    const facts = schoolChancesFactFixtures.full;
    const original = facts.sections[0]!.groups[0]!.facts[0]!.value;
    const model = buildSchoolChancesModel(facts, profile, "gpa");
    expect(model.gpa?.distribution).not.toBe(original);
    expect(model.gpa?.distribution?.buckets).not.toBe(
      (original as { buckets: unknown[] }).buckets,
    );
    expect(Object.isFrozen(facts)).toBe(true);
  });
});
