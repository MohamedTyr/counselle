import { Badge } from "@/components/ui/badge";
import type { ExploreFields } from "@/api/schools/explore";
import { listTypeVariant } from "@/features/schools/schools-config";
import { ABSENT_LABEL, formatBand, formatPercent } from "@/features/schools/explore/explore-format";
import type { FitVerdict, StudentProfile } from "@/features/schools/explore/explore-types";

/*
 * The verdict zone: the card's answer to "can I get in", between two
 * neutral hairlines on the card's own white surface.
 *
 * The verdict WORD is small and the admit RATE is large, and that
 * ordering is the honesty argument expressed as type scale: the rate is
 * the observed evidence, the word is our conclusion about it.
 *
 * `EvidenceLine` is a fixed, stateless one-band rule now (plan §5.3, "Band
 * trust (honesty)"): `submitted_percent` has no source under v3, so there
 * is no trust threshold left to gate a severity ladder on, and the old
 * ladder (severe/mild caveats, a score-based ladder shift) is deleted
 * rather than left dark. What's left is: pick the one band the student's
 * own scores can actually be compared against, show it, and show the
 * comparison when there is one.
 */

type Band = { label: "SAT Math" | "SAT EBRW" | "ACT"; p25: number; p75: number; you: number | null };

/**
 * Which section's band a card shows. Deterministic from the school's own
 * data plus the student's profile -- never from anything ambient -- so two
 * browsers opening the same Explore URL render the same band on the same
 * card. A section the student entered a score for is preferred, in
 * ACT-then-SAT-Math-then-SAT-EBRW order (arbitrary but fixed); with no
 * score at all, the same order picks whichever band the school publishes.
 */
export function pickBand(fields: ExploreFields, profile: StudentProfile): Band | null {
  const act: Band | null =
    fields.act_composite_p25 !== null && fields.act_composite_p75 !== null
      ? { label: "ACT", p25: fields.act_composite_p25, p75: fields.act_composite_p75, you: profile.act }
      : null;
  const satMath: Band | null =
    fields.sat_math_p25 !== null && fields.sat_math_p75 !== null
      ? {
          label: "SAT Math",
          p25: fields.sat_math_p25,
          p75: fields.sat_math_p75,
          you: profile.satMath,
        }
      : null;
  const satEbrw: Band | null =
    fields.sat_ebrw_p25 !== null && fields.sat_ebrw_p75 !== null
      ? {
          label: "SAT EBRW",
          p25: fields.sat_ebrw_p25,
          p75: fields.sat_ebrw_p75,
          you: profile.satEbrw,
        }
      : null;

  if (profile.act !== null && act) return act;
  if (profile.satMath !== null && satMath) return satMath;
  if (profile.satEbrw !== null && satEbrw) return satEbrw;

  return act ?? satMath ?? satEbrw;
}

/** Whether a card for this school, under this profile, would show a band
 *  at all -- what the results header uses to decide whether the wire's
 *  band caption is relevant on this screen (plan §5.3: it renders "whenever
 *  at least one rendered card shows a score band"). */
export function hasScoreBand(fields: ExploreFields, profile: StudentProfile): boolean {
  return pickBand(fields, profile) !== null;
}

function Separator() {
  return (
    <span aria-hidden="true" className="text-[var(--ink-disabled)]">
      ·
    </span>
  );
}

/** The evidence line: the band and the student's own score against it --
 *  two data, dot-joined, no prose. The qualifying sentence lives once, on
 *  the screen, in the wire's `band_caption` -- `bandCaptionId` is that
 *  node's id, so a screen reader hears the qualifier without it being
 *  repeated on every card. */
function EvidenceLine({
  fields,
  profile,
  bandCaptionId,
}: {
  fields: ExploreFields;
  profile: StudentProfile;
  bandCaptionId: string | null;
}) {
  const band = pickBand(fields, profile);
  const formatted = formatBand(band);

  if (formatted === null || band === null) {
    return (
      <p className="mt-2 text-xs text-[var(--school-value-absent)]">test range {ABSENT_LABEL}</p>
    );
  }

  return (
    <p
      aria-describedby={bandCaptionId ?? undefined}
      className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs tabular-nums"
    >
      <span className="text-[var(--ink-secondary)]">{formatted}</span>
      {band.you === null ? null : (
        <>
          <Separator />
          <span className="font-medium text-[var(--ink)]">you {band.you}</span>
        </>
      )}
    </p>
  );
}

export function VerdictBand({
  fields,
  profile,
  verdict,
  bandCaptionId,
}: {
  fields: ExploreFields;
  profile: StudentProfile;
  verdict: FitVerdict;
  /** The id of the once-per-screen band caption node (`ExploreResultsHeader`),
   *  or null when no card on screen shows a band at all. */
  bandCaptionId: string | null;
}) {
  const rate = formatPercent(fields.admit_rate);

  return (
    <div
      // The reason sentence lives here rather than on the card: a screen
      // reader gets the full argument, the eye gets only numbers.
      aria-label={`Fit: ${verdict.category === "Unknown" ? "not classified" : verdict.category}. ${verdict.reason}`}
      className="-mx-4 border-y px-4 py-3"
      role="group"
    >
      <div className="flex items-center justify-between gap-3">
        {rate === null ? (
          <span className="min-w-0 truncate text-sm text-[var(--school-value-absent)]">
            admit rate {ABSENT_LABEL}
          </span>
        ) : (
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="text-[1.625rem] leading-none font-medium tracking-[-0.02em] tabular-nums">
              {rate}
            </span>
            <span className="truncate text-xs text-[var(--ink-muted)]">admit rate</span>
          </span>
        )}
        {verdict.category === "Unknown" ? (
          <Badge className="shrink-0" variant="secondary">
            Not classified
          </Badge>
        ) : (
          <Badge className="shrink-0" variant={listTypeVariant[verdict.category]}>
            {verdict.category}
          </Badge>
        )}
      </div>

      <EvidenceLine bandCaptionId={bandCaptionId} fields={fields} profile={profile} />
    </div>
  );
}
