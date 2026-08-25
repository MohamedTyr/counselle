import { ChevronDown, Eye, UserRound } from "lucide-react";

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
import { sortOptions } from "@/features/schools/explore/explore-config";
import type {
  Exclusion,
  SortKey,
  StudentProfile,
} from "@/features/schools/explore/explore-types";

/*
 * One row, replacing the mockup's three stacked bands. Everything here is
 * about the result SET rather than any one school:
 *
 *   184 schools · [You: MA · SAT 1480] · 38 hidden, no admit rate [include]   [Sort]
 *
 * The exclusion chips are the most differentiating thing on the page. Every
 * range filter silently drops schools that are MISSING the metric, not just
 * schools that fail it — so each one says so and offers a one-click
 * override. No competitor tells you what its own search hid.
 */

const CHIP_CLASSNAME =
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-[var(--school-filter-chip-surface)] px-2 text-xs font-medium text-[var(--ink-secondary)] transition-colors outline-none hover:bg-[var(--school-filter-chip-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] pointer-coarse:min-h-11";

function PersonalizationChip({
  profile,
  states,
  onChange,
}: {
  profile: StudentProfile;
  states: string[];
  onChange: (profile: StudentProfile) => void;
}) {
  const summary = [
    profile.homeState ? `${profile.homeState} resident` : "No home state",
    profile.satScore ? `SAT ${profile.satScore}` : "no score",
  ].join(" · ");

  return (
    <Popover>
      {/* Load-bearing, so it lives at the point of consequence rather than
       * in settings: it picks which tuition row and which admit rate every
       * card below is showing. */}
      <PopoverTrigger className={CHIP_CLASSNAME}>
        <UserRound aria-hidden="true" className="size-3.5 opacity-70" />
        <span>You: {summary}</span>
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
                  ...profile,
                  homeState: value === "none" ? null : String(value),
                })
              }
              value={profile.homeState ?? "none"}
            >
              <SelectTrigger className="w-full" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not set</SelectItem>
                {states.map((state) => (
                  <SelectItem key={state} value={state}>
                    {state}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <NumberField
            max={1600}
            min={400}
            onValueChange={(value) => onChange({ ...profile, satScore: value })}
            size="sm"
            step={10}
            value={profile.satScore}
          >
            <Label className="text-xs text-[var(--ink-secondary)]">
              SAT total
            </Label>
            <NumberFieldGroup>
              <NumberFieldInput placeholder="Not set" />
            </NumberFieldGroup>
          </NumberField>

          <p className="text-xs text-[var(--ink-muted)]">
            Without a home state, public-school costs fall back to the
            out-of-state row and every card says so.
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
  return (
    <span className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-[var(--warning-surface)] px-2 text-xs text-[var(--warning-fg)]">
      <Eye aria-hidden="true" className="size-3.5 opacity-70" />
      <span className="tabular-nums">
        {exclusion.count} hidden — no {exclusion.metricLabel}
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

export function ExploreResultsHeader({
  count,
  profile,
  states,
  exclusions,
  sort,
  onProfileChange,
  onSortChange,
  onIncludeMissing,
}: {
  count: number;
  profile: StudentProfile;
  states: string[];
  exclusions: Exclusion[];
  sort: SortKey;
  onProfileChange: (profile: StudentProfile) => void;
  onSortChange: (sort: SortKey) => void;
  onIncludeMissing: (key: Exclusion["key"]) => void;
}) {
  const activeSort =
    sortOptions.find((option) => option.value === sort) ?? sortOptions[0];

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <p
        aria-live="polite"
        className="text-sm font-medium tabular-nums"
        role="status"
      >
        {count} {count === 1 ? "school" : "schools"}
      </p>

      <PersonalizationChip
        onChange={onProfileChange}
        profile={profile}
        states={states}
      />

      {exclusions.map((exclusion) => (
        <ExclusionChip
          exclusion={exclusion}
          key={exclusion.key}
          onInclude={() => onIncludeMissing(exclusion.key)}
        />
      ))}

      <DropdownMenu>
        <DropdownMenuTrigger className={`${CHIP_CLASSNAME} ms-auto`}>
          Sort: {activeSort.label}
          <ChevronDown aria-hidden="true" className="size-3 opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel>Sort by</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            onValueChange={(value) => onSortChange(value as SortKey)}
            value={sort}
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
  );
}
