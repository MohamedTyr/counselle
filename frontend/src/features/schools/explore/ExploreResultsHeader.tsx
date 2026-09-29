import { ChevronDown, Eye, UserRound } from "lucide-react";

import type { Exclusion, NullTail } from "@/api/schools/explore";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import {
  NumberField,
  NumberFieldGroup,
  NumberFieldInput,
} from "@/components/ui/number-field";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  US_STATES,
  sortOptions,
} from "@/features/schools/explore/explore-config";
import type {
  ExploreAssumptions,
  RangeKey,
  SortDirection,
  SortKey,
} from "@/features/schools/explore/explore-types";

/*
 * One row, plus the universe line and the once-per-screen band caption
 * beneath it -- everything here is about the result SET rather than any
 * one school.
 *
 * The exclusion chips are the most differentiating thing on the page.
 * Every filter over a column we might not hold silently drops schools we
 * have no value for, not just schools that fail it -- so each one says so
 * and offers a one-click override. No competitor tells you what its own
 * search hid.
 */

const CHIP_CLASSNAME =
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-[var(--school-filter-chip-surface)] px-2 text-xs font-medium text-[var(--ink-secondary)] transition-colors outline-none hover:bg-[var(--school-filter-chip-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] pointer-coarse:min-h-11";

function ExploreAssumptionsChip({
  assumptions,
  onChange,
}: {
  assumptions: ExploreAssumptions;
  onChange: (assumptions: ExploreAssumptions) => void;
}) {
  const scoreCount = [
    assumptions.satMath,
    assumptions.satEbrw,
    assumptions.act,
  ].filter((value) => value !== null).length;
  const summary = [
    assumptions.homeState
      ? `${assumptions.homeState} resident`
      : "No home state",
    scoreCount > 0
      ? `${scoreCount} score${scoreCount === 1 ? "" : "s"} set`
      : "no scores",
  ].join(" · ");

  return (
    <Popover>
      {/* Load-bearing, so it lives at the point of consequence rather than
       * in settings: it picks which tuition row and which score band every
       * card below is showing. */}
      <PopoverTrigger className={CHIP_CLASSNAME}>
        <UserRound aria-hidden="true" className="size-3.5 opacity-70" />
        <span>Explore preview: {summary}</span>
        <ChevronDown aria-hidden="true" className="size-3 opacity-60" />
      </PopoverTrigger>
      <PopoverPopup align="start" className="w-64">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-[var(--ink-secondary)]">
              Home state
            </Label>
            <Select
              onValueChange={(value) =>
                onChange({
                  ...assumptions,
                  homeState: value === "none" ? null : String(value),
                })
              }
              value={assumptions.homeState ?? "none"}
            >
              <SelectTrigger className="w-full" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not set</SelectItem>
                {US_STATES.map((state) => (
                  <SelectItem key={state} value={state}>
                    {state}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <NumberField
            max={800}
            min={200}
            onValueChange={(value) =>
              onChange({ ...assumptions, satMath: value })
            }
            size="sm"
            step={10}
            value={assumptions.satMath}
          >
            <Label className="text-xs text-[var(--ink-secondary)]">
              SAT Math
            </Label>
            <NumberFieldGroup>
              <NumberFieldInput placeholder="Not set" />
            </NumberFieldGroup>
          </NumberField>

          <NumberField
            max={800}
            min={200}
            onValueChange={(value) =>
              onChange({ ...assumptions, satEbrw: value })
            }
            size="sm"
            step={10}
            value={assumptions.satEbrw}
          >
            <Label className="text-xs text-[var(--ink-secondary)]">
              SAT EBRW
            </Label>
            <NumberFieldGroup>
              <NumberFieldInput placeholder="Not set" />
            </NumberFieldGroup>
          </NumberField>

          <NumberField
            max={36}
            min={1}
            onValueChange={(value) => onChange({ ...assumptions, act: value })}
            size="sm"
            step={1}
            value={assumptions.act}
          >
            <Label className="text-xs text-[var(--ink-secondary)]">ACT</Label>
            <NumberFieldGroup>
              <NumberFieldInput placeholder="Not set" />
            </NumberFieldGroup>
          </NumberField>

          <p className="text-xs text-[var(--ink-muted)]">
            These pick which tuition row and score band each card shows, and
            what the score filter compares against.
          </p>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function ExclusionChip({
  exclusion,
  onInclude,
}: {
  exclusion: Exclusion;
  onInclude: () => void;
}) {
  const word =
    exclusion.reason === "not_reported" ? "not reported" : "not available";

  return (
    <span className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-[var(--warning-surface)] px-2 text-xs text-[var(--warning-fg)]">
      <Eye aria-hidden="true" className="size-3.5 opacity-70" />
      <span className="tabular-nums">
        {exclusion.count} hidden — {exclusion.metric_label} {word}
      </span>
      <button
        className="rounded-sm px-1 font-semibold underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
        onClick={onInclude}
        type="button"
      >
        include
      </button>
    </span>
  );
}

/** Rows sorted to the end because they hold no value for the sort column
 *  are not hidden, and there is nothing to "include" -- so this is its own
 *  chip shape, never `ExclusionChip`'s. */
function NullTailChip({ tail }: { tail: NullTail }) {
  return (
    <span className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-[var(--school-filter-chip-surface)] px-2 text-xs text-[var(--ink-secondary)] tabular-nums">
      {tail.count} with no {tail.metric_label} — sorted to the end
    </span>
  );
}

function formatMonthYear(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function ExploreResultsHeader({
  total,
  totalIsCapped,
  factsObservedFrom,
  assumptions,
  exclusions,
  sortedNullTail,
  sort,
  onAssumptionsChange,
  onSortChange,
  onIncludeMissing,
}: {
  total: number;
  totalIsCapped: boolean;
  factsObservedFrom: string | null;
  assumptions: ExploreAssumptions;
  exclusions: Exclusion[];
  sortedNullTail: NullTail | null;
  sort: { key: SortKey; direction: SortDirection };
  onAssumptionsChange: (assumptions: ExploreAssumptions) => void;
  onSortChange: (sort: { key: SortKey; direction: SortDirection }) => void;
  onIncludeMissing: (key: RangeKey) => void;
}) {
  const activeSort =
    sortOptions.find((option) => option.value === sort.key) ?? sortOptions[0];
  const resultCount = totalIsCapped
    ? `${total}+ schools`
    : `${total} ${total === 1 ? "school" : "schools"}`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p
          aria-live="polite"
          className="text-sm font-medium tabular-nums"
          role="status"
        >
          {resultCount}
        </p>

        <ExploreAssumptionsChip
          onChange={onAssumptionsChange}
          assumptions={assumptions}
        />

        {exclusions.map((exclusion) => (
          <ExclusionChip
            exclusion={exclusion}
            key={exclusion.key}
            onInclude={() => onIncludeMissing(exclusion.key as RangeKey)}
          />
        ))}

        {sortedNullTail ? <NullTailChip tail={sortedNullTail} /> : null}

        <DropdownMenu>
          <DropdownMenuTrigger className={`${CHIP_CLASSNAME} ms-auto`}>
            Sort: {activeSort.label}
            <ChevronDown aria-hidden="true" className="size-3 opacity-60" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Sort by</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              onValueChange={(value) =>
                onSortChange({
                  direction: sort.direction,
                  key: value as SortKey,
                })
              }
              value={sort.key}
            >
              {sortOptions.map((option) => (
                <DropdownMenuRadioItem key={option.value} value={option.value}>
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {factsObservedFrom ? (
        <p className="text-xs text-[var(--ink-muted)]">
          Some of these values were last checked{" "}
          {formatMonthYear(factsObservedFrom)} and may be out of date.
        </p>
      ) : null}
    </div>
  );
}
