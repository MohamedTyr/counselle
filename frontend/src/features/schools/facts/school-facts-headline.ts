import type { HeadlineTile } from "@/features/schools/facts/HeadlineStrip";
import {
  ABSENCE_COPY,
  DERIVED_UNAVAILABLE_COPY,
  factStateCopy,
  hasSevereCaveat,
  isReported,
  resolveCaveats,
} from "@/features/schools/facts/school-facts-format";
import type {
  DerivedFact,
  Fact,
  SchoolFacts,
} from "@/features/schools/facts/school-facts-types";

/*
 * The five tiles: what a student checks first.
 *
 * Admit rate · SAT middle 50% · sticker cost · average need met · six-year
 * graduation. Two of the five are derived, and both say so in the foot with
 * the word "calculated" rather than by wearing a colour.
 *
 * A tile whose value is absent still renders. Dropping it would silently
 * change the strip's shape from school to school, so a reader could never
 * tell whether a school is missing the figure or the strip just has fewer
 * tiles — and "there are only four tiles here" is not a sentence anyone
 * reads as "we don't know this school's admit rate".
 */

/**
 * The strip is always these five tiles. When the packet holds nothing for
 * one of them the tile still renders, saying so — dropping it would change
 * the strip's shape from school to school, and four tiles where there are
 * usually five reads as "this school has less to say", not as "we could not
 * read this school's admit rate".
 */
function missingTile(
  key: string,
  label: string,
  secondary?: boolean,
): HeadlineTile {
  return {
    key,
    label,
    value: ABSENCE_COPY.no_verified_value,
    absent: true,
    foot: null,
    severe: false,
    secondary,
  };
}

function derivedTile(
  key: string,
  label: string,
  data: SchoolFacts,
  options: { foot?: string; secondary?: boolean } = {},
): HeadlineTile {
  const derived: DerivedFact | undefined = data.derived[key];
  if (!derived) return missingTile(key, label, options.secondary);
  const computed = isReported(derived.state);
  return {
    key,
    label,
    value: computed ? derived.state.display : DERIVED_UNAVAILABLE_COPY,
    absent: !computed,
    /* When it did not compute, the foot carries the reason rather than the
     * word "calculated" — a tile that says "calculated" above "not
     * available" is claiming work it did not do. */
    foot: computed ? (options.foot ?? "calculated") : derived.blockedBy,
    severe: false,
    secondary: options.secondary,
  };
}

function factTile(
  ref: string,
  label: string,
  data: SchoolFacts,
  options: { foot?: string | null; secondary?: boolean } = {},
): HeadlineTile {
  const fact: Fact | undefined = data.facts[ref];
  if (!fact) return missingTile(ref, label, options.secondary);
  const reported = isReported(fact.state);
  const severe = hasSevereCaveat(fact.caveatRefs, data.caveats);
  const caveats = resolveCaveats(fact.caveatRefs, data.caveats);
  return {
    key: ref,
    label,
    value: factStateCopy(fact.state),
    absent: !reported,
    /*
     * The severe caveat wins the foot outright. If the number cannot be read
     * correctly without a qualifier, that qualifier is more useful in this
     * 12px slot than a vintage is.
     *
     * The strip uses the caveat's short form when it has one — "62%
     * submitted" instead of the full sentence — because a three-line foot
     * under a one-line value makes the five tiles read as five different
     * shapes. The full sentence still renders, unabridged, on the row in the
     * section below; nothing is only ever said in short form.
     */
    foot: severe
      ? (caveats[0].short ?? caveats[0].text)
      : (options.foot ??
        caveats[0]?.short ??
        caveats[0]?.text ??
        fact.contexts[0]?.display ??
        null),
    severe,
    secondary: options.secondary,
  };
}

export function buildHeadlineTiles(data: SchoolFacts): HeadlineTile[] {
  const year = data.edition
    ? `${data.edition.academicYear - 1}–${String(data.edition.academicYear).slice(-2)}`
    : undefined;

  return [
    derivedTile("admit_rate", "Admit rate", data),
    factTile("class_profile.sat_composite_middle_50", "SAT middle 50%", data),
    derivedTile("sticker_cost", "Sticker cost", data, { foot: year }),
    /* The derived h2_h / h2_c, never the printed h2_i: the printed figure
     * has aid recipients as its denominator and excludes PLUS and private
     * loans, so a school can print 100% while the family still borrows. */
    derivedTile("need_fully_met_share", "Need met", data, { secondary: true }),
    factTile(
      "outcomes.primary_all_students_six_year_graduation_rate_ratio",
      "6-year graduation",
      data,
      { secondary: true },
    ),
  ];
}
