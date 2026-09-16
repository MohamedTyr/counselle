import { scoreDomain } from "./academic-comparison-geometry";
import type { ScoreLaneModel } from "./school-chances-model";

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
