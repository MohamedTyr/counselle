import { ChevronRight } from "lucide-react";
import { useId, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import type { Listed, ScholarshipSort } from "./scholarship-filters";
import { deadlineGroup } from "./scholarship-format";
import { ScholarshipCard } from "./ScholarshipCard";
import { useScholarshipKeys } from "./use-scholarship-keys";

type CardProps = {
  selectedId: string | null;
  savedIds: readonly string[];
  onSelect: (id: string, opener: HTMLButtonElement) => void;
  onToggleSave: (id: string) => void;
  showFit: boolean;
};

function Cards({
  rows,
  selectedId,
  savedIds,
  onSelect,
  onToggleSave,
  showFit,
}: CardProps & { rows: Listed[] }) {
  return (
    <ul className="scholarship-card-grid">
      {rows.map(({ item, fit }) => (
        <ScholarshipCard
          key={item.id}
          scholarship={item}
          fit={showFit ? fit : undefined}
          isSaved={savedIds.includes(item.id)}
          isSelected={selectedId === item.id}
          onSelect={(opener) => onSelect(item.id, opener)}
          onToggleSave={() => onToggleSave(item.id)}
        />
      ))}
    </ul>
  );
}

function groupRows(rows: Listed[], sort: ScholarshipSort) {
  if (sort !== "deadline") return [{ label: "Scholarships", rows }];
  return rows.reduce<{ label: string; rows: Listed[] }[]>((groups, row) => {
    const label = deadlineGroup(row.item.deadline);
    return groups.some((group) => group.label === label)
      ? groups.map((group) =>
          group.label === label
            ? { ...group, rows: [...group.rows, row] }
            : group,
        )
      : [...groups, { label, rows: [row] }];
  }, []);
}

export function ScholarshipList({
  open,
  closed,
  sort,
  hiddenIneligible,
  onShowAll,
  ...cardProps
}: CardProps & {
  open: Listed[];
  closed: Listed[];
  sort: ScholarshipSort;
  hiddenIneligible: number;
  onShowAll: () => void;
}) {
  const [showClosed, setShowClosed] = useState(false);
  const closedId = useId();
  const onKeyDown = useScholarshipKeys({
    onToggleSave: cardProps.onToggleSave,
  });
  return (
    <div className="scholarship-collection" onKeyDown={onKeyDown}>
      {groupRows(open, sort)
        .filter((group) => group.rows.length)
        .map((group) => (
          <section key={group.label} aria-label={group.label}>
            <div className="scholarship-group-heading">
              <h2>{group.label}</h2>
              <span>
                {group.rows.length}{" "}
                {group.rows.length === 1 ? "opportunity" : "opportunities"}
              </span>
            </div>
            <Cards {...cardProps} rows={group.rows} />
          </section>
        ))}
      {closed.length ? (
        <section>
          <h2>
            <button
              className="scholarship-closed-toggle"
              type="button"
              aria-expanded={showClosed}
              aria-controls={closedId}
              onClick={() => setShowClosed(!showClosed)}
            >
              <ChevronRight
                aria-hidden="true"
                size={16}
                className={showClosed ? "rotate-90" : undefined}
              />
              Closed this cycle <span>{closed.length}</span>
            </button>
          </h2>
          <div id={closedId} hidden={!showClosed}>
            {showClosed ? <Cards {...cardProps} rows={closed} /> : null}
          </div>
        </section>
      ) : null}
      {hiddenIneligible > 0 ? (
        <p className="scholarship-hidden-note">
          {hiddenIneligible} more{" "}
          {hiddenIneligible === 1
            ? "scholarship doesn't"
            : "scholarships don't"}{" "}
          fit your profile.{" "}
          <button type="button" onClick={onShowAll}>
            Show all scholarships
          </button>
        </p>
      ) : null}
    </div>
  );
}

export function ScholarshipListSkeleton() {
  return (
    <div
      className="scholarship-collection"
      role="status"
      aria-label="Loading scholarships"
    >
      <Skeleton className="h-4 w-32" />
      <div className="scholarship-card-grid" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            className="scholarship-card scholarship-card-skeleton"
            key={index}
          >
            <div className="flex items-center justify-between">
              <Skeleton className="size-11 rounded-xl" />
              <Skeleton className="h-7 w-16 rounded-full" />
            </div>
            <div>
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="mt-2.5 h-3 w-3/5" />
              <Skeleton className="mt-3 h-3 w-full" />
            </div>
            <div className="mt-auto grid grid-cols-2 gap-3.5">
              <Skeleton className="h-11 w-24" />
              <Skeleton className="h-11 w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
