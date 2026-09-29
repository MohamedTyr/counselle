/** Where on the 0..1 chance scale the curve, the dot and the hero figure
 * turn amber, then green. One pair of thresholds, so the line's gradient and
 * every level-coloured mark change at the same chance. */
export const RAMP_MID_AT = 0.2;
export const RAMP_HIGH_AT = 0.5;

export type ChanceLevel = "low" | "mid" | "high";

export function chanceLevel(chance: number): ChanceLevel {
  if (chance >= RAMP_HIGH_AT) return "high";
  return chance >= RAMP_MID_AT ? "mid" : "low";
}

/** Whole percents; the extremes never claim a certainty the model lacks. */
export function formatChance(chance: number): string {
  const percent = Math.round(chance * 100);
  if (percent < 1) return "<1%";
  return percent > 99 ? ">99%" : `${percent}%`;
}
