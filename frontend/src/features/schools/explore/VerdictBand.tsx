import { AlertTriangle } from "lucide-react";
import { Fragment } from "react";

import { Badge } from "@/components/ui/badge";
import { listTypeVariant } from "@/features/schools/schools-config";
import { caveatSeverity } from "@/features/schools/explore/classify-fit";
import {
  ABSENT_LABEL,
  admitLabel,
  formatPercent,
  formatTestBand,
} from "@/features/schools/explore/explore-format";
import type {
  ExploreSchool,
  FitVerdict,
  StudentProfile,
} from "@/features/schools/explore/explore-types";
import { cn } from "@/lib/utils";

/*
 * The verdict zone: the card's answer to "can I get in", between two
 * neutral hairlines on the card's own white surface.
 *
 * It used to be a full-bleed tinted strip — Reach amber, Target blue,
 * Safety green — and the tint was doing too much: a saturated band 340px
 * wide is the loudest thing in a grid of twenty-four cards, so the page
 * read as a wall of colour blocks with numbers in them rather than as a
 * set of schools. The fit ladder keeps its colour, but concentrated into
 * the badge, which is where My list already carries it. Same three roles,
 * one hundredth of the area, and the pill reads properly on white in a way
 * it could never read on a tint of its own hue.
 *
 * The verdict WORD is small and the admit RATE is large, and that ordering
 * is the honesty argument expressed as type scale: the rate is the observed
 * evidence, the word is our conclusion about it. METRICS-KEEP.md licenses
 * the categorical verdict precisely because it classifies risk instead of
 * emitting a fake probability, so the number the school actually published
 * outranks the label we attached to it.
 *
 * The rate is also the card's ONE oversized element. A card where every
 * zone is set at the same weight has no read order and is the thing that
 * makes a data card feel machine-assembled; this one has a single anchor
 * and everything else is dense, quiet data hung off it.
 */

const SEVERE_CAVEAT =
  "Fewer than half this class submitted scores, so the range describes the top third rather than the middle.";

function Separator() {
  return (
    <span aria-hidden="true" className="text-[var(--ink-disabled)]">
      ·
    </span>
  );
}

/**
 * The evidence line: the test band, the student's own score against it, and
 * how much of the class the band actually covers — three data, dot-joined,
 * no prose. Severity is carried by ink weight plus a glyph rather than by a
 * sentence, because a sentence on a comparison card is something you read
 * once and then have to skip past on the other twenty-three cards.
 */
function EvidenceLine({
  school,
  profile,
}: {
  school: ExploreSchool;
  profile: StudentProfile;
}) {
  const band = formatTestBand(school.testBand);
  const submitted = school.testBand?.submittedPercent ?? null;
  const severity = caveatSeverity(school);

  if (band === null) {
    return (
      <p className="mt-2 text-xs text-[var(--school-value-absent)]">
        test range {ABSENT_LABEL}
      </p>
    );
  }

  /* Caveats are structurally inseparable from the number they qualify
   * (filters spec §7.3), so the submitted share renders on the same line as
   * the band it describes — never in a tooltip, never a row of its own. */
  const parts = [
    <span className="text-[var(--ink-secondary)]" key="band">
      {band}
    </span>,
    profile.satScore === null ? null : (
      <span className="font-medium text-[var(--ink)]" key="score">
        you {profile.satScore}
      </span>
    ),
    submitted === null || severity === "none" ? null : (
      <span
        className={cn(
          "inline-flex items-center gap-1",
          severity === "severe"
            ? "font-medium text-[var(--ink)]"
            : "text-[var(--ink-muted)]",
        )}
        key="submitted"
        title={severity === "severe" ? SEVERE_CAVEAT : undefined}
      >
        {severity === "severe" ? (
          <AlertTriangle aria-hidden="true" className="size-3 shrink-0" />
        ) : null}
        {submitted}% submitted
      </span>
    ),
  ].filter(Boolean);

  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs tabular-nums">
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 ? <Separator /> : null}
          {part}
        </Fragment>
      ))}
    </p>
  );
}

export function VerdictBand({
  school,
  profile,
  verdict,
}: {
  school: ExploreSchool;
  profile: StudentProfile;
  verdict: FitVerdict;
}) {
  const rate = formatPercent(school.admitRate?.value ?? null);
  const severity = caveatSeverity(school);

  return (
    <div
      /* The reason sentence lives here rather than on the card: a screen
       * reader gets the full argument, the eye gets only numbers. */
      aria-label={`Fit: ${verdict.category === "Unknown" ? "not classified" : verdict.category}. ${verdict.reason}${severity === "severe" ? ` ${SEVERE_CAVEAT}` : ""}`}
      className="-mx-4 border-y px-4 py-3"
      role="group"
    >
      {/* The rate leads, hard left. It used to sit in the top-right corner,
       * which is where a card puts a price tag, not where it puts its
       * headline: right-aligned it answered to nothing, floated away from
       * the evidence line explaining it, and left the eye starting the zone
       * on a badge. On the left it starts the line the reader already
       * starts on, and it stacks into a spine with the test band beneath it
       * and the cost figure beneath that — one column of numbers down the
       * card's left edge. The badge takes the corner instead, where a
       * status marker belongs. */}
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
            <span className="truncate text-xs text-[var(--ink-muted)]">
              {admitLabel(school.admitRate?.basis ?? null)}
            </span>
          </span>
        )}
        {/* The one place the fit ladder is coloured. listTypeVariant is the
         * same map My list's rows use, so a school added from Explore lands
         * there wearing the badge it already had. */}
        {verdict.category === "Unknown" ? (
          <Badge className="shrink-0" variant="secondary">
            Not classified
          </Badge>
        ) : (
          <Badge
            className="shrink-0"
            variant={listTypeVariant[verdict.category]}
          >
            {verdict.category}
          </Badge>
        )}
      </div>

      <EvidenceLine profile={profile} school={school} />
    </div>
  );
}
