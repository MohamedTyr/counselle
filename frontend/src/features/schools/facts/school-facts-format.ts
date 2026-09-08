import type { SchoolIdentity } from "@/features/schools/facts/school-facts-types";

/*
 * The value-formatting notes this file still owns.
 *
 * Every STATE word — "Not reported", "Not checked", "Not on file", the
 * section lines, the deadline foot, the band caption — is composed
 * server-side (`domain/facts/state.py`, `app/facts/service.py`) and arrives
 * on the wire in `display`/`line`/`foot`. This file authors none of that; it
 * only formats identity metadata, which is not a fact and carries no state.
 */

/**
 * The second, page-level freshness clause. A frontend literal, not a wire
 * field: it names no upstream source (D3) and interpolates nothing, so it
 * needs no slot on the response (plan §5.2).
 */
export const FRESHNESS_MEASURED_NOTE =
  "“Checked” is when we last saw a value published, not when it was measured.";

/**
 * The section-level explanation for a fact with no `reported_period`. This
 * IS a wire field (`FactSection.foot`) — kept here only as the doc anchor a
 * reviewer would look for; nothing constructs the sentence client-side.
 */

export function identityMeta(identity: SchoolIdentity): string {
  /*
   * An absent identity part is DROPPED rather than rendered as "unknown" —
   * these are not metrics a student is choosing a school by, so the absence
   * grammar buys nothing here.
   */
  const place = [identity.city, identity.state].filter(Boolean).join(", ");
  const control =
    identity.control === "public"
      ? "Public"
      : identity.control === "private"
        ? "Private"
        : identity.control === "private_for_profit"
          ? "Private (for-profit)"
          : null;
  const size =
    identity.undergraduates === null
      ? null
      : `${identity.undergraduates.toLocaleString()} undergraduates`;
  return [place || null, control, size].filter(Boolean).join(" · ");
}
