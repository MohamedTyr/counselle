import type {
  FactState,
  SchoolIdentity,
} from "@/features/schools/facts/school-facts-types";

/*
 * The copy deck, in code.
 *
 * Every string a student reads about the SHAPE of our data is decided here
 * and nowhere else. Scattering these across components is how "not reported"
 * quietly becomes "—" on the one screen nobody re-read.
 */

/**
 * Six states, six different sentences. The words are the whole point: each
 * one is a different claim about why there is no number, and a reader who
 * is choosing where to apply deserves to know which claim we are making.
 *
 * Never an empty cell, an em dash, a `0`, `N/A`, `null`, or a hidden row.
 */
export const ABSENCE_COPY: Record<
  Exclude<FactState["kind"], "reported">,
  string
> = {
  not_reported: "not reported",
  not_applicable: "not applicable",
  suppressed: "withheld by the school",
  not_in_template_version: "not in this form edition",
  no_verified_value: "no verified value",
};

/** A derived value whose inputs are incomplete. Distinct from all six above. */
export const DERIVED_UNAVAILABLE_COPY = "not available";

export const ROUND_NOT_OFFERED_COPY = "not offered";

export const ABSENT_TOPIC_EXPLANATION =
  "Not a Common Data Set field. Counselle checks the school's site when you ask.";

export function factStateCopy(state: FactState): string {
  return state.kind === "reported" ? state.display : ABSENCE_COPY[state.kind];
}

export type ReportedState = Extract<FactState, { kind: "reported" }>;

/** A type guard, so `state.display` is reachable without a cast. */
export function isReported(state: FactState): state is ReportedState {
  return state.kind === "reported";
}

export function identityMeta(identity: SchoolIdentity): string {
  /*
   * An absent identity part is DROPPED rather than rendered as "unknown".
   * These are not metrics — nobody is deciding where to apply based on
   * whether we know the city — and running the absence grammar here would
   * spend the reader's attention on the one line where it buys nothing.
   */
  const place = [identity.city, identity.state].filter(Boolean).join(", ");
  const control =
    identity.control === "public"
      ? "Public"
      : identity.control === "private"
        ? "Private"
        : null;
  const size =
    identity.undergraduates === null
      ? null
      : `${identity.undergraduates.toLocaleString()} undergraduates`;
  return [place || null, control, size].filter(Boolean).join(" · ");
}
