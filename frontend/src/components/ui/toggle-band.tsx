"use client";

/*
 * A thin wrapper over Base UI's toggle-group (multiple selection) drawn on
 * SegmentedControl's own root trough, so a multi-select band of toggles
 * shares the single-select control's selected language. Its items emit
 * `aria-pressed` and `data-pressed`, which is exactly what
 * lib/segmented-control.ts's `pressed` recipe keys on.
 */

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import type React from "react";

import {
  segmentedControlItemVariants,
  segmentedControlRootClassName,
  type SegmentedControlSize,
} from "@/lib/segmented-control";
import { cn } from "@/lib/utils";

export type ToggleBandOption<TValue extends string> = {
  value: TValue;
  label: React.ReactNode;
};

type ToggleBandProps<TValue extends string> = {
  options: readonly ToggleBandOption<TValue>[];
  value: readonly TValue[];
  onValueChange: (value: readonly TValue[]) => void;
  label: string;
  size?: SegmentedControlSize;
  className?: string;
};

export function ToggleBand<TValue extends string>({
  options,
  value,
  onValueChange,
  label,
  size = "sm",
  className,
}: ToggleBandProps<TValue>): React.ReactElement {
  const itemClassName = segmentedControlItemVariants({
    className: "grow",
    size,
    state: "pressed",
  });

  return (
    <ToggleGroupPrimitive
      aria-label={label}
      className={cn(segmentedControlRootClassName, className)}
      multiple
      onValueChange={(next) => onValueChange(next as readonly TValue[])}
      value={value}
    >
      {options.map((option) => (
        <TogglePrimitive
          className={itemClassName}
          key={option.value}
          value={option.value}
        >
          {option.label}
        </TogglePrimitive>
      ))}
    </ToggleGroupPrimitive>
  );
}

export { ToggleGroupPrimitive, TogglePrimitive };
