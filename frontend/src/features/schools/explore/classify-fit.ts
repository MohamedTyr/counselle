import type { FitVerdict } from "@/features/schools/explore/explore-types";

/*
 * The verdict is a CLASSIFICATION, never a probability, and it rests on the
 * admit rate alone. It used to also shift one rung on the student's own
 * score against the test band -- but that shift was licensed only when the
 * band's `submittedPercent` cleared a trust threshold, and `submitted_percent`
 * has no source under v3 (plan §5.3: "Band trust (honesty)"). Reintroducing
 * a score-based shift without that trust check would move a school from
 * Reach to Target on a band that might describe the top third of the class
 * rather than the whole one -- so the shift logic is deleted, not disabled.
 *
 * No admit rate published -> "Unknown". We do not fall back to the test
 * band alone and call it a Target; absence of evidence is reported as
 * absence, not smoothed over.
 */

/** Admit-rate cut points. Below the first is a Reach, below the second a
 *  Target, above it a Safety. Round numbers on purpose: these are a coarse
 *  risk band, and pretending to a finer resolution than the input supports
 *  is the failure mode this whole module exists to avoid. */
const REACH_MAX_ADMIT_RATE = 20;
const TARGET_MAX_ADMIT_RATE = 50;

function formatRate(value: number) {
  return `${value % 1 === 0 ? value : value.toFixed(1)}%`;
}

export function classifyFit(admitRate: number | null): FitVerdict {
  if (admitRate === null) {
    return {
      category: "Unknown",
      reason: "No admit rate published, so this is not classified.",
    };
  }

  const rate = formatRate(admitRate);

  if (admitRate < REACH_MAX_ADMIT_RATE) {
    return { category: "Reach", reason: `${rate} admit rate.` };
  }

  if (admitRate < TARGET_MAX_ADMIT_RATE) {
    return { category: "Target", reason: `${rate} admit rate.` };
  }

  return { category: "Safety", reason: `${rate} admit rate.` };
}
