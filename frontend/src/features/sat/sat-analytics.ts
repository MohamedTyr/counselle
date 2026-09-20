/** Mastery thresholds, chart constants, and pure chart-summary helpers for
 * SAT analytics (plan §5.2; ui-spec §5, §7; parity S13–S16). No components,
 * no Recharts import — this module only computes numbers and sentences.
 *
 * Field names below mirror `app/sat/models.py`'s `SatStatsResponse` (the
 * camelCase wire shape liprep's own analytics screens use) so a future
 * `api/sat/types.ts` can be dropped in as the real input type without a
 * rename; this module defines its own minimal structural types rather than
 * importing that (not yet built) file, per ADR 0017's pure/no-cross-feature
 * boundary for a leaf utility module. */

// ---- mastery (S16) --------------------------------------------------------

export type MasteryLevel = "mastered" | "developing" | "needsFocus" | "untested";

const MASTERED_THRESHOLD = 80;
const DEVELOPING_THRESHOLD = 50;

/** Mastery chip thresholds on first-try accuracy (S16): >= 80 Mastered,
 * >= 50 Developing, else Needs focus — Untested when the skill has no
 * unique questions attempted at all, regardless of the accuracy figure. */
export function masteryLevel(firstTryAccuracyPct: number, uniqueQuestions: number): MasteryLevel {
  if (uniqueQuestions <= 0) {
    return "untested";
  }
  if (firstTryAccuracyPct >= MASTERED_THRESHOLD) {
    return "mastered";
  }
  if (firstTryAccuracyPct >= DEVELOPING_THRESHOLD) {
    return "developing";
  }
  return "needsFocus";
}

// ---- pace matrix (S13) ----------------------------------------------------

export const PACE_MATRIX_MIN_SECONDS = 15;
export const PACE_MATRIX_MAX_SECONDS = 130;
export const PACE_MATRIX_ACCURACY_SPLIT_PCT = 50;
/** The unlabelled-upstream midpoint of the [15, 130] clamp, now labelled on
 * the axis per ui-spec §7. */
export const PACE_MATRIX_SECONDS_SPLIT =
  (PACE_MATRIX_MIN_SECONDS + PACE_MATRIX_MAX_SECONDS) / 2;

const PACE_DOT_MIN_RADIUS = 6;
const PACE_DOT_MAX_RADIUS = 14;
const PACE_DOT_BASE_RADIUS = 5;
const PACE_DOT_PER_ATTEMPT_RADIUS = 1.5;

export function clampPaceSeconds(seconds: number): number {
  return Math.min(PACE_MATRIX_MAX_SECONDS, Math.max(PACE_MATRIX_MIN_SECONDS, seconds));
}

/** Pace-matrix dot radius: `max(6, min(14, 5 + 1.5 × attempts))` (S13). */
export function paceDotRadius(attempts: number): number {
  return Math.max(
    PACE_DOT_MIN_RADIUS,
    Math.min(PACE_DOT_MAX_RADIUS, PACE_DOT_BASE_RADIUS + PACE_DOT_PER_ATTEMPT_RADIUS * attempts),
  );
}

export type PaceQuadrant = "fastAccurate" | "fastInaccurate" | "slowAccurate" | "slowInaccurate";

/** Which quadrant a skill's pace/accuracy point falls in, split at 50%
 * accuracy and the clamp's midpoint (S13). */
export function paceQuadrant(avgSeconds: number, accuracyPct: number): PaceQuadrant {
  const fast = clampPaceSeconds(avgSeconds) < PACE_MATRIX_SECONDS_SPLIT;
  const accurate = accuracyPct >= PACE_MATRIX_ACCURACY_SPLIT_PCT;
  if (fast) {
    return accurate ? "fastAccurate" : "fastInaccurate";
  }
  return accurate ? "slowAccurate" : "slowInaccurate";
}

// ---- score bands (S14) -----------------------------------------------------

/** Score-band pace-line clamp: 140s ceiling, no floor (S14). */
export const SCORE_BAND_PACE_CLAMP_SECONDS = 140;

export function clampScoreBandPace(seconds: number): number {
  return Math.min(SCORE_BAND_PACE_CLAMP_SECONDS, Math.max(0, seconds));
}

// ---- radar (S15) ------------------------------------------------------------

/** An axis with no data plots at this floor ratio, labelled "no data"
 * rather than read as a measured low score (S15 honesty fix). */
export const RADAR_NO_DATA_FLOOR_RATIO = 0.05;

export function radarAxisRatio(pct: number, hasData: boolean): number {
  return hasData ? Math.max(0, Math.min(100, pct)) / 100 : RADAR_NO_DATA_FLOOR_RATIO;
}

// ---- chart-summary helpers (sentences behind ChartFigure's `summary`) -----

export interface SkillPaceInput {
  readonly code: string;
  readonly name: string;
  readonly accuracyPct: number;
  readonly avgTimeSeconds: number;
  readonly attempted: number;
}

/** The pace matrix's `ChartFigure summary`: one sentence per plotted skill,
 * so the chart's data is fully present as text (ui-spec §7). */
export function summarizePaceMatrix(skills: readonly SkillPaceInput[]): string {
  if (skills.length === 0) {
    return "No skills have enough attempts to plot yet.";
  }
  const sentences = skills.map(
    (skill) =>
      `${skill.name}: ${skill.accuracyPct}% first-try accuracy, ${skill.avgTimeSeconds}s average pace, ${skill.attempted} attempts.`,
  );
  return sentences.join(" ");
}

export interface DomainRadarInput {
  readonly name: string;
  readonly firstTryAccuracyPct: number;
  readonly hasData: boolean;
}

/** The radar chart's `ChartFigure summary` (S15: an axis with no data is
 * named as such, never as a measured 0–5%). */
export function summarizeRadar(domains: readonly DomainRadarInput[]): string {
  const sentences = domains.map((domain) =>
    domain.hasData
      ? `${domain.name}: ${domain.firstTryAccuracyPct}% first-try accuracy.`
      : `${domain.name}: no data.`,
  );
  return sentences.join(" ");
}

export interface ScoreBandInput {
  readonly band: number;
  readonly accuracyPct: number;
  readonly avgTimeSeconds: number;
  readonly attempted: number;
}

/** The score-bands chart's `ChartFigure summary`; a band with no attempts
 * reads as such rather than a 0% bar and a 0s pace point (S14 honesty
 * fix). */
export function summarizeScoreBands(bands: readonly ScoreBandInput[]): string {
  const sentences = bands.map((band) =>
    band.attempted > 0
      ? `Band ${band.band}: ${band.accuracyPct}% accuracy, ${band.avgTimeSeconds}s average pace, ${band.attempted} attempts.`
      : `Band ${band.band}: no attempts.`,
  );
  return sentences.join(" ");
}

export interface DonutInput {
  readonly neverMissed: number;
  readonly upsolved: number;
  readonly unsolved: number;
}

/** The mastery donut's `ChartFigure summary`. */
export function summarizeDonut(donut: DonutInput): string {
  const attempted = donut.neverMissed + donut.upsolved + donut.unsolved;
  return `${attempted} questions attempted: ${donut.neverMissed} correct and never missed, ${donut.upsolved} upsolved, ${donut.unsolved} still unsolved.`;
}

// ---- skill ranking (S9 read-through, for "Skills to reinforce") ----------

export interface SkillRankingInput {
  readonly code: string;
  readonly name: string;
  readonly accuracyPct: number;
  readonly attempted: number;
}

/** "Skills to reinforce" is hidden when no skill has any attempt data at
 * all (A5). */
export function hasSkillData(weakest: readonly SkillRankingInput[]): boolean {
  return weakest.length > 0;
}
