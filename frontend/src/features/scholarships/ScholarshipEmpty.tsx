import { Coins, SearchX, Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  FILTER_LABELS,
  type FilterKey,
} from "@/features/scholarships/scholarship-filters";

const PANEL = "rounded-xl border border-[var(--edge)] bg-[var(--surface-raised)] py-14 shadow-[var(--elevation-1)]";

/** Nothing is published yet: no filter can help, so none is suggested. */
export function NothingPublishedEmpty() {
  return (
    <Empty className={PANEL}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Coins />
        </EmptyMedia>
        <EmptyTitle>No scholarships yet</EmptyTitle>
      </EmptyHeader>
    </Empty>
  );
}

export function SavedEmpty({ onBrowse }: { onBrowse: () => void }) {
  return (
    <Empty className={PANEL}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Star />
        </EmptyMedia>
        <EmptyTitle>No saved scholarships yet</EmptyTitle>
        <EmptyDescription>Save a scholarship to keep it here with its deadline.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={onBrowse} size="sm">
          See scholarships for you
        </Button>
      </EmptyContent>
    </Empty>
  );
}

export function FilteredEmpty({
  narrowest,
  query,
  onRelax,
  onClearAll,
  onClearQuery,
}: {
  narrowest: { key: FilterKey; count: number } | null;
  query: string;
  onRelax: (key: FilterKey) => void;
  onClearAll: () => void;
  onClearQuery: () => void;
}) {
  const label = narrowest ? FILTER_LABELS[narrowest.key] : null;
  return (
    <Empty className={PANEL}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchX />
        </EmptyMedia>
        <EmptyTitle>No scholarships match</EmptyTitle>
        <EmptyDescription>
          {narrowest && label
            ? `${label} is the narrowest filter — ${narrowest.count} ${narrowest.count === 1 ? "scholarship matches" : "scholarships match"} everything else.`
            : query.trim()
              ? `Nothing matches “${query.trim()}” with these filters.`
              : "Try fewer filters."}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center gap-2">
        {narrowest && label ? (
          <Button onClick={() => onRelax(narrowest.key)} size="sm">
            {narrowest.key === "noEssay" || narrowest.key === "renewable" ? `Turn off ${label}` : `Relax ${label.toLowerCase()}`}
          </Button>
        ) : query.trim() ? (
          <Button onClick={onClearQuery} size="sm">
            Clear search
          </Button>
        ) : null}
        <Button onClick={onClearAll} size="sm" variant="outline">
          Clear all filters
        </Button>
      </EmptyContent>
    </Empty>
  );
}
