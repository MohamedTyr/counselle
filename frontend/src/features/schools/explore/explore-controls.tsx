import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "@/components/ui/number-field";
import { PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import type { RangeDescriptor } from "@/features/schools/explore/explore-config";
import type { NumericRange } from "@/features/schools/explore/explore-types";
import { cn } from "@/lib/utils";

/*
 * The controls the filter bar and the filter panel share. Both surfaces
 * render the same range editor and the same chip, so they live here rather
 * than being written twice and drifting.
 */

/**
 * A Tier-1 filter chip. Speaks the composer's control-chip dialect — a warm
 * fill and no border at rest — so the filter bar and the composer are one
 * language rather than two. Active swaps to the brand tint, which with the
 * CTA, the tab indicator, and on-list cards is the page's entire brand
 * budget.
 */
export function FilterChip({
  label,
  value,
  isActive,
  disabled = false,
  title,
}: {
  label: string;
  value?: string | null;
  isActive: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <PopoverTrigger
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-60 pointer-coarse:min-h-11",
        isActive
          ? "border border-[var(--school-filter-chip-active-border)] bg-[var(--school-filter-chip-active-surface)] text-[var(--school-filter-chip-active-ink)]"
          : "border border-transparent bg-[var(--school-filter-chip-surface)] text-[var(--ink-secondary)] hover:bg-[var(--school-filter-chip-hover)]",
      )}
      disabled={disabled}
      title={title}
    >
      <span>{label}</span>
      {value ? (
        <span className="max-w-40 truncate font-semibold tabular-nums">
          {value}
        </span>
      ) : null}
      <ChevronDown aria-hidden="true" className="size-3.5 opacity-60" />
    </PopoverTrigger>
  );
}

const UNIT_ADORNMENT: Record<RangeDescriptor["unit"], string> = {
  currency: "$",
  percent: "%",
  // ":1", not ": 1" — the space let it wrap onto two lines in the narrow
  // adornment slot, which read as a stray colon above a stray digit.
  ratio: ":1",
};

function BoundField({
  descriptor,
  bound,
  label,
  range,
  onChange,
}: {
  descriptor: RangeDescriptor;
  bound: "min" | "max";
  label: string;
  range: NumericRange;
  onChange: (range: NumericRange) => void;
}) {
  const adornment = UNIT_ADORNMENT[descriptor.unit];

  return (
    <NumberField
      max={descriptor.max}
      min={0}
      onValueChange={(next) => onChange({ ...range, [bound]: next })}
      size="sm"
      step={descriptor.step ?? 1}
      value={range[bound]}
    >
      <Label className="text-xs text-[var(--ink-secondary)]">{label}</Label>
      <NumberFieldGroup>
        <NumberFieldDecrement aria-label={`Decrease ${label}`} />
        {descriptor.unit === "currency" ? (
          <span className="flex items-center pl-1 text-xs text-[var(--ink-muted)]">
            {adornment}
          </span>
        ) : null}
        <NumberFieldInput
          className={cn(descriptor.unit === "currency" && "pl-0 text-left")}
          placeholder="Any"
        />
        {descriptor.unit === "currency" ? null : (
          <span className="flex items-center pr-1 text-xs whitespace-nowrap text-[var(--ink-muted)]">
            {adornment}
          </span>
        )}
        <NumberFieldIncrement aria-label={`Increase ${label}`} />
      </NumberFieldGroup>
    </NumberField>
  );
}

/**
 * Number-field pairs rather than a slider, and deliberately: admit rate is
 * heavily right-skewed, so on a linear 0–100 track the entire selective
 * range (4–20%) lives in the first fifth and is unhittable. Fields are also
 * precise, degrade gracefully when the metric is missing, and read as "at
 * least / at most" rather than implying a distribution we aren't showing.
 */
export function RangeFields({
  descriptor,
  range,
  onChange,
}: {
  descriptor: RangeDescriptor;
  range: NumericRange;
  onChange: (range: NumericRange) => void;
}) {
  if (descriptor.bounds === "both") {
    return (
      <div className="flex items-end gap-2">
        <BoundField
          bound="min"
          descriptor={descriptor}
          label="At least"
          onChange={onChange}
          range={range}
        />
        <BoundField
          bound="max"
          descriptor={descriptor}
          label="At most"
          onChange={onChange}
          range={range}
        />
      </div>
    );
  }

  return (
    <BoundField
      bound={descriptor.bounds}
      descriptor={descriptor}
      label={descriptor.label}
      onChange={onChange}
      range={range}
    />
  );
}

/** Sentence case, not a tracked uppercase eyebrow — `MONEY` is the
 *  saturated AI tell, and this page has six of these headings. */
export function FilterGroupHeading({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-xs font-medium text-[var(--ink-secondary)]">
        {children}
      </h3>
      <Separator />
    </div>
  );
}

export function FilterRow({
  label,
  htmlFor,
  children,
}: {
  label?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <Label
          className="text-xs text-[var(--ink-secondary)]"
          htmlFor={htmlFor}
        >
          {label}
        </Label>
      ) : null}
      {children}
    </div>
  );
}

export function CheckboxRow({
  children,
  htmlFor,
}: {
  children: ReactNode;
  htmlFor: string;
}) {
  return (
    <Label
      className="cursor-pointer gap-2 text-sm font-normal text-[var(--ink-secondary)]"
      htmlFor={htmlFor}
    >
      {children}
    </Label>
  );
}
