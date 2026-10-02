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

/** Test-day pace: the digital SAT gives 134 minutes for 98 questions (two
 * 32-minute, 27-question Reading and Writing modules, two 35-minute,
 * 22-question Math modules) — about 82 seconds each. The matrix draws this
 * line when it is within the plotted range, and always labels it. */
export const PACE_TARGET_SECONDS = 82;

/** Fewest measured axes for which a filled web means anything. */
export const MIN_WEB_AXES = 3;

/** Fills each no-data axis with the radius at which the straight edge
 * between its nearest plotted neighbours crosses that axis, so the web
 * simply skips the vertex instead of dipping to 0%. A gap with no such edge
 * (fewer than two plotted axes, or neighbours half a turn or more apart)
 * stays `null`: the web is never given a made-up radius there. */
export function skipMissingVertices(values: readonly (number | null)[]): (number | null)[] {
  const count = values.length;
  const step = (Math.PI * 2) / count;
  const plotted = values.filter((value) => value !== null).length;
  return values.map((value, index) => {
    if (value !== null) return value;
    if (plotted < 2) return null;
    let back = 1;
    while (values[(index - back + count) % count] === null) back += 1;
    let forward = 1;
    while (values[(index + forward) % count] === null) forward += 1;
    const r1 = values[(index - back + count) % count] ?? 0;
    const r2 = values[(index + forward) % count] ?? 0;
    const a1 = back * step;
    const a2 = forward * step;
    if (a1 + a2 >= Math.PI) return null;
    const denominator = r1 * Math.sin(a2) + r2 * Math.sin(a1);
    return denominator === 0 ? null : (r1 * r2 * Math.sin(a1 + a2)) / denominator;
  });
}

/** A web is drawn only when enough axes are measured and every gap lies on
 * an honest edge; otherwise the chart shows the measured points alone. */
export function canDrawWeb(plotted: readonly (number | null)[], measuredCount: number): boolean {
  return measuredCount >= MIN_WEB_AXES && plotted.every((value) => value !== null);
}

// ---- chart-summary helpers (sentences behind ChartFigure's `summary`) -----

export interface DomainRadarInput {
  readonly name: string;
  readonly firstTryAccuracyPct: number;
  readonly hasData: boolean;
}

/** The radar chart's `ChartFigure summary` (S15: an axis with no data is
 * named as such, never as a measured 0%). */
export function summarizeRadar(domains: readonly DomainRadarInput[]): string {
  const sentences = domains.map((domain) =>
    domain.hasData
      ? `${domain.name}: ${domain.firstTryAccuracyPct}% first try.`
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
      ? `Band ${band.band}: ${band.accuracyPct}% accuracy (all attempts), ${formatDuration(band.avgTimeSeconds)} average pace, ${plural(band.attempted, "attempt")}.`
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
