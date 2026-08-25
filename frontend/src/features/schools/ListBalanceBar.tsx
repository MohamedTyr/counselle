import { ArrowRight, TriangleAlert } from "lucide-react";
import { Link } from "react-router";

import type { ListType, School } from "@/domain/school";
import type { ListTypeFilter } from "@/features/schools/schools-types";
import { cn } from "@/lib/utils";

/*
 * The balance bar replaces the old All types / Reach / Target / Safety pill
 * row. Two stacked pill rows have no hierarchy, and — more importantly — a
 * pill reading `Safety 0` states a fact while hiding that it is a problem.
 * The bar shows the distribution, the legend does the pill row's filtering
 * job, and the nudge tells the student what to do about a broken list and
 * hands them the fix.
 *
 * That nudge is this page's counselor voice, and it is the reason the row
 * is being replaced rather than restyled.
 */

const SEGMENTS: {
  listType: ListType;
  filter: ListTypeFilter;
  bar: string;
  swatch: string;
}[] = [
  {
    bar: "bg-[var(--school-balance-reach)]",
    filter: "reach",
    listType: "Reach",
    swatch: "bg-[var(--school-balance-reach)]",
  },
  {
    bar: "bg-[var(--school-balance-target)]",
    filter: "target",
    listType: "Target",
    swatch: "bg-[var(--school-balance-target)]",
  },
  {
    bar: "bg-[var(--school-balance-safety)]",
    filter: "safety",
    listType: "Safety",
    swatch: "bg-[var(--school-balance-safety)]",
  },
];

/** Above this share of reaches the list is top-heavy even when a safety or
 *  two exists. */
const REACH_HEAVY_SHARE = 0.6;

function nudgeFor(counts: Record<ListType, number>, total: number) {
  if (total === 0) {
    return null;
  }

  if (counts.Safety === 0) {
    return "No safety schools. A list without one has no floor — every outcome depends on a school that can say no.";
  }

  if (counts.Reach / total > REACH_HEAVY_SHARE) {
    return "Most of this list is reaches. Adding two or three targets is the cheapest way to change the range of outcomes.";
  }

  return null;
}

export function ListBalanceBar({
  schools,
  listTypeFilter,
  onListTypeFilterChange,
}: {
  schools: School[];
  listTypeFilter: ListTypeFilter;
  onListTypeFilterChange: (filter: ListTypeFilter) => void;
}) {
  const counts: Record<ListType, number> = {
    Reach: schools.filter((school) => school.listType === "Reach").length,
    Safety: schools.filter((school) => school.listType === "Safety").length,
    Target: schools.filter((school) => school.listType === "Target").length,
  };
  const total = schools.length;
  const nudge = nudgeFor(counts, total);

  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-medium">Your list</h2>
        <span className="text-xs text-[var(--ink-muted)] tabular-nums">
          {total} {total === 1 ? "school" : "schools"}
        </span>
      </div>

      <div
        aria-hidden="true"
        className="flex h-2 gap-px overflow-hidden rounded-full bg-[var(--school-balance-track)]"
      >
        {SEGMENTS.map((segment) =>
          counts[segment.listType] === 0 ? null : (
            <div
              className={segment.bar}
              key={segment.listType}
              style={{
                width: `${(counts[segment.listType] / total) * 100}%`,
              }}
            />
          ),
        )}
      </div>

      {/* The legend is the list-type filter. Counts make it survive
       * greyscale, and a zero entry is disabled rather than hidden — a
       * missing Safety row would be the one fact worth showing. */}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
        {/* Explicit labels: flex gaps separate the word from the count
         * visually, but the accessible name would run them together into
         * "All4" without one. */}
        <button
          aria-label={`Show all ${total} schools`}
          aria-pressed={listTypeFilter === "all"}
          className={legendClassName(listTypeFilter === "all", false)}
          onClick={() => onListTypeFilterChange("all")}
          type="button"
        >
          All
          <span className="tabular-nums opacity-70">{total}</span>
        </button>
        {SEGMENTS.map((segment) => {
          const count = counts[segment.listType];
          const isActive = listTypeFilter === segment.filter;

          return (
            <button
              aria-label={`Show ${count} ${segment.listType} ${count === 1 ? "school" : "schools"}`}
              aria-pressed={isActive}
              className={legendClassName(isActive, count === 0)}
              disabled={count === 0}
              key={segment.listType}
              onClick={() => onListTypeFilterChange(segment.filter)}
              type="button"
            >
              <span
                aria-hidden="true"
                className={cn("size-2 rounded-full", segment.swatch)}
              />
              {segment.listType}
              <span className="tabular-nums opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      {nudge ? (
        <p className="flex items-start gap-2 rounded-lg bg-[var(--warning-surface)] px-3 py-2 text-xs leading-snug text-[var(--warning-fg)]">
          <TriangleAlert
            aria-hidden="true"
            className="mt-px size-3.5 shrink-0"
          />
          <span>
            {nudge}{" "}
            <Link
              className="inline-flex items-center gap-0.5 font-semibold underline underline-offset-2"
              to="/app/schools?tab=explore&sort=admit"
            >
              Find some in Explore
              <ArrowRight aria-hidden="true" className="size-3" />
            </Link>
          </span>
        </p>
      ) : null}
    </section>
  );
}

function legendClassName(isActive: boolean, isEmpty: boolean) {
  return cn(
    "inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] pointer-coarse:min-h-11",
    isActive
      ? "bg-[var(--school-filter-chip-active-surface)] text-[var(--school-filter-chip-active-ink)]"
      : "text-[var(--ink-secondary)] hover:bg-[var(--school-filter-chip-hover)]",
    isEmpty && "cursor-not-allowed opacity-50 hover:bg-transparent",
  );
}
