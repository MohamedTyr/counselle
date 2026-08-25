import type {
  ExploreSchool,
  FitCategory,
  FitVerdict,
  StudentProfile,
} from "@/features/schools/explore/explore-types";

/*
 * The verdict is a CLASSIFICATION, never a probability. METRICS-KEEP.md
 * licenses the categorical form precisely because the chancing consumer
 * "classifies risk, it never emits a fake probability" — so this returns a
 * word plus the evidence it rests on, and the card renders the observed
 * admit rate larger than the word.
 *
 * Two rules make it honest:
 *
 *  1. No admit rate published -> "Unknown". We do not fall back to the test
 *     band alone and call it a Target; absence of evidence is reported as
 *     absence, not smoothed over.
 *  2. A test band whose submitted share is under 50% describes the top
 *     third of the class (trap 1), so it is not allowed to move the
 *     verdict. The category degrades to admit-rate-only and `usedScore`
 *     stays false, which is what the card's caveat ladder keys off.
 */

/** Admit-rate cut points. Below the first is a Reach, below the second a
 *  Target, above it a Safety. Round numbers on purpose: these are a coarse
 *  risk band, and pretending to a finer resolution than the input supports
 *  is the failure mode this whole module exists to avoid. */
const REACH_MAX_ADMIT_RATE = 20;
const TARGET_MAX_ADMIT_RATE = 50;

/** Below this share of submitters the band is not evidence about the whole
 *  class, so it may not move the verdict. */
const TRUSTED_SUBMITTED_PERCENT = 50;

const LADDER: readonly FitCategory[] = ["Reach", "Target", "Safety"];

function categoryFromAdmitRate(admitRate: number): FitCategory {
  if (admitRate < REACH_MAX_ADMIT_RATE) {
    return "Reach";
  }

  if (admitRate < TARGET_MAX_ADMIT_RATE) {
    return "Target";
  }

  return "Safety";
}

/** Move one rung along Reach -> Target -> Safety, clamped at both ends. */
function shift(category: FitCategory, steps: number): FitCategory {
  const index = LADDER.indexOf(category);

  if (index === -1) {
    return category;
  }

  return LADDER[Math.min(LADDER.length - 1, Math.max(0, index + steps))];
}

function formatRate(value: number) {
  return `${value % 1 === 0 ? value : value.toFixed(1)}%`;
}

export function classifyFit(
  school: ExploreSchool,
  profile: StudentProfile,
): FitVerdict {
  const { admitRate, testBand } = school;

  if (!admitRate) {
    return {
      category: "Unknown",
      reason: "No admit rate published, so this is not classified.",
      usedScore: false,
    };
  }

  const base = categoryFromAdmitRate(admitRate.value);
  const rate = formatRate(admitRate.value);
  const basis = admitRate.basis === "overall" ? "" : ` (${admitRate.basis})`;
  const bandIsTrusted =
    testBand !== null &&
    testBand.submittedPercent !== null &&
    testBand.submittedPercent >= TRUSTED_SUBMITTED_PERCENT;

  if (!bandIsTrusted || profile.satScore === null || testBand === null) {
    return {
      category: base,
      reason: `${rate} admit rate${basis}.`,
      usedScore: false,
    };
  }

  if (profile.satScore >= testBand.p75) {
    return {
      category: shift(base, 1),
      reason: `${rate} admit rate${basis}, and your ${profile.satScore} is at or above the 75th percentile.`,
      usedScore: true,
    };
  }

  if (profile.satScore < testBand.p25) {
    return {
      category: shift(base, -1),
      reason: `${rate} admit rate${basis}, and your ${profile.satScore} is below the 25th percentile.`,
      usedScore: true,
    };
  }

  return {
    category: base,
    reason: `${rate} admit rate${basis}, and your ${profile.satScore} is inside the middle 50%.`,
    usedScore: true,
  };
}

export type CaveatSeverity = "none" | "mild" | "severe";

/**
 * The caveat ladder. Severity is carried by POSITION on the card, not by a
 * second colour — an amber chip on an amber band is invisible, and colour
 * alone fails for colourblind users. Severe caveats get promoted out of the
 * tinted band onto the card's white surface, where --warning-fg reads
 * correctly and where they change the card's shape.
 */
export function caveatSeverity(school: ExploreSchool): CaveatSeverity {
  const submitted = school.testBand?.submittedPercent;

  if (submitted === undefined || submitted === null) {
    return "none";
  }

  if (submitted < TRUSTED_SUBMITTED_PERCENT) {
    return "severe";
  }

  return submitted <= 80 ? "mild" : "none";
}
