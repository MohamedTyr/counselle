import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";

import type { Control, FilterOption } from "@/api/schools/explore";
import { useMajors } from "@/api/schools/explore";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverPopup } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  US_STATES,
  controlOptions,
  rangeDescriptorByKey,
  scoreFitOptions,
  sizeBucketOptions,
} from "@/features/schools/explore/explore-config";
import { CheckboxRow, FilterChip, RangeFields } from "@/features/schools/explore/explore-controls";
import { formatCurrency } from "@/features/schools/explore/explore-format";
import type {
  ExploreFilters,
  NumericRange,
  ScoreFit,
  SizeBucket,
  StudentProfile,
} from "@/features/schools/explore/explore-types";
import { cn } from "@/lib/utils";

/*
 * Tier 1 -- the questions someone actually opens a college search with:
 * where, what to study, how selective, how big, what kind, how much, can I
 * get in. Everything else is behind "More filters", because a dozen open
 * filter groups is a form, not a search.
 */

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}

function summarizeList(values: string[], max = 3) {
  if (values.length === 0) {
    return null;
  }

  return values.length <= max
    ? values.join(" · ")
    : `${values.slice(0, max).join(" · ")} +${values.length - max}`;
}

function summarizeRange(range: NumericRange, format: (value: number) => string) {
  if (range.min !== null && range.max !== null) {
    return `${format(range.min)}–${format(range.max)}`;
  }

  if (range.min !== null) {
    return `≥ ${format(range.min)}`;
  }

  return range.max === null ? null : `≤ ${format(range.max)}`;
}

const compactMoney = (value: number) =>
  value >= 1_000 ? `$${Math.round(value / 1_000)}k` : (formatCurrency(value) ?? "");

function RegionPopup({
  options,
  selected,
  onToggle,
}: {
  options: readonly FilterOption[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <Command>
      <CommandInput placeholder="Search regions…" />
      <CommandList>
        <CommandEmpty>No regions match.</CommandEmpty>
        <CommandGroup>
          {options.map((option) => (
            <CommandItem key={option.value} onSelect={() => onToggle(option.value)} value={option.value}>
              <Checkbox checked={selected.includes(option.value)} tabIndex={-1} />
              <div className="flex min-w-0 flex-col">
                <span className="truncate">{option.label}</span>
                {option.states ? (
                  <span className="truncate text-xs text-[var(--ink-muted)]">{option.states}</span>
                ) : null}
              </div>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

/** Sourced from `GET /v1/schools/majors` -- a student never types a name no
 *  school uses (plan §5.3), and the endpoint's own `majors_match_note`
 *  renders right under the list, since the combobox has to work before any
 *  Explore response has landed. */
function MajorPopup({
  value,
  onSelect,
}: {
  value: string | null;
  onSelect: (name: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const majors = useMajors(query);

  return (
    <Command shouldFilter={false}>
      <CommandInput onValueChange={setQuery} placeholder="Search majors…" value={query} />
      <CommandList>
        <CommandEmpty>
          {majors.isLoading ? "Searching…" : "No majors match that name."}
        </CommandEmpty>
        <CommandGroup>
          {value ? (
            <CommandItem onSelect={() => onSelect(null)} value={`clear-${value}`}>
              <Checkbox checked tabIndex={-1} />
              {value}
            </CommandItem>
          ) : null}
          {(majors.data?.majors ?? [])
            .filter((major) => major.name !== value)
            .map((major) => (
              <CommandItem key={major.name} onSelect={() => onSelect(major.name)} value={major.name}>
                <span className="min-w-0 flex-1 truncate">{major.name}</span>
                <span className="text-xs text-[var(--ink-muted)] tabular-nums">
                  {major.school_count}
                </span>
              </CommandItem>
            ))}
        </CommandGroup>
      </CommandList>
      {majors.data ? (
        <p className="border-t p-2.5 text-xs text-[var(--ink-muted)]">
          {majors.data.majors_match_note}
        </p>
      ) : null}
    </Command>
  );
}

type BarProps = {
  filters: ExploreFilters;
  profile: StudentProfile;
  regionOptions: readonly FilterOption[];
  controlCounts: Record<Control, number>;
  activeCount: number;
  panelOpen: boolean;
  onTogglePanel: () => void;
  onChange: (update: (current: ExploreFilters) => ExploreFilters) => void;
  onRangeChange: (key: "admit" | "cost", range: NumericRange) => void;
};

export function ExploreFilterBar({
  filters,
  profile,
  regionOptions,
  controlCounts,
  activeCount,
  panelOpen,
  onTogglePanel,
  onChange,
  onRangeChange,
}: BarProps) {
  const sizeSummary = summarizeList(
    filters.sizeBucket.map(
      (bucket) => sizeBucketOptions.find((option) => option.value === bucket)?.label ?? "",
    ),
    1,
  );
  const hasAnyScore = profile.satMath !== null || profile.satEbrw !== null || profile.act !== null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="-ms-6 flex max-w-full min-w-0 flex-1 items-center gap-2 overflow-x-auto ps-6 pe-3 pb-0.5 [mask-image:linear-gradient(to_right,black_calc(100%-1rem),transparent)] [scrollbar-width:none] md:ms-0 md:flex-wrap md:overflow-visible md:ps-0 md:pe-0 md:[mask-image:none]">
        <Popover>
          <FilterChip
            isActive={filters.states.length > 0}
            label="Location"
            value={summarizeList(filters.states)}
          />
          <PopoverPopup align="start" className="w-64">
            <Command>
              <CommandInput placeholder="Search states…" />
              <CommandList>
                <CommandEmpty>No states match.</CommandEmpty>
                <CommandGroup>
                  {US_STATES.map((state) => (
                    <CommandItem
                      key={state}
                      onSelect={() =>
                        onChange((current) => ({
                          ...current,
                          states: toggle(current.states, state),
                        }))
                      }
                      value={state}
                    >
                      <Checkbox checked={filters.states.includes(state)} tabIndex={-1} />
                      {state}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverPopup>
        </Popover>

        <Popover>
          <FilterChip
            isActive={filters.region.length > 0}
            label="Region"
            value={summarizeList(
              filters.region.map(
                (value) => regionOptions.find((option) => option.value === value)?.label ?? value,
              ),
              1,
            )}
          />
          <PopoverPopup align="start" className="w-72">
            <RegionPopup
              onToggle={(value) =>
                onChange((current) => ({ ...current, region: toggle(current.region, value) }))
              }
              options={regionOptions}
              selected={filters.region}
            />
          </PopoverPopup>
        </Popover>

        <Popover>
          <FilterChip isActive={filters.major !== null} label="Major" value={filters.major} />
          <PopoverPopup align="start" className="w-72">
            <MajorPopup
              onSelect={(name) => onChange((current) => ({ ...current, major: name }))}
              value={filters.major}
            />
          </PopoverPopup>
        </Popover>

        <Popover>
          <FilterChip
            isActive={filters.ranges.admit.min !== null || filters.ranges.admit.max !== null}
            label="Admit rate"
            value={summarizeRange(filters.ranges.admit, (value) => `${value}%`)}
          />
          <PopoverPopup align="start" className="w-72">
            <RangeFields
              descriptor={rangeDescriptorByKey.admit}
              onChange={(range) => onRangeChange("admit", range)}
              range={filters.ranges.admit}
            />
          </PopoverPopup>
        </Popover>

        <Popover>
          <FilterChip isActive={filters.sizeBucket.length > 0} label="Size" value={sizeSummary} />
          <PopoverPopup align="start" className="w-60">
            <div className="flex flex-col gap-2.5">
              {sizeBucketOptions.map((option) => (
                <CheckboxRow htmlFor={`size-${option.value}`} key={option.value}>
                  <Checkbox
                    checked={filters.sizeBucket.includes(option.value)}
                    id={`size-${option.value}`}
                    onCheckedChange={() =>
                      onChange((current) => ({
                        ...current,
                        sizeBucket: toggle<SizeBucket>(current.sizeBucket, option.value),
                      }))
                    }
                  />
                  {option.label}
                </CheckboxRow>
              ))}
            </div>
          </PopoverPopup>
        </Popover>

        <Popover>
          <FilterChip
            isActive={filters.control !== "any"}
            label="Type"
            value={controlOptions.find((option) => option.value === filters.control)?.label ?? null}
          />
          <PopoverPopup align="start" className="w-56">
            <RadioGroup
              aria-label="School ownership"
              onValueChange={(value) =>
                onChange((current) => ({ ...current, control: value as ExploreFilters["control"] }))
              }
              value={filters.control}
            >
              {controlOptions.map((option) => (
                <CheckboxRow htmlFor={`control-${option.value}`} key={option.value}>
                  <RadioGroupItem id={`control-${option.value}`} value={option.value} />
                  {option.label}
                  {option.value === "any" ? null : (
                    <span className="ml-auto text-xs text-[var(--ink-muted)] tabular-nums">
                      {controlCounts[option.value as Control]}
                    </span>
                  )}
                </CheckboxRow>
              ))}
            </RadioGroup>
          </PopoverPopup>
        </Popover>

        <Popover>
          <FilterChip
            isActive={filters.ranges.cost.min !== null || filters.ranges.cost.max !== null}
            label="Your cost"
            value={summarizeRange(filters.ranges.cost, compactMoney)}
          />
          <PopoverPopup align="start" className="w-72">
            <div className="flex flex-col gap-2.5">
              <RangeFields
                descriptor={rangeDescriptorByKey.cost}
                onChange={(range) => onRangeChange("cost", range)}
                range={filters.ranges.cost}
              />
              <p className="text-xs text-[var(--ink-muted)]">
                {profile.homeState
                  ? `Public schools show the ${profile.homeState} resident row.`
                  : "Set your home state above to get the resident tuition row for public schools."}
              </p>
            </div>
          </PopoverPopup>
        </Popover>

        <Popover>
          <FilterChip
            disabled={!hasAnyScore}
            isActive={filters.scoreFit !== "any"}
            label="Score fit"
            title={hasAnyScore ? undefined : "Add a score in the results header to use this filter."}
            value={
              filters.scoreFit === "any"
                ? null
                : (scoreFitOptions.find((option) => option.value === filters.scoreFit)?.label ??
                  null)
            }
          />
          <PopoverPopup align="start" className="w-72">
            <RadioGroup
              aria-label="Score fit"
              onValueChange={(value) =>
                onChange((current) => ({ ...current, scoreFit: value as ScoreFit }))
              }
              value={filters.scoreFit}
            >
              {scoreFitOptions.map((option) => (
                <CheckboxRow htmlFor={`scorefit-${option.value}`} key={option.value}>
                  <RadioGroupItem id={`scorefit-${option.value}`} value={option.value} />
                  {option.label}
                </CheckboxRow>
              ))}
            </RadioGroup>
            <p className="mt-2.5 text-xs text-[var(--ink-muted)]">
              Your scores pick which band each card shows. Setting this is what makes them filter
              the list.
            </p>
          </PopoverPopup>
        </Popover>
      </div>

      <button
        aria-controls="explore-filter-panel"
        aria-expanded={panelOpen}
        className={cn(
          "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] pointer-coarse:min-h-11",
          panelOpen || activeCount > 0
            ? "border-[var(--school-filter-chip-active-border)] bg-[var(--school-filter-chip-active-surface)] text-[var(--school-filter-chip-active-ink)]"
            : "border-transparent bg-[var(--school-filter-chip-surface)] text-[var(--ink-secondary)] hover:bg-[var(--school-filter-chip-hover)]",
        )}
        onClick={onTogglePanel}
        type="button"
      >
        <SlidersHorizontal aria-hidden="true" className="size-3.5 opacity-70" />
        More filters
        {activeCount > 0 ? <span className="tabular-nums">{activeCount}</span> : null}
      </button>
    </div>
  );
}
