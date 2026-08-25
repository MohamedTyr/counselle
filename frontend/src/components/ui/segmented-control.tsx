"use client";

/*
 * The component half of @coss/segmented-control. The registry ships the
 * class recipe (lib/segmented-control.ts) and demonstrates it on Base UI's
 * radio primitives; this is that composition, made a component so the four
 * call sites don't each re-derive the item className.
 *
 * Base UI's RadioGroup (not the project's Radix radio-group.tsx, which
 * draws the dot-and-ring form) because arrow-key roving focus, roving
 * tabindex, and `data-checked` are exactly what a segmented control needs
 * and re-implementing them by hand is the defect this replaces.
 */

import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import type React from "react";

import {
  segmentedControlItemVariants,
  segmentedControlRootClassName,
  type SegmentedControlSize,
} from "@/lib/segmented-control";
import { cn } from "@/lib/utils";

export type SegmentedControlOption<TValue extends string> = {
  value: TValue;
  label: string;
  /** Facet count, rendered inline. Enums only — never ranges. */
  count?: number;
};

type SegmentedControlProps<TValue extends string> = {
  options: readonly SegmentedControlOption<TValue>[];
  value: TValue;
  onValueChange: (value: TValue) => void;
  label: string;
  size?: SegmentedControlSize;
  className?: string;
};

export function SegmentedControl<TValue extends string>({
  options,
  value,
  onValueChange,
  label,
  size = "sm",
  className,
}: SegmentedControlProps<TValue>): React.ReactElement {
  const itemClassName = segmentedControlItemVariants({
    className: "grow",
    size,
    state: "checked",
  });

  return (
    <RadioGroupPrimitive
      aria-label={label}
      className={cn(segmentedControlRootClassName, className)}
      onValueChange={(next) => onValueChange(next as TValue)}
      value={value}
    >
      {options.map((option) => (
        <RadioPrimitive.Root
          className={itemClassName}
          key={option.value}
          value={option.value}
        >
          {option.label}
          {option.count === undefined ? null : (
            <span className="text-[.6875rem] tabular-nums opacity-60">
              {option.count}
            </span>
          )}
        </RadioPrimitive.Root>
      ))}
    </RadioGroupPrimitive>
  );
}

export { RadioGroupPrimitive, RadioPrimitive };
