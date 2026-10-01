import { useState } from "react";
import type React from "react";
import { CheckIcon } from "lucide-react";

import { Card } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import {
  CLASS_LABELS,
  channelLabel,
  UNTAGGED,
  WHO_LABELS,
  type Facets,
  type Filters,
} from "./derive";

const CHANNEL_PREVIEW = 5;

type Facet = "channel" | "who" | "class";
type Item = { value: string; label: string; count: number; muted: boolean };

const TITLES: Record<Facet, string> = {
  channel: "Channel",
  who: "Who",
  class: "Class of",
};
const FACETS = Object.keys(TITLES) as Facet[];

function items(facets: Facets, facet: Facet): Item[] {
  switch (facet) {
    case "channel":
      return facets.channel.map(({ value, count }) => ({
        value,
        count,
        label: channelLabel(value),
        muted: value === UNTAGGED,
      }));
    case "who":
      return facets.who.map(({ value, count }) => ({
        value,
        count,
        label: WHO_LABELS[value],
        muted: value === "unanswered",
      }));
    case "class":
      return facets.class.map(({ value, count }) => ({
        value,
        count,
        label: CLASS_LABELS[value],
        muted: value === "unanswered",
      }));
  }
}

function FacetRow({
  item,
  max,
  selected,
  onToggle,
}: {
  item: Item;
  max: number;
  selected: boolean;
  onToggle: () => void;
}) {
  const share = max > 0 ? (item.count / max) * 100 : 0;
  return (
    <li>
      <button
        aria-pressed={selected}
        className={cn(
          "grid w-full cursor-pointer grid-cols-[1rem_minmax(0,1fr)_auto_3.5rem] items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-150 ease-out outline-none hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-ring active:bg-[var(--surface-active)] motion-reduce:transition-none pointer-coarse:min-h-11",
          selected && "bg-[var(--surface-selected)] font-medium",
        )}
        onClick={onToggle}
        type="button"
      >
        <span aria-hidden="true" className="flex">
          {selected ? <CheckIcon className="size-3.5" /> : null}
        </span>
        <span className={cn("truncate", item.muted && "text-muted-foreground")}>
          {item.label}
        </span>
        <span className="tabular-nums">{item.count.toLocaleString()}</span>
        <span
          aria-hidden="true"
          className="h-1.5 overflow-hidden rounded-full bg-[var(--control-track)]"
        >
          <span
            className="block h-full rounded-full bg-[var(--waitlist-chart-mark)]"
            style={{ width: `${share}%` }}
          />
        </span>
      </button>
    </li>
  );
}

function FacetColumn({
  facet,
  facets,
  selected,
  onToggle,
  showTitle,
}: {
  facet: Facet;
  facets: Facets;
  selected: string | null;
  onToggle: (value: string) => void;
  showTitle: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const all = items(facets, facet);
  const max = all.reduce((m, item) => Math.max(m, item.count), 0);
  const long = facet === "channel" && all.length > CHANNEL_PREVIEW;
  let shown = long && !expanded ? all.slice(0, CHANNEL_PREVIEW) : all;
  // A selected value never hides behind the disclosure.
  const pinned = all.find((item) => item.value === selected);
  if (pinned && !shown.includes(pinned)) shown = [...shown, pinned];

  const titleId = `facet-${facet}`;
  return (
    <div className="flex min-w-0 flex-col gap-1 p-3">
      {showTitle ? (
        <h2
          className="px-2 pb-1 text-sm font-medium text-muted-foreground"
          id={titleId}
        >
          {TITLES[facet]}
        </h2>
      ) : null}
      {all.length === 0 ? (
        <p className="px-2 py-1.5 text-sm text-muted-foreground">
          No signups match
        </p>
      ) : (
        <ul
          aria-label={showTitle ? undefined : TITLES[facet]}
          aria-labelledby={showTitle ? titleId : undefined}
          className="flex flex-col"
        >
          {shown.map((item) => (
            <FacetRow
              item={item}
              key={item.value}
              max={max}
              onToggle={() => onToggle(item.value)}
              selected={item.value === selected}
            />
          ))}
        </ul>
      )}
      {long ? (
        <button
          aria-expanded={expanded}
          className="w-fit cursor-pointer rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors duration-150 ease-out outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
          onClick={() => setExpanded((open) => !open)}
          type="button"
        >
          {expanded ? "Show fewer" : `Show all ${all.length}`}
        </button>
      ) : null}
    </div>
  );
}

/** The page's one raised surface. Each row is a toggle filter, so the
 * overview is also the way into the list. */
export function Composition({
  facets,
  filters,
  onChange,
}: {
  facets: Facets;
  filters: Filters;
  onChange: (patch: Partial<Filters>) => void;
}): React.ReactElement {
  const isMobile = useIsMobile();
  const [breakdown, setBreakdown] = useState<Facet>("channel");

  const column = (facet: Facet, showTitle: boolean) => (
    <FacetColumn
      facet={facet}
      facets={facets}
      key={facet}
      onToggle={(value) =>
        onChange({ [facet]: filters[facet] === value ? null : value })
      }
      selected={filters[facet]}
      showTitle={showTitle}
    />
  );

  return (
    <Card render={<section aria-label="Breakdown" />}>
      {isMobile ? (
        <div className="flex flex-col gap-1 pt-3">
          <SegmentedControl
            className="mx-3"
            label="Breakdown"
            onValueChange={setBreakdown}
            options={FACETS.map((facet) => ({
              value: facet,
              label: TITLES[facet],
            }))}
            value={breakdown}
          />
          {column(breakdown, false)}
        </div>
      ) : (
        <div className="grid grid-cols-3 divide-x">
          {FACETS.map((facet) => column(facet, true))}
        </div>
      )}
    </Card>
  );
}
