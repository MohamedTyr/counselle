/** Chart constants, and pure chart-summary helpers for
 * SAT analytics (plan §5.2; ui-spec §5, §7; parity S13–S16). No components,
 * no Recharts import — this module only computes numbers and sentences.
 *
 * Field names below mirror `app/sat/models.py`'s `SatStatsResponse` (the
 * camelCase wire shape liprep's own analytics screens use) so a future
 * `api/sat/types.ts` can be dropped in as the real input type without a
 * rename; this module defines its own minimal structural types rather than
 * importing that (not yet built) file, per ADR 0017's pure/no-cross-feature
 * boundary for a leaf utility module. */

// ---- display helpers -------------------------------------------------------

/** "1 attempt", "2 attempts", "0 attempts" — regular plurals only. */
export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

/** A length of time for analytics copy: "8s", "1m 8s", "2h 5m". Whole
 * seconds only; never the "0m 8s" a minutes-first format produces. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < SECONDS_PER_MINUTE) {
    return `${seconds}s`;
  }
  if (seconds < SECONDS_PER_HOUR) {
    return `${Math.floor(seconds / SECONDS_PER_MINUTE)}m ${seconds % SECONDS_PER_MINUTE}s`;
  }
  const minutes = Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  return `${Math.floor(seconds / SECONDS_PER_HOUR)}h ${minutes}m`;
}

// ---- pace matrix (S13) ----------------------------------------------------

export const PACE_MATRIX_MIN_SECONDS = 15;
export const PACE_MATRIX_MAX_SECONDS = 130;
export const PACE_MATRIX_ACCURACY_SPLIT_PCT = 50;
/** Test-day pace: the digital SAT gives 134 minutes for 98 questions (two
 * 32-minute, 27-question Reading and Writing modules, two 35-minute,
 * 22-question Math modules) — about 82 seconds each. The matrix splits
 * fast from slow here, and labels the line so it is never an unexplained
 * midpoint. */
export const PACE_TARGET_SECONDS = 82;

export function clampPaceSeconds(seconds: number): number {
  return Math.min(PACE_MATRIX_MAX_SECONDS, Math.max(PACE_MATRIX_MIN_SECONDS, seconds));
}

export type PaceQuadrant = "fastAccurate" | "fastInaccurate" | "slowAccurate" | "slowInaccurate";

/** Which quadrant a skill's pace/accuracy point falls in, split at 50%
 * accuracy and the test-day pace (S13). */
export function paceQuadrant(avgSeconds: number, accuracyPct: number): PaceQuadrant {
  const fast = clampPaceSeconds(avgSeconds) < PACE_TARGET_SECONDS;
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
      `${skill.name}: ${skill.accuracyPct}% first-try accuracy, ${formatDuration(skill.avgTimeSeconds)} average pace, ${plural(skill.attempted, "attempt")}.`,
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
      ? `Band ${band.band}: ${band.accuracyPct}% accuracy, ${formatDuration(band.avgTimeSeconds)} average pace, ${plural(band.attempted, "attempt")}.`
      : `Band ${band.band}: no attempts.`,
  );
  return sentences.join(" ");
}

export interface DonutInput {
  readonly neverMissed: number;
  readonly upsolved: number;
  readonly unsolved: number;
}

/** The standing bar's `ChartFigure summary`. `unsolved` counts questions
 * whose *latest* attempt was wrong (S4) — including ones answered right the
 * first time and missed since, so it is never worded as "never solved". */
export function summarizeDonut(donut: DonutInput): string {
  const attempted = donut.neverMissed + donut.upsolved + donut.unsolved;
  return `${plural(attempted, "question")} attempted. By latest attempt: ${donut.neverMissed} right every time, ${donut.upsolved} missed then got right, ${donut.unsolved} wrong on the latest attempt.`;
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
