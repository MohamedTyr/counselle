import { Check, Plus } from "lucide-react";
import { Fragment } from "react";
import { Link } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { SchoolAvatar } from "@/features/schools/school-cells";
import { classifyFit } from "@/features/schools/explore/classify-fit";
import {
  ABSENT_LABEL,
  costLabel,
  formatCompactCount,
  formatCurrency,
  formatDeadlineDate,
  formatPercent,
} from "@/features/schools/explore/explore-format";
import type {
  ExploreSchool,
  StudentProfile,
} from "@/features/schools/explore/explore-types";
import { VerdictBand } from "@/features/schools/explore/VerdictBand";
import { cn } from "@/lib/utils";

/*
 * One school, as a comparison unit. Explore uses cards and My list uses a
 * table because they answer different questions: "which of these do I
 * want?" is a comparison read where six numbers need to be visible at once
 * and the eye moves between whole units; "what do I owe and when?" is a
 * status read down aligned columns.
 *
 * Nothing on this card is a sentence. Every mark is a datum, a label for a
 * datum, or the mark for a datum that does not exist — because the card is
 * read twenty-four at a time and prose only survives the first one. The one
 * caveat that genuinely needs explaining (a test band under 50% submitted)
 * carries its explanation in the band's accessible name and a title, and
 * shows on the card as a number with a glyph.
 */

/**
 * Value first, label under. The label-above-value ordering that reads well
 * on a dashboard tile is wrong here: in a wall of cards the eye is
 * comparing NUMBERS across a fixed column position, and putting the label
 * on top makes it read the same word twenty-four times before reaching the
 * thing it came for.
 */
function StatCell({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      {value === null ? (
        <span className="truncate text-xs leading-6 text-[var(--school-value-absent)]">
          {ABSENT_LABEL}
        </span>
      ) : (
        <span className="truncate text-[15px] leading-6 font-medium tabular-nums">
          {value}
        </span>
      )}
      <span className="truncate text-xs leading-4 text-[var(--ink-muted)]">
        {label}
      </span>
    </div>
  );
}

/** The aid slot backfills rather than leaving a hole: a school with no
 *  need-met figure still has something true to say about money, and an
 *  empty third of the card says nothing at all. */
function AidStat({ school }: { school: ExploreSchool }) {
  if (school.needMet === null) {
    return (
      <StatCell label="got merit aid" value={formatPercent(school.meritAid)} />
    );
  }

  return (
    <StatCell label="need fully met" value={formatPercent(school.needMet)} />
  );
}

/**
 * Rounds as a dot-joined run rather than a row of filled chips. Four grey
 * pills is four objects competing with the numbers above them for what is,
 * on most schools, an unremarkable fact; the one round that matters — the
 * earliest, the one the date belongs to — is the only one set in full ink.
 */
function RoundsFooter({ school }: { school: ExploreSchool }) {
  const earliest = school.rounds.reduce<(typeof school.rounds)[number] | null>(
    (best, round) =>
      round.deadline !== null &&
      (best === null || round.deadline < (best.deadline ?? ""))
        ? round
        : best,
    null,
  );

  return (
    <div className="-mx-4 mt-auto flex items-center justify-between gap-3 border-t px-4 pt-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-1 text-xs">
        {school.rounds.map((round, index) => (
          <Fragment key={round.code}>
            {index > 0 ? (
              <span aria-hidden="true" className="text-[var(--ink-disabled)]">
                ·
              </span>
            ) : null}
            <span
              className={
                round.code === earliest?.code
                  ? "font-medium text-[var(--ink)]"
                  : "text-[var(--ink-faint)]"
              }
            >
              {round.code}
            </span>
          </Fragment>
        ))}
      </div>
      <span className="shrink-0 text-xs font-medium tabular-nums">
        {formatDeadlineDate(earliest?.deadline ?? null) ?? (
          <span className="font-normal text-[var(--school-value-absent)]">
            Rolling
          </span>
        )}
      </span>
    </div>
  );
}

function CardAction({
  school,
  isAdding,
  onAdd,
}: {
  school: ExploreSchool;
  isAdding: boolean;
  onAdd: (school: ExploreSchool) => void;
}) {
  if (school.onList) {
    return (
      <Badge
        className="relative z-10 shrink-0 gap-1 border-[var(--school-card-onlist-border)] bg-[var(--school-card-onlist-badge-surface)] text-[var(--school-card-onlist-badge-ink)]"
        variant="outline"
      >
        <Check aria-hidden="true" />
        On list
      </Badge>
    );
  }

  return (
    <Button
      aria-label={`Add ${school.name} to your list`}
      className="relative z-10 shrink-0"
      disabled={isAdding}
      onClick={() => onAdd(school)}
      size="sm"
      variant="outline"
    >
      {isAdding ? (
        <Spinner data-icon="inline-start" />
      ) : (
        <Plus data-icon="inline-start" />
      )}
      Add
    </Button>
  );
}

export function SchoolResultCard({
  school,
  profile,
  href,
  isAdding = false,
  onAdd,
}: {
  school: ExploreSchool;
  profile: StudentProfile;
  /**
   * The school's workspace page — only exists once the school is on the
   * list and therefore has an application id. Explore does not fabricate a
   * link to a page that isn't there; when href is null the Add button is
   * the card's only target.
   */
  href: string | null;
  isAdding?: boolean;
  onAdd: (school: ExploreSchool) => void;
}) {
  const verdict = classifyFit(school, profile);
  const size = formatCompactCount(school.undergraduates);

  return (
    <article
      className={cn(
        // h-full so every card in a row reaches the same height and the
        // footers line up across the grid — a ragged bottom edge makes a
        // comparison read harder than any single card's content does.
        // min-w-0 because the card is a grid item: its default
        // `min-width: auto` resolves to min-content, which the full-bleed
        // band and the three-column stat row push past the track width,
        // and the card then paints over its neighbour.
        "relative flex h-full min-w-0 flex-col rounded-xl border bg-[var(--school-card-surface)] p-4 transition-[border-color,box-shadow] duration-150",
        school.onList
          ? "border-[var(--school-card-onlist-border)]"
          : "border-[var(--school-card-border)]",
        // Border + shadow on hover only. Never border-plus-wide-shadow at
        // rest, and never a transform — eight cards nudging under the
        // cursor is motion that clarifies nothing.
        href
          ? "hover:border-[var(--school-card-border-hover)] hover:shadow-[var(--elevation-1)]"
          : null,
      )}
    >
      {/* A grid rather than a flex row so the metadata line spans back under
       * the action button instead of sharing a track with it. That single
       * column is what makes "Colorado Springs, CO · private · 2.2k
       * undergrads" fit on one line rather than truncating mid-word. */}
      <div className="grid grid-cols-[2.5rem_1fr_auto] items-start gap-x-3">
        {/* row-span-2 so the mark centres against the name AND its metadata
         * line as one block, and — more to the point — so the 40px mark
         * stops setting the height of the name's row and pushing the
         * metadata a full line-height away from the name it belongs to. */}
        <div className="row-span-2 self-center">
          <SchoolAvatar name={school.name} websiteUrl={school.websiteUrl} />
        </div>
        {/* One step above the stat values below it: the name is the card's
         * identity and must not be out-typed by a number inside it. */}
        <h3 className="line-clamp-2 self-center text-base leading-tight font-medium text-balance">
          {/* One real anchor per card, stretched over the whole surface:
           * screen readers and middle-click get a link, the pointer gets
           * the full hit area, and the Add button stays its own target. */}
          {href ? (
            <Link
              className="rounded-sm outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-[var(--focus-ring)]"
              to={href}
            >
              {school.name}
            </Link>
          ) : (
            school.name
          )}
        </h3>
        <CardAction isAdding={isAdding} onAdd={onAdd} school={school} />
        <p className="col-span-2 col-start-2 mt-1 truncate text-xs text-[var(--ink-muted)]">
          {school.city}, {school.state} ·{" "}
          <span className="capitalize">{school.control}</span>
          {size ? ` · ${size} undergrads` : ""}
        </p>
      </div>

      <div className="mt-4">
        <VerdictBand profile={profile} school={school} verdict={verdict} />
      </div>

      {/* "Sticker cost", not "Your cost": this is the published price before
       * aid, and a label that implies net price would be the one lie on a
       * card built to avoid them. Which residency row the number came from
       * is folded into the label rather than hung under the value. */}
      <div className="grid grid-cols-3 items-start gap-3 py-4">
        <StatCell
          label={costLabel(school.cost?.basis ?? null)}
          value={formatCurrency(school.cost?.amount ?? null)}
        />
        <AidStat school={school} />
        <StatCell
          label="grad in 4 yrs"
          value={formatPercent(school.gradFourYear)}
        />
      </div>

      <RoundsFooter school={school} />
    </article>
  );
}
