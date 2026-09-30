"use client";

import * as React from "react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";
import { CheckIcon } from "lucide-react";

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer relative flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input transition-colors duration-[120ms] ease-out motion-reduce:transition-none outline-none group-has-disabled/field:opacity-64 after:absolute after:-inset-x-3 after:-inset-y-2 pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-64 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-selected data-checked:border-selected data-checked:bg-selected data-checked:text-primary-foreground",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        // The check pops in over 120ms rather than appearing instantly: this
        // is direct press feedback and has to land before the finger lifts
        // (tasks-redesign design doc §4.1 step 1). scale-[0.8], never
        // scale(0) — nothing in the real world appears from nothing.
        className={cn(
          "grid place-content-center text-current [&>svg]:size-3.5",
          "transition-[opacity,transform] duration-[120ms] ease-out",
          "starting:scale-[0.8] starting:opacity-0",
          "motion-reduce:transition-none motion-reduce:starting:scale-100 motion-reduce:starting:opacity-100",
        )}
      >
        <CheckIcon />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
