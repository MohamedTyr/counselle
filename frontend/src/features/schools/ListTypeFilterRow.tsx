import type { ListType, School } from "@/domain/school";
import type { ListTypeFilter } from "@/features/schools/schools-types";
import { cn } from "@/lib/utils";

/*
 * The list's header is one row: how many schools are on it, and the three
 * types you can filter it down to. The distribution bar and the balance
 * nudge that used to sit here said more than the row is worth — the table
 * below is the thing being read.
 */

const SEGMENTS: {
  listType: ListType;
  filter: ListTypeFilter;
  swatch: string;
}[] = [
  {
    filter: "reach",
    listType: "Reach",
    swatch: "bg-[var(--school-balance-reach)]",
  },
  {
    filter: "target",
    listType: "Target",
    swatch: "bg-[var(--school-balance-target)]",
  },
  {
    filter: "safety",
    listType: "Safety",
    swatch: "bg-[var(--school-balance-safety)]",
  },
];

export function ListTypeFilterRow({
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

  return (
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
      {/* A zero entry is disabled rather than hidden — a missing Safety row
       * would be the one fact worth showing. */}
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
