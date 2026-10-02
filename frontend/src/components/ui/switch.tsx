"use client";

import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

/** shadcn's Radix switch on the app's tokens: the brand ink when on, the
 * quiet control track when off. The thumb slides 150ms, never on hover. */
function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer relative inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full border border-transparent outline-none",
        "transition-[background-color] duration-150 ease-out motion-reduce:transition-none",
        "focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--canvas)]",
        "disabled:cursor-not-allowed disabled:opacity-64",
        "data-[state=checked]:bg-[var(--brand)] data-[state=unchecked]:bg-[var(--edge-control)]",
        "pointer-coarse:after:absolute pointer-coarse:after:-inset-3",
        className,
      )}
      data-slot="switch"
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block size-3.5 rounded-full bg-[var(--surface-raised)] shadow-[var(--elevation-1)]",
          "translate-x-px transition-[translate] duration-150 ease-out motion-reduce:transition-none data-[state=checked]:translate-x-[15px]",
        )}
        data-slot="switch-thumb"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
