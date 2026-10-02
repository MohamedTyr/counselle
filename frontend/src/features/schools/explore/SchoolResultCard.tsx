import { Check, Landmark, MapPin, Plus, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router";

import type { ExploreSchoolCard } from "@/api/schools/explore";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  ABSENT_LABEL,
  formatCompactCount,
  formatCurrency,
  formatPercent,
} from "@/features/schools/explore/explore-format";
import { controlShortLabel } from "@/features/schools/explore/explore-config";
import type { ExploreAssumptions } from "@/features/schools/explore/explore-types";
import { schoolColour } from "@/features/schools/explore/school-colours";
import { SchoolAvatar } from "@/features/schools/school-cells";
import { cn } from "@/lib/utils";

/*
 * One school, as a comparison unit. Explore uses cards and My list uses a
 * table because they answer different questions: "which of these do I
 * want?" is a comparison read where the eye moves between whole units;
 * "what do I owe and when?" is a status read down aligned columns.
 *
 * The card carries two numbers, the two a student decides on first: can I
 * get in (the admit rate and the band it implies) and can I pay for it (the
 * yearly cost). Everything else is one click away on the school's page.
 * A missing number still takes its slot and says "not available" -- a blank
 * reads as zero, and zero is a lie (AGENTS.md principle 3).
 */

/** The same ordered green steps the My list balance legend uses. */
const BAND_DOT: Record<"Reach" | "Target" | "Safety", string> = {
  Reach: "var(--school-balance-reach)",
  Target: "var(--school-balance-target)",
  Safety: "var(--school-balance-safety)",
};

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

function Figure({
  value,
  label,
  valueClassName,
}: {
  value: string | null;
  label: string;
  valueClassName?: string;
}) {
  return (
    <div className="min-w-0">
      {value === null ? (
        <span className="block pt-1.5 pb-0.5 text-[13px] leading-5 text-[var(--school-value-absent)]">
          {ABSENT_LABEL}
        </span>
      ) : (
        <span
          className={cn(
            "block truncate text-[26px] leading-7 font-semibold tracking-[-0.03em] tabular-nums",
            valueClassName,
          )}
        >
          {value}
        </span>
      )}
      <span className="mt-1 block truncate text-xs text-[var(--ink-faint)]">
        {label}
      </span>
    </div>
  );
}

/** One fact on the meta line: an icon names the kind, so no separators. */
function MetaItem({
  icon: Icon,
  children,
  className,
}: {
  icon: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-1", className)}>
      <Icon
        aria-hidden="true"
        className="size-3.5 shrink-0 text-[var(--ink-faint)]"
      />
      <span className="truncate">{children}</span>
    </span>
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
      <span className="relative z-10 inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-[var(--school-card-onlist-surface)] pr-2.5 pl-2 text-xs font-medium text-[var(--school-card-onlist-ink)]">
        <Check
          aria-hidden="true"
          className="size-3.5 text-[var(--school-card-onlist-icon)]"
          strokeWidth={2.75}
        />
        On list
      </span>
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
  onAdd,
}: {
  school: ExploreSchoolCard;
  assumptions: ExploreAssumptions;
  /** The school's workspace page -- every school has one now, keyed by
   *  unitid, whether or not it is on the list. */
  href: string | null;
  onList?: boolean;
  isAdding?: boolean;
  onAdd: (school: ExploreSchoolCard) => void;
}) {
  const size = formatCompactCount(school.fields.undergraduates);
  const cost = pickCost(school, assumptions);
  const rate = formatPercent(school.fit.admit_rate);
  // An unclassifiable school has no rate to show and no band to claim.
  const band = school.fit.category === "Unknown" ? null : school.fit.category;
  const colour = schoolColour(school.unitid);

  return (
    <article
      className="relative flex h-full min-w-0 flex-col gap-4 rounded-[18px] p-4"
      data-linked={href ? true : undefined}
      data-slot="school-card"
      style={
        colour
          ? ({
              "--school-colour": colour.fill,
              "--school-colour-ink": colour.ink,
            } as CSSProperties)
          : undefined
      }
    >
      <div className="flex items-center justify-between gap-3">
        <span className="rounded-xl bg-[var(--school-card-logo-surface)] p-0.5 shadow-[var(--elevation-1)]">
          <SchoolAvatar name={school.name} websiteUrl={school.website_url} />
        </span>
        <div className="flex items-center gap-1.5">
          {band ? (
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--school-card-band-surface)] pr-2.5 pl-2 text-xs font-medium text-[var(--school-card-band-ink)] sm:h-7">
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full"
                style={{ background: BAND_DOT[band] }}
              />
              {band}
            </span>
          ) : null}
          <CardAction
            isAdding={isAdding}
            name={school.name}
            onAdd={() => onAdd(school)}
            onList={onList}
          />
        </div>
      </div>

      <div className="min-w-0">
        <h3 className="break-words text-base leading-tight font-semibold tracking-[-0.015em] text-balance">
          {href ? (
            <Link
              className="rounded-sm outline-none after:absolute after:inset-0 after:rounded-[18px] focus-visible:after:ring-2 focus-visible:after:ring-[var(--focus-ring)]"
              to={href}
            >
              {school.name}
            </Link>
          ) : (
            school.name
          )}
        </h3>
        <p className="mt-1.5 flex min-w-0 items-center gap-3 text-xs text-[var(--ink-secondary)]">
          <MetaItem icon={MapPin}>
            {school.city ?? "City unknown"}, {school.state ?? "?"}
          </MetaItem>
          <MetaItem className="shrink-0" icon={Landmark}>
            {controlShortLabel[school.fields.control]}
          </MetaItem>
          {size ? (
            <MetaItem className="shrink-0" icon={Users}>
              {size} undergrads
            </MetaItem>
          ) : null}
        </p>
      </div>

      <div className="mt-auto grid grid-cols-2">
        <div
          aria-label={`Admit rate: ${rate ?? ABSENT_LABEL}.${band ? ` ${band}.` : ""}`}
          role="group"
        >
          <Figure
            label="admit rate"
            value={rate}
            valueClassName="text-[var(--school-card-rate-ink)]"
          />
        </div>
        <div className="border-l border-[var(--school-card-divider)] pl-3.5">
          <Figure
            label={
              cost.basis === "in-state"
                ? "per year, in state"
                : "per year, out of state"
            }
            value={formatCurrency(cost.amount)}
          />
        </div>
      </div>
    </article>
  );
}
