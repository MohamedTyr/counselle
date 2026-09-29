import type { ExploreFields } from "@/api/schools/explore";
import type { ExploreAssumptions } from "@/features/schools/explore/explore-types";

type Band = {
  label: "SAT Math" | "SAT EBRW" | "ACT";
  p25: number;
  p75: number;
};

/** Which institutional score band a card previews. The assumptions choose
 * which band is shown, never what the card says about the school. */
export function pickBand(
  fields: ExploreFields,
  assumptions: ExploreAssumptions,
): Band | null {
  const act: Band | null =
    fields.act_composite_p25 !== null && fields.act_composite_p75 !== null
      ? {
          label: "ACT",
          p25: fields.act_composite_p25,
          p75: fields.act_composite_p75,
        }
      : null;
  const satMath: Band | null =
    fields.sat_math_p25 !== null && fields.sat_math_p75 !== null
      ? {
          label: "SAT Math",
          p25: fields.sat_math_p25,
          p75: fields.sat_math_p75,
        }
      : null;
  const satEbrw: Band | null =
    fields.sat_ebrw_p25 !== null && fields.sat_ebrw_p75 !== null
      ? {
          label: "SAT EBRW",
          p25: fields.sat_ebrw_p25,
          p75: fields.sat_ebrw_p75,
        }
      : null;

  if (assumptions.act !== null && act) return act;
  if (assumptions.satMath !== null && satMath) return satMath;
  if (assumptions.satEbrw !== null && satEbrw) return satEbrw;

  return act ?? satMath ?? satEbrw;
}
