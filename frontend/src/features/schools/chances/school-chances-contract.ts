import type {
  DistributionValue,
  Fact,
} from "@/features/schools/facts/school-facts-types";

/*
 * Phase-0 facts contract for the academic-comparison surface.
 *
 * The fact key is the primary discriminator. `DistributionValue.scale` is
 * producer payload, not a canonical frontend enum: the checked-in facts
 * response fixture proves that SAT Math can arrive as "SAT Math score", even
 * though the current mapper rule emits `sat_math`. Accepting a scale without
 * its matching fact key would make a malformed or misrouted distribution look
 * safe to plot, so this table is deliberately key-bound and closed.
 *
 * Evidence available at this lock:
 * - `config/assets/facts_keys.yaml` + `app/facts/mapper_handlers.py` emit the
 *   canonical strings for all four distribution rules.
 * - `FactDistributionChart.test.tsx` is the current response-shaped fixture
 *   proving the source-facing "SAT Math score" spelling.
 * - A read-only local API check was unavailable (no server on :8000).
 *
 * Do not infer equivalent source-facing spellings for EBRW or ACT. Until a
 * response fixture or live read proves one, an unlisted spelling is unsafe and
 * the later model must return `distribution_unscaled` while retaining an
 * independently valid band.
 */
export const CHANCES_FACT_KEYS = Object.freeze([
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
] as const);

export type ChancesFactKey = (typeof CHANCES_FACT_KEYS)[number];

export const CHANCES_PROFILE_PATHS = Object.freeze([
  "academics.gpa_unweighted",
  "academics.gpa_scale",
  "testing.sat.total",
  "testing.sat.math",
  "testing.sat.ebrw",
  "testing.act.composite",
] as const);

/*
 * Registry search, in the plan-required order, on 2026-09-15:
 * 1. shadcn MCP: no `shadcn` namespace resolved for "slider".
 * 2. COSS: `@coss/slider` is a registry:ui primitive.
 * 3. @ai-elements: no Slider result.
 * 4. shadcn CLI: `@shadcn/slider` exists as a fallback.
 *
 * Phase 2 should add this COSS primitive, not a hand-rolled drag control. Its
 * inspected source already uses this app's `@base-ui/react` foundation and
 * `data-slot`/`cn()` conventions; adapt its tokens and pointer rules then.
 */
export const CHANCES_SLIDER_SELECTION = Object.freeze({
  registry: "@coss",
  item: "@coss/slider",
  fallback: "@shadcn/slider",
} as const);

export const ACCEPTED_DISTRIBUTION_SCALES = Object.freeze({
  "class_profile.gpa_distribution": Object.freeze(["gpa"] as const),
  "class_profile.sat_math_distribution": Object.freeze(
    ["sat_math", "SAT Math score"] as const,
  ),
  "class_profile.sat_ebrw_distribution": Object.freeze(["sat_ebrw"] as const),
  "class_profile.act_composite_distribution": Object.freeze(
    ["act_composite"] as const,
  ),
} as const);

export type ChancesDistributionFactKey =
  keyof typeof ACCEPTED_DISTRIBUTION_SCALES;

export function isChancesFactKey(key: string): key is ChancesFactKey {
  return (CHANCES_FACT_KEYS as readonly string[]).includes(key);
}

/**
 * The model must call this before assigning numeric geometry to a
 * distribution. This intentionally does not validate unit, buckets, or
 * ranges; those are Phase-1 model responsibilities.
 */
export function hasAcceptedDistributionScale(
  fact: Pick<Fact, "key" | "value">,
): fact is Pick<Fact, "key"> & {
  key: ChancesDistributionFactKey;
  value: DistributionValue;
} {
  if (!Object.hasOwn(ACCEPTED_DISTRIBUTION_SCALES, fact.key)) return false;
  if (!isDistributionValue(fact.value)) return false;
  return (
    ACCEPTED_DISTRIBUTION_SCALES[
      fact.key as ChancesDistributionFactKey
    ] as readonly string[]
  ).includes(fact.value.scale);
}

function isDistributionValue(value: unknown): value is DistributionValue {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as DistributionValue).scale === "string" &&
    Array.isArray((value as DistributionValue).buckets) &&
    Array.isArray((value as DistributionValue).omitted_buckets)
  );
}
