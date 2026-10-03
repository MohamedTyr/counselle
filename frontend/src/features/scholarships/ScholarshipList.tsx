import { ChevronRight } from "lucide-react";
import { useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import type { Listed, ScholarshipSort } from "@/features/scholarships/scholarship-filters";
import { deadlineGroup } from "@/features/scholarships/scholarship-format";
import { ScholarshipRow } from "@/features/scholarships/ScholarshipRow";
import { cn } from "@/lib/utils";

const STAGGER_CAP = 8;
const STAGGER_STEP_MS = 30;

type Group = { label: string | null; rows: Listed[] };

function groupRows(rows: Listed[], sort: ScholarshipSort): Group[] {
  if (sort !== "deadline") return [{ label: null, rows }];
  const groups: Group[] = [];
  for (const row of rows) {
    const label = deadlineGroup(row.item.deadline);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.rows.push(row);
    else groups.push({ label, rows: [row] });
  }
  return groups;
}

type RowProps = {
  selectedId: string | null;
  savedIds: readonly string[];
  onSelect: (id: string) => void;
  animate: boolean;
};

function Rows({ rows, offset, selectedId, savedIds, onSelect, animate }: RowProps & { rows: Listed[]; offset: number }) {
  return (
    <ul className="flex flex-col gap-px">
      {rows.map((row, index) => {
        const position = offset + index;
        return (
          <ScholarshipRow
            enterDelayMs={animate && position < STAGGER_CAP ? position * STAGGER_STEP_MS : null}
            fit={row.fit}
            isSaved={savedIds.includes(row.item.id)}
            isSelected={row.item.id === selectedId}
            key={row.item.id}
            onSelect={() => onSelect(row.item.id)}
            scholarship={row.item}
          />
        );
      })}
    </ul>
  );
}

function GroupHeading({ label, count }: { label: string; count: number }) {
  return (
    <h3 className="sticky top-0 z-[var(--z-sticky)] flex items-baseline gap-2 bg-[var(--surface-raised)] px-3 pt-4 pb-1.5 text-xs font-medium text-[var(--scholarship-group-ink)]">
      <span>{label}</span>
      <span className="tabular-nums text-[var(--ink-faint)]">{count}</span>
    </h3>
  );
}

export function ScholarshipList({
  open,
  closed,
  sort,
  hiddenIneligible,
  onShowAll,
  ...rowProps
}: RowProps & {
  open: Listed[];
  closed: Listed[];
  sort: ScholarshipSort;
  hiddenIneligible: number;
  onShowAll: () => void;
}) {
  const [showClosed, setShowClosed] = useState(false);
  const groups = groupRows(open, sort);
  const starts = groups.map((_, index) =>
    groups.slice(0, index).reduce((sum, group) => sum + group.rows.length, 0),
  );

  return (
    <div className="rounded-xl border border-[var(--edge)] bg-[var(--surface-raised)] p-1.5 pb-2 shadow-[var(--elevation-1)]">
      {groups.map((group, index) => {
        const start = starts[index];
        return (
          <section aria-label={group.label ?? "Scholarships"} key={group.label ?? "all"}>
            {group.label ? <GroupHeading count={group.rows.length} label={group.label} /> : null}
            <Rows {...rowProps} offset={start} rows={group.rows} />
          </section>
        );
      })}

      {closed.length > 0 ? (
        <section className="mt-2 border-t border-[var(--hairline)] pt-1.5">
          <button
            aria-expanded={showClosed}
            className="flex w-full cursor-pointer items-center gap-1.5 rounded-lg px-3 py-2 text-left text-xs font-medium text-[var(--ink-muted)] outline-none transition-colors hover:bg-[var(--scholarship-row-hover)] hover:text-[var(--ink-secondary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            onClick={() => setShowClosed((value) => !value)}
            type="button"
          >
            <ChevronRight
              aria-hidden="true"
              className={cn("size-3.5 transition-transform duration-200", showClosed && "rotate-90")}
            />
            Closed this cycle
            <span className="tabular-nums text-[var(--ink-faint)]">{closed.length}</span>
          </button>
          {showClosed ? <Rows {...rowProps} animate={false} offset={0} rows={closed} /> : null}
        </section>
      ) : null}

      {hiddenIneligible > 0 ? (
        <p className="mt-2 border-t border-[var(--hairline)] px-3 pt-3 pb-1 text-xs text-[var(--ink-muted)]">
          {hiddenIneligible === 1 ? "1 more scholarship" : `${hiddenIneligible} more scholarships`} you
          don't fit, based on your profile.{" "}
          <button
            className="cursor-pointer font-medium text-[var(--ink-secondary)] underline decoration-[var(--edge-strong)] underline-offset-2 outline-none hover:text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            onClick={onShowAll}
            type="button"
          >
            Show all scholarships
          </button>
        </p>
      ) : null}
    </div>
  );
}

export function ScholarshipListSkeleton() {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-[var(--edge)] bg-[var(--surface-raised)] p-3 shadow-[var(--elevation-1)]">
      <Skeleton className="mb-2 h-3 w-28" />
      {Array.from({ length: 7 }, (_, index) => (
        <div className="grid grid-cols-[auto_minmax(0,1fr)_7rem_5.5rem] items-center gap-4 py-2.5" key={index}>
          <Skeleton className="size-9 rounded-lg" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3.5 w-3/5" />
            <Skeleton className="h-3 w-2/5" />
          </div>
          <Skeleton className="ml-auto h-4 w-16" />
          <Skeleton className="ml-auto h-3.5 w-12" />
        </div>
      ))}
    </div>
  );
}
