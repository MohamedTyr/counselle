import { Check, Plus } from "lucide-react";
import { Fragment } from "react";
import { Link } from "react-router";

import type { ExploreSchoolCard } from "@/api/schools/explore";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  ABSENT_LABEL,
  costLabel,
  formatCompactCount,
  formatCurrency,
  formatDeadlineDate,
  formatPercent,
} from "@/features/schools/explore/explore-format";
import type { ExploreAssumptions } from "@/features/schools/explore/explore-types";
import { VerdictBand } from "@/features/schools/explore/VerdictBand";
import { SchoolAvatar } from "@/features/schools/school-cells";
import { cn } from "@/lib/utils";

/*
 * One school, as a comparison unit. Explore uses cards and My list uses a
 * table because they answer different questions: "which of these do I
 * want?" is a comparison read where several numbers need to be visible at
 * once and the eye moves between whole units; "what do I owe and when?" is
 * a status read down aligned columns.
 *
 * Nothing on this card is a sentence. Every mark is a datum, a label for a
 * datum, or the mark for a datum that does not exist -- because the card
 * is read twenty-four at a time and prose only survives the first one.
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

/** Picks the in-state or out-of-state cost row exactly the way the explore
 *  query itself does (`app/facts/service_explore.py`'s `cost` clause): the
 *  in-state figure only when the student's home state matches the school's
 *  own state, out-of-state otherwise. */
function pickCost(school: ExploreSchoolCard, assumptions: ExploreAssumptions) {
  const inState =
    assumptions.homeState !== null && assumptions.homeState === school.state;
  const amount = inState
    ? school.fields.cost_attendance_in_state
    : school.fields.cost_attendance_out_of_state;
  return {
    amount,
    basis: inState ? ("in-state" as const) : ("out-of-state" as const),
  };
}

function RoundsFooter({ school }: { school: ExploreSchoolCard }) {
  const {
    offers_early_decision,
    offers_early_action,
    is_rolling,
    deadline_regular,
  } = school.fields;
  const codes = [
    offers_early_decision ? "ED" : null,
    offers_early_action ? "EA" : null,
    is_rolling ? "Rolling" : null,
  ].filter((code): code is string => code !== null);
  const deadline = formatDeadlineDate(deadline_regular);

  return (
    <div className="-mx-4 mt-auto flex items-center justify-between gap-3 border-t px-4 pt-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-1 text-xs">
        {codes.length === 0 ? (
          <span className="text-[var(--ink-faint)]">Regular Decision</span>
        ) : (
          codes.map((code, index) => (
            <Fragment key={code}>
              {index > 0 ? (
                <span aria-hidden="true" className="text-[var(--ink-disabled)]">
                  ·
                </span>
              ) : null}
              <span className="font-medium text-[var(--ink)]">{code}</span>
            </Fragment>
          ))
        )}
      </div>
      <span className="shrink-0 text-xs font-medium tabular-nums">
        {deadline ?? (
          <span className="font-normal text-[var(--school-value-absent)]">
            {is_rolling ? "Rolling" : `deadline ${ABSENT_LABEL}`}
          </span>
        )}
      </span>
    </div>
  );
}

function CardAction({
  onList,
  isAdding,
  onAdd,
  name,
}: {
  onList: boolean;
  isAdding: boolean;
  onAdd: () => void;
  name: string;
}) {
  if (onList) {
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
      aria-label={`Add ${name} to your list`}
      className="relative z-10 shrink-0"
      disabled={isAdding}
      onClick={onAdd}
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
  assumptions,
  href,
  onList = false,
  isAdding = false,
  isRefreshingEstimate = false,
  bandCaptionId,
  onAdd,
}: {
  school: ExploreSchoolCard;
  assumptions: ExploreAssumptions;
  /** The school's workspace page -- every school has one now, keyed by
   *  unitid, whether or not it is on the list. */
  href: string | null;
  onList?: boolean;
  isAdding?: boolean;
  isRefreshingEstimate?: boolean;
  bandCaptionId: string | null;
  onAdd: (school: ExploreSchoolCard) => void;
}) {
  const size = formatCompactCount(school.fields.undergraduates);
  const cost = pickCost(school, assumptions);

  return (
    <article
      className={cn(
        "relative flex h-full min-w-0 flex-col rounded-xl border bg-[var(--school-card-surface)] p-4 transition-[border-color,box-shadow] duration-150",
        onList
          ? "border-[var(--school-card-onlist-border)]"
          : "border-[var(--school-card-border)]",
        href
          ? "hover:border-[var(--school-card-border-hover)] hover:shadow-[var(--elevation-1)]"
          : null,
      )}
    >
      <div className="grid grid-cols-[2.5rem_1fr_auto] items-start gap-x-3">
        <div className="row-span-2 self-center">
          <SchoolAvatar name={school.name} websiteUrl={school.website_url} />
        </div>
        <h3 className="line-clamp-2 self-center text-base leading-tight font-medium text-balance">
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
        <CardAction
          isAdding={isAdding}
          name={school.name}
          onAdd={() => onAdd(school)}
          onList={onList}
        />
        <p className="col-span-2 col-start-2 mt-1 truncate text-xs text-[var(--ink-muted)]">
          {school.city ?? "City unknown"}, {school.state ?? "?"} ·{" "}
          <span className="capitalize">
            {school.fields.control.replace("_", " ")}
          </span>
          {size ? ` · ${size} undergrads` : ""}
        </p>
      </div>

      <div className="mt-4">
        <VerdictBand
          bandCaptionId={bandCaptionId}
          fields={school.fields}
          assumptions={assumptions}
          fit={school.fit}
          isRefreshingEstimate={isRefreshingEstimate}
        />
      </div>

      <div className="grid grid-cols-3 items-start gap-3 py-4">
        <StatCell
          label={costLabel(cost.basis)}
          value={formatCurrency(cost.amount)}
        />
        <StatCell
          label="share of need met"
          value={formatPercent(school.fields.need_met_pct)}
        />
        <StatCell
          label="grad in 4 yrs"
          value={formatPercent(school.fields.grad_rate_4y)}
        />
      </div>

      <RoundsFooter school={school} />
    </article>
  );
}
