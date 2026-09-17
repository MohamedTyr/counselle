import { scoreDomain } from "./academic-comparison-geometry";
import type { ChancesMetric, ScoreLaneModel } from "./school-chances-model";

/** The one locally-authored word for "this value has nothing to show" — used
 * wherever no server-owned absence wording applies. A field with genuine
 * server text (`display`) always uses that instead; this is the fallback of
 * last resort, so it must read the same everywhere it appears (review fix
 * round 2, FIX 2). */
export const NOT_AVAILABLE = "Not available";

/** Below this magnitude of deviation from 100%, the caveat stays in the
 * accessible summary only — a 99.4% total doesn't need a sentence on screen
 * (plan §6, owner decision: inline only when |sum - 100| > 5). */
export const SUMS_TO_INLINE_THRESHOLD = 5;

export function isSumsToMaterial(sumsTo: number | null | undefined): boolean {
  return (
    sumsTo !== null &&
    sumsTo !== undefined &&
    Math.abs(sumsTo - 100) > SUMS_TO_INLINE_THRESHOLD
  );
}

/** Unconditional — the accessible summary states this whenever a sums-to
 * value is reported at all, regardless of how material the gap is. */
export function partialDistributionSummaryText(
  sumsTo: number | null | undefined,
): string | null {
  if (sumsTo === null || sumsTo === undefined) return null;
  return `Reported buckets total ${sumsTo}%; missing buckets are not treated as zero.`;
}

export function schoolFactDisplay(
  lane: ScoreLaneModel,
  fallback: string,
): string {
  return lane.school.display ?? lane.distributionState.display ?? fallback;
}

export function profilePlacementMessage(lane: ScoreLaneModel): string | null {
  const label =
    lane.key === "composite"
      ? "ACT composite"
      : lane.key === "ebrw"
        ? "SAT Reading and Writing score"
        : "SAT Math score";
  if (lane.profile.state === "missing_profile_value")
    return `Add your ${label} to place yourself on this chart.`;
  if (lane.profile.state === "incompatible_profile_value")
    return `Your ${label} cannot be placed on this ${scoreDomain(lane).min}–${scoreDomain(lane).max} chart.`;
  return null;
}

/**
 * True when the verdict sentence (`school-chances-copy.ts`'s
 * `metricInterpretation`) already states this lane's own absence — missing
 * or incompatible — so `AcademicComparisonPlot`'s own visible caption
 * (`profilePlacementMessage`, above) would be a second, redundant
 * statement of the same fact — school-chances-minimal-redesign §0's
 * "stated four times in two vocabularies" defect, reopened first by the SAT
 * verdict fix (missing values) and again by the whole-plan close-out review
 * (incompatible values: a GPA saved on another scale, or a score outside
 * its instrument's own domain, was stated once by the verdict and again,
 * in different wording, by this caption). Mirrors `gpaInterpretation` /
 * `scoreInterpretation` / `satVerdict`'s own branching exactly rather than
 * inventing a separate rule:
 *
 * - ACT is a single-lane metric, so `scoreInterpretation` states a missing
 *   OR incompatible composite's absence unconditionally — always covered
 *   for either state.
 * - SAT states a lane's *missing* absence only inside `satVerdict`'s
 *   both-missing branch, and only for whichever lane(s) are actually being
 *   scrubbed (`scoreInterpretation`/`bothScoreScenarioInterpretation`'s
 *   hypothetical-plus-absence sentence) — a missing, un-scrubbed lane next
 *   to a saved sibling, or both lanes missing with neither scrubbed, get no
 *   per-lane mention there, so the caption must keep stating it. SAT's
 *   *incompatible* case is left uncovered here on purpose: an incompatible
 *   lane can never carry a scenario (the plot is non-interactive for it),
 *   so determining whether `satVerdict`'s value-only fallback would ever
 *   restate a given lane's incompatible text requires the sibling lane's
 *   own resolved `profile.state` — data this file's caller
 *   (`AcademicComparisonPlot.tsx`) does not have without a new prop across
 *   the do-not-touch `SatComparison.tsx` boundary. Left as caption-only
 *   (stated once, never zero) rather than risk an approximation.
 *
 * The accessible summary's own `profilePlacementMessage` fallback (used by
 * `scoreSummary` when nothing is plotted) is untouched by this — only the
 * visible caption's render site checks this flag.
 */
export function absenceCoveredByVerdict(
  metric: ChancesMetric,
  lane: ScoreLaneModel,
  siblingMissing: boolean,
): boolean {
  if (lane.profile.state === "value") return false;
  if (metric === "act") return true;
  if (metric !== "sat") return false;
  if (lane.profile.state !== "missing_profile_value") return false;
  return siblingMissing && lane.scenario !== null;
}
