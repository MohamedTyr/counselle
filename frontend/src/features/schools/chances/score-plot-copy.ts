import { scoreDomain } from "./academic-comparison-geometry";
import type { ScoreLaneModel } from "./school-chances-model";

export function partialDistributionCaveat(lane: ScoreLaneModel): string | null {
  const sumsTo = lane.distribution?.sumsTo;
  return sumsTo !== null && sumsTo !== undefined && Math.abs(sumsTo - 100) > 0.5
    ? `Reported buckets total ${sumsTo}%; missing buckets are not treated as zero.`
    : null;
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
