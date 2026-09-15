import { describe, expect, test } from "vitest";

import {
  ACCEPTED_DISTRIBUTION_SCALES,
  CHANCES_FACT_KEYS,
  CHANCES_PROFILE_PATHS,
  CHANCES_SLIDER_SELECTION,
  hasAcceptedDistributionScale,
  isChancesFactKey,
} from "./school-chances-contract";
import {
  schoolChancesFactFixtures,
  schoolChancesProfileFixtures,
} from "./school-chances-fixtures";

function factsInFixture(name: keyof typeof schoolChancesFactFixtures) {
  return schoolChancesFactFixtures[name].sections.flatMap((section) =>
    section.groups.flatMap((group) => group.facts),
  );
}

describe("school chances Phase-0 contract", () => {
  test("locks the complete fact and Profile allowlists before model work", () => {
    expect(CHANCES_FACT_KEYS).toEqual([
      "class_profile.gpa_distribution",
      "class_profile.average_gpa",
      "class_profile.sat_math",
      "class_profile.sat_math_avg",
      "class_profile.sat_math_distribution",
      "class_profile.sat_ebrw",
      "class_profile.sat_ebrw_avg",
      "class_profile.sat_ebrw_distribution",
      "class_profile.act_composite",
      "class_profile.act_composite_avg",
      "class_profile.act_composite_distribution",
      "admissions.test_policy_sat_or_act",
    ]);
    expect(CHANCES_PROFILE_PATHS).toEqual([
      "academics.gpa_unweighted",
      "academics.gpa_scale",
      "testing.sat.total",
      "testing.sat.math",
      "testing.sat.ebrw",
      "testing.act.composite",
    ]);
    expect(new Set(factsInFixture("full").map((fact) => fact.key))).toEqual(
      new Set(CHANCES_FACT_KEYS),
    );
    expect(isChancesFactKey("activities.hours")).toBe(false);
  });

  test("records the plan-mandated registry decision without adding a Slider early", () => {
    expect(CHANCES_SLIDER_SELECTION).toEqual({
      registry: "@coss",
      item: "@coss/slider",
      fallback: "@shadcn/slider",
    });
  });

  test("accepts only fact-key-bound scale strings evidenced by the current contract", () => {
    const full = factsInFixture("full");
    for (const fact of full.filter((fact) => fact.kind === "distribution")) {
      expect(hasAcceptedDistributionScale(fact)).toBe(true);
    }

    const sourceFacingSatMath = full.find(
      (fact) => fact.key === "class_profile.sat_math_distribution",
    );
    expect(sourceFacingSatMath).toBeDefined();
    expect(
      hasAcceptedDistributionScale({
        ...sourceFacingSatMath!,
        value: {
          ...(sourceFacingSatMath!.value as object),
          scale: "SAT Math score",
        },
      }),
    ).toBe(true);

    /* No extrapolated source-facing EBRW/ACT spellings: no evidence, no plot. */
    expect(hasAcceptedDistributionScale(factsInFixture("malformed")[0]!)).toBe(
      false,
    );
    expect(hasAcceptedDistributionScale({ key: "toString", value: {} })).toBe(
      false,
    );
    const distributionKeys = Object.keys(ACCEPTED_DISTRIBUTION_SCALES) as Array<
      keyof typeof ACCEPTED_DISTRIBUTION_SCALES
    >;
    for (const key of distributionKeys) {
      for (const scale of ACCEPTED_DISTRIBUTION_SCALES[key]) {
        for (const wrongKey of distributionKeys.filter(
          (candidate) => candidate !== key,
        )) {
          expect(
            hasAcceptedDistributionScale({
              key: wrongKey,
              value: {
                scale,
                buckets: [],
                omitted_buckets: [],
                sums_to: null,
              },
            }),
          ).toBe(false);
        }
      }
    }
    expect(ACCEPTED_DISTRIBUTION_SCALES).toEqual({
      "class_profile.gpa_distribution": ["gpa"],
      "class_profile.sat_math_distribution": ["sat_math", "SAT Math score"],
      "class_profile.sat_ebrw_distribution": ["sat_ebrw"],
      "class_profile.act_composite_distribution": ["act_composite"],
    });
  });

  test("keeps the representative fact/Profile state matrix deeply immutable", () => {
    const full = schoolChancesFactFixtures.full;
    expect(Object.isFrozen(full)).toBe(true);
    expect(Object.isFrozen(CHANCES_FACT_KEYS)).toBe(true);
    expect(Object.isFrozen(CHANCES_PROFILE_PATHS)).toBe(true);
    expect(Object.isFrozen(CHANCES_SLIDER_SELECTION)).toBe(true);
    expect(Object.isFrozen(ACCEPTED_DISTRIBUTION_SCALES)).toBe(true);
    for (const scales of Object.values(ACCEPTED_DISTRIBUTION_SCALES)) {
      expect(Object.isFrozen(scales)).toBe(true);
    }
    expect(Object.isFrozen(full.sections)).toBe(true);
    expect(Object.isFrozen(full.sections[0]!.groups[0]!.facts)).toBe(true);
    expect(Object.isFrozen(schoolChancesProfileFixtures.compatible)).toBe(true);
    expect(
      Object.isFrozen(schoolChancesProfileFixtures.compatible.academics),
    ).toBe(true);
    expect(
      schoolChancesFactFixtures.partial.sections[0]!.groups[0]!.facts[0]!.value,
    ).toMatchObject({
      sums_to: 60,
      omitted_buckets: [{ label: "3.50 - 3.74", display: "Not reported" }],
    });
    expect(
      schoolChancesFactFixtures.allAbsent.sections[0]!.groups[0]!.facts[0]!
        .value,
    ).toMatchObject({
      sums_to: null,
    });
    expect(schoolChancesFactFixtures.stale.freshness_line).toBe(
      "Last checked January 2025 — this may be out of date",
    );
    expect(schoolChancesFactFixtures.noCrawl.has_collegedata).toBe(false);
    expect(
      schoolChancesFactFixtures.absenceStates.sections[0]!.groups[0]!.facts.map(
        (fact) => [fact.state, fact.display, fact.value],
      ),
    ).toEqual([
      ["not_reported", "Not reported", null],
      ["not_fetched", "Not checked", null],
      ["not_published", "Not on file", null],
      ["not_collected", "Not collected", null],
    ]);
    expect(schoolChancesProfileFixtures).toMatchObject({
      missingRow: null,
      requestFailure: { message: "Could not load your profile." },
    });
  });
});
