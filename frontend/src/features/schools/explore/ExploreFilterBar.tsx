import { SlidersHorizontal } from "lucide-react";

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
  controlOptions,
  rangeDescriptorByKey,
  sizeBucketOptions,
  testFitOptions,
} from "@/features/schools/explore/explore-config";
import {
  CheckboxRow,
  FilterChip,
  RangeFields,
} from "@/features/schools/explore/explore-controls";
import { formatCurrency } from "@/features/schools/explore/explore-format";
import type {
  Control,
  ControlFilter,
  ExploreFilters,
  NumericRange,
  SizeBucket,
  StudentProfile,
  TestFitPreset,
} from "@/features/schools/explore/explore-types";
import { cn } from "@/lib/utils";

/*
 * Tier 1 — the six questions someone actually opens a college search with:
 * where, how selective, how big, what kind, how much, can I get in.
 * Everything else is behind "More filters", because seven open filter
 * groups is a form, not a search.
 */

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((entry) => entry !== value)
    : [...list, value];
}

function summarizeList(values: string[], max = 3) {
  if (values.length === 0) {
    return null;
  }

  return values.length <= max
    ? values.join(" · ")
    : `${values.slice(0, max).join(" · ")} +${values.length - max}`;
}

function summarizeRange(
  range: NumericRange,
  format: (value: number) => string,
) {
  if (range.min !== null && range.max !== null) {
    return `${format(range.min)}–${format(range.max)}`;
  }

  if (range.min !== null) {
    return `≥ ${format(range.min)}`;
  }

  return range.max === null ? null : `≤ ${format(range.max)}`;
}

const compactMoney = (value: number) =>
  value >= 1_000
    ? `$${Math.round(value / 1_000)}k`
    : (formatCurrency(value) ?? "");

type BarProps = {
  filters: ExploreFilters;
  profile: StudentProfile;
  /** The states present in the catalog, so the filter can never offer one
   *  that matches nothing. */
  states: string[];
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
  states,
  controlCounts,
  activeCount,
  panelOpen,
  onTogglePanel,
  onChange,
  onRangeChange,
}: BarProps) {
  const sizeSummary = summarizeList(
    filters.sizes.map(
      (bucket) =>
        sizeBucketOptions.find((option) => option.value === bucket)?.label ??
        "",
    ),
    1,
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Below md the bar scrolls horizontally rather than wrapping to three
       * rows and pushing every card below the fold. The bleed is LEFT only
       * (-ms-6/ps-6): bleeding right as well pushed the scroll track under
       * the More-filters button, so the last chip collided with it. The
       * mask fades the final chip out instead of clipping it, which is what
       * says "there is more here" without a scrollbar. */}
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
                  {states.map((state) => (
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
                      <Checkbox
                        checked={filters.states.includes(state)}
                        tabIndex={-1}
                      />
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
            isActive={
              filters.ranges.admit.min !== null ||
              filters.ranges.admit.max !== null
            }
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
          <FilterChip
            isActive={filters.sizes.length > 0}
            label="Size"
            value={sizeSummary}
          />
          <PopoverPopup align="start" className="w-60">
            <div className="flex flex-col gap-2.5">
              {sizeBucketOptions.map((option) => (
                <CheckboxRow
                  htmlFor={`size-${option.value}`}
                  key={option.value}
                >
                  <Checkbox
                    checked={filters.sizes.includes(option.value)}
                    id={`size-${option.value}`}
                    onCheckedChange={() =>
                      onChange((current) => ({
                        ...current,
                        sizes: toggle<SizeBucket>(current.sizes, option.value),
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
            value={
              filters.control === "any"
                ? null
                : filters.control === "public"
                  ? "Public"
                  : "Private"
            }
          />
          <PopoverPopup align="start" className="w-52">
            {/* Facet counts on enums only — never on ranges, where the
             * query cost isn't worth it and the number moves under the
             * user's cursor. */}
            <RadioGroup
              aria-label="Public or private"
              onValueChange={(value) =>
                onChange((current) => ({
                  ...current,
                  control: value as ControlFilter,
                }))
              }
              value={filters.control}
            >
              {controlOptions.map((option) => (
                <CheckboxRow
                  htmlFor={`control-${option.value}`}
                  key={option.value}
                >
                  <RadioGroupItem
                    id={`control-${option.value}`}
                    value={option.value}
                  />
                  {option.label}
                  {option.value === "any" ? null : (
                    <span className="ml-auto text-xs text-[var(--ink-muted)] tabular-nums">
                      {option.value === "public"
                        ? controlCounts.public
                        : controlCounts.private}
                    </span>
                  )}
                </CheckboxRow>
              ))}
            </RadioGroup>
          </PopoverPopup>
        </Popover>

        <Popover>
          <FilterChip
            isActive={
              filters.ranges.cost.min !== null ||
              filters.ranges.cost.max !== null
            }
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
                Published sticker price.{" "}
                {profile.homeState
                  ? `Public schools show the ${profile.homeState} resident row.`
                  : "Set your home state above to get the resident tuition row for public schools."}
              </p>
            </div>
          </PopoverPopup>
        </Popover>

        <Popover>
          <FilterChip
            disabled={profile.satScore === null}
            isActive={filters.testFit !== "any"}
            label="Test fit"
            title={
              profile.satScore === null
                ? "Add your SAT score in the results header to use this filter."
                : undefined
            }
            value={
              filters.testFit === "any"
                ? null
                : (testFitOptions.find(
                    (option) => option.value === filters.testFit,
                  )?.label ?? null)
            }
          />
          <PopoverPopup align="start" className="w-72">
            <RadioGroup
              aria-label="Test range fit"
              onValueChange={(value) =>
                onChange((current) => ({
                  ...current,
                  testFit: value as TestFitPreset,
                }))
              }
              value={filters.testFit}
            >
              {testFitOptions.map((option) => (
                <CheckboxRow
                  htmlFor={`testfit-${option.value}`}
                  key={option.value}
                >
                  <RadioGroupItem
                    id={`testfit-${option.value}`}
                    value={option.value}
                  />
                  {option.label}
                </CheckboxRow>
              ))}
            </RadioGroup>
            <p className="mt-2.5 text-xs text-[var(--ink-muted)]">
              Compared against your {profile.satScore}. Ranges describe
              submitters only, so schools where few students submitted are
              flagged on the card rather than silently ranked.
            </p>
          </PopoverPopup>
        </Popover>
      </div>

      <button
        aria-expanded={panelOpen}
        aria-controls="explore-filter-panel"
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
        {activeCount > 0 ? (
          <span className="tabular-nums">{activeCount}</span>
        ) : null}
      </button>
    </div>
  );
}
