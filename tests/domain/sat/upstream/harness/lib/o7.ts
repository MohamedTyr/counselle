// Reference implementation of plan §4.3(d) — the O7 acceptance path upstream
// lacks. Written directly from the plan's spec text (exact rational
// arithmetic via BigInt, never floats), independent of `checkIsCorrect`, so
// these vectors are genuinely hand-derived rather than captured from
// upstream (which cannot produce them — O7 does not exist there).
//
// Given a key of the form `a/b` (all numerically-equal fraction keys, if
// several) as the unambiguous exact value V, and a trimmed entry `e`:
// accept iff `e` matches ^-?(\d+\.\d+|\.\d+)$; e's length is 6 with a
// leading '-' or 5 otherwise (sign + decimal point count toward the
// College Board field width); V's exact expansion has a non-zero digit
// beyond e's last decimal place; and e equals V truncated toward zero, or
// rounded half away from zero, to e's number of decimal places.

export interface Fraction {
  num: bigint;
  den: bigint; // always > 0
}

export function fraction(num: number, den: number): Fraction {
  if (den === 0) throw new Error("zero denominator");
  const sign = den < 0 ? -1n : 1n;
  return { num: BigInt(num) * sign, den: BigInt(Math.abs(den)) };
}

/** Decimal digits of |num/den| to `places` places, by exact long division. */
function longDivisionDigits(absNum: bigint, den: bigint, places: number): { digits: string; remainder: bigint } {
  let remainder = absNum % den;
  let digits = "";
  for (let i = 0; i < places; i++) {
    remainder *= 10n;
    const digit = remainder / den;
    digits += digit.toString();
    remainder %= den;
  }
  return { digits, remainder };
}

/** V truncated toward zero to `places` decimal places, formatted like the
 * student's field entry (no leading zero, matching College Board's blank). */
export function truncateToward(v: Fraction, places: number): string {
  const negative = v.num < 0n;
  const absNum = negative ? -v.num : v.num;
  const wholePart = absNum / v.den;
  if (wholePart !== 0n) throw new Error("truncateToward expects |v| < 1");
  const { digits } = longDivisionDigits(absNum, v.den, places);
  return `${negative ? "-" : ""}.${digits}`;
}

/** V rounded half away from zero to `places` decimal places. */
export function roundHalfAwayFromZero(v: Fraction, places: number): string {
  const negative = v.num < 0n;
  const absNum = negative ? -v.num : v.num;
  const wholePart = absNum / v.den;
  if (wholePart !== 0n) throw new Error("roundHalfAwayFromZero expects |v| < 1");
  const { digits, remainder } = longDivisionDigits(absNum, v.den, places);
  // Round the last kept digit up if the next digit (from the remainder) is >= 5.
  const nextDigit = (remainder * 10n) / v.den;
  let asInt = BigInt(digits || "0");
  if (nextDigit >= 5n) asInt += 1n;
  let rounded = asInt.toString().padStart(places, "0");
  if (rounded.length > places) {
    // carried out of the fractional part (e.g. .999 -> 1.000); College
    // Board's field never has this case for the fractions we vector, so
    // truncate the carry — callers should not feed such fractions here.
    rounded = rounded.slice(rounded.length - places);
  }
  return `${negative ? "-" : ""}.${rounded}`;
}

/** True iff V's exact decimal expansion has a non-zero digit beyond `places`. */
export function hasNonZeroDigitBeyond(v: Fraction, places: number): boolean {
  const absNum = v.num < 0n ? -v.num : v.num;
  const { remainder } = longDivisionDigits(absNum, v.den, places);
  return remainder !== 0n;
}

const ENTRY_RE = /^-?(\d+\.\d+|\.\d+)$/;

/** The O7 rule itself, for cross-checking generated vectors. */
export function acceptsUnderO7(v: Fraction, entry: string): boolean {
  const trimmed = entry.trim();
  if (!ENTRY_RE.test(trimmed)) return false;
  const negative = trimmed.startsWith("-");
  // Field width: the entry must fill College Board's field (sign + point
  // count toward it), independent of how many of those characters are
  // decimal digits — "0.666" (3dp) and ".6666" (4dp) are both 5 characters.
  if (negative ? trimmed.length !== 6 : trimmed.length !== 5) return false;
  const decimalPlaces = trimmed.length - trimmed.indexOf(".") - 1;
  if (!hasNonZeroDigitBeyond(v, decimalPlaces)) return false;
  // truncateToward/roundHalfAwayFromZero always format without a leading
  // zero; normalise the entry the same way before comparing so "0.666" and
  // ".666" are judged identically (both are 5-character field entries).
  const withoutLeadingZero = trimmed.replace(/^(-?)0\./, "$1.");
  return withoutLeadingZero === truncateToward(v, decimalPlaces) || withoutLeadingZero === roundHalfAwayFromZero(v, decimalPlaces);
}
