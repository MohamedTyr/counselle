import { Check, Search, X } from "lucide-react";
import type { ReactNode } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { InputPrimitive } from "@/components/ui/input";
import { Popover, PopoverPopup } from "@/components/ui/popover";
import { FilterChip } from "@/features/schools/explore/explore-controls";
import {
  activeFilterKeys,
  clearAllFilters,
  type BasisFilter,
  type DeadlineWindow,
  type ScholarshipFilters,
} from "@/features/scholarships/scholarship-filters";
import { formatMoney } from "@/features/scholarships/scholarship-format";
import { cn } from "@/lib/utils";

const AMOUNT_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: "Any amount" },
  { value: 1000, label: "$1,000 or more" },
  { value: 5000, label: "$5,000 or more" },
  { value: 10000, label: "$10,000 or more" },
  { value: 25000, label: "$25,000 or more" },
];

const WINDOW_OPTIONS: { value: DeadlineWindow; label: string; chip: string }[] = [
  { value: "any", label: "Any time", chip: "" },
  { value: "30", label: "In the next 30 days", chip: "30 days" },
  { value: "90", label: "In the next 90 days", chip: "90 days" },
  { value: "rolling", label: "Rolling only", chip: "Rolling" },
];

const BASIS_OPTIONS: { value: BasisFilter; label: string; chip: string }[] = [
  { value: "any", label: "Merit or need", chip: "" },
  { value: "merit", label: "Merit-based", chip: "Merit" },
  { value: "need", label: "Need-based", chip: "Need" },
];

function OptionList<T>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div aria-label={label} className="flex flex-col gap-px" role="radiogroup">
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            aria-checked={checked}
            className={cn(
              "flex h-8 cursor-pointer items-center justify-between gap-6 rounded-md px-2 text-left text-sm outline-none transition-colors hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
              checked ? "font-medium text-[var(--ink)]" : "text-[var(--ink-secondary)]",
            )}
            key={option.label}
            onClick={() => onChange(option.value)}
            role="radio"
            type="button"
          >
            {option.label}
            {checked ? <Check aria-hidden="true" className="size-4 text-[var(--accent-solid)]" /> : null}
          </button>
        );
      })}
    </div>
  );
}

function ChipPopover({
  label,
  value,
  isActive,
  children,
}: {
  label: string;
  value?: string | null;
  isActive: boolean;
  children: ReactNode;
}) {
  return (
    <Popover>
      <FilterChip isActive={isActive} label={label} value={value} />
      <PopoverPopup align="start" className="w-60 p-1.5">
        {children}
      </PopoverPopup>
    </Popover>
  );
}

function ToggleChip({ label, pressed, onToggle }: { label: string; pressed: boolean; onToggle: () => void }) {
  return (
    <button
      aria-pressed={pressed}
      className={cn(
        "inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] active:scale-[0.97] pointer-coarse:min-h-11",
        pressed
          ? "border border-[var(--school-filter-chip-active-border)] bg-[var(--school-filter-chip-active-surface)] text-[var(--school-filter-chip-active-ink)]"
          : "border border-[var(--school-filter-chip-border)] bg-[var(--school-filter-chip-surface)] text-[var(--ink-secondary)] shadow-[var(--school-filter-chip-shadow)] hover:border-[var(--school-filter-chip-border-hover)]",
      )}
      onClick={onToggle}
      type="button"
    >
      {pressed ? <Check aria-hidden="true" className="size-3.5" /> : null}
      {label}
    </button>
  );
}

export function ScholarshipSearchField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="relative flex w-full items-center rounded-xl border border-[var(--school-search-border)] bg-[var(--school-search-surface)] transition-shadow focus-within:border-[var(--school-search-border-focus)] focus-within:ring-2 focus-within:ring-[var(--focus-ring)]/30">
      <Search aria-hidden="true" className="pointer-events-none absolute start-3.5 size-4 text-[var(--ink-muted)]" />
      <InputPrimitive
        aria-label="Search scholarships"
        className="h-11 w-full min-w-0 bg-transparent ps-10 pe-10 text-sm outline-none placeholder:text-[var(--ink-placeholder)] sm:h-10"
        onValueChange={onChange}
        placeholder="Search by name, sponsor or field…"
        type="search"
        value={value}
      />
      {value ? (
        <button
          aria-label="Clear search"
          className="absolute end-2.5 flex size-6 cursor-pointer items-center justify-center rounded-full text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
          onClick={() => onChange("")}
          type="button"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

export function ScholarshipFilterBar({
  filters,
  fieldOptions,
  onChange,
}: {
  filters: ScholarshipFilters;
  fieldOptions: string[];
  onChange: (next: ScholarshipFilters) => void;
}) {
  const set = (patch: Partial<ScholarshipFilters>) => onChange({ ...filters, ...patch });
  const windowChip = WINDOW_OPTIONS.find((option) => option.value === filters.window)?.chip;
  const basisChip = BASIS_OPTIONS.find((option) => option.value === filters.basis)?.chip;
  const fieldChip =
    filters.fields.length === 0 ? null : filters.fields.length === 1 ? filters.fields[0] : `${filters.fields.length} fields`;
  const hasActive = activeFilterKeys(filters).length > 0;

  return (
    <div aria-label="Filters" className="-mx-6 flex items-center gap-2 overflow-x-auto px-6 py-0.5 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0" role="toolbar">
      <ChipPopover
        isActive={filters.minAmount !== null}
        label="Amount"
        value={filters.minAmount === null ? null : `${formatMoney(filters.minAmount)}+`}
      >
        <OptionList label="Amount" onChange={(minAmount) => set({ minAmount })} options={AMOUNT_OPTIONS} value={filters.minAmount} />
      </ChipPopover>
      <ChipPopover isActive={filters.window !== "any"} label="Deadline" value={windowChip || null}>
        <OptionList label="Deadline" onChange={(window) => set({ window })} options={WINDOW_OPTIONS} value={filters.window} />
      </ChipPopover>
      <ChipPopover isActive={filters.basis !== "any"} label="Type" value={basisChip || null}>
        <OptionList label="Type" onChange={(basis) => set({ basis })} options={BASIS_OPTIONS} value={filters.basis} />
      </ChipPopover>
      <ChipPopover isActive={filters.fields.length > 0} label="Field" value={fieldChip}>
        <div className="flex max-h-72 flex-col gap-px overflow-y-auto">
          {fieldOptions.map((field) => {
            const checked = filters.fields.includes(field);
            return (
              <label
                className="flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-2 text-sm text-[var(--ink-secondary)] hover:bg-[var(--surface-hover)]"
                key={field}
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(next) =>
                    set({ fields: next ? [...filters.fields, field] : filters.fields.filter((f) => f !== field) })
                  }
                />
                {field}
              </label>
            );
          })}
        </div>
        <p className="border-t border-[var(--hairline)] px-2 pt-2 pb-1 text-xs text-[var(--ink-muted)]">
          Scholarships open to any field always show.
        </p>
      </ChipPopover>
      <ToggleChip label="No essay" onToggle={() => set({ noEssay: !filters.noEssay })} pressed={filters.noEssay} />
      <ToggleChip label="Renewable" onToggle={() => set({ renewable: !filters.renewable })} pressed={filters.renewable} />
      {hasActive ? (
        <button
          className="h-8 cursor-pointer rounded-full px-2.5 text-sm text-[var(--ink-muted)] outline-none hover:text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
          onClick={() => onChange(clearAllFilters(filters))}
          type="button"
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}
