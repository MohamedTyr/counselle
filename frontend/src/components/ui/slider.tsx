"use client";

/*
 * @coss/slider adapted to Counselle's Base UI primitive conventions. The
 * foundation owns pointer capture, touch dragging, keyboard increments, and
 * form inputs; this wrapper owns only the house slots and visual language.
 */

import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import type React from "react";

import { cn } from "@/lib/utils";

export function Slider({
  className,
  "aria-label": ariaLabel,
  "aria-valuetext": ariaValueText,
  ...props
}: SliderPrimitive.Root.Props<number>): React.ReactElement {
  return (
    <SliderPrimitive.Root
      className={cn(
        "group/slider flex w-full touch-none items-center py-2 data-disabled:cursor-not-allowed data-disabled:opacity-64",
        className,
      )}
      data-slot="slider"
      thumbAlignment="edge"
      {...props}
    >
      <SliderPrimitive.Control
        className={cn(
          "relative flex min-h-11 w-full cursor-pointer touch-none items-center data-disabled:cursor-not-allowed",
        )}
        data-slot="slider-control"
      >
        <SliderPrimitive.Track
          className={cn(
            "relative h-1.5 w-full overflow-hidden rounded-full bg-[var(--control-quiet-surface)]",
          )}
          data-slot="slider-track"
        >
          <SliderPrimitive.Indicator
            className={cn("absolute inset-y-0 left-0 rounded-full bg-selected")}
            data-slot="slider-indicator"
          />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          aria-valuetext={ariaValueText}
          /* `[contain:layout]` makes the thumb the containing block for Base
           * UI's visually-hidden range input, which is `position: fixed` at
           * the viewport's top-left. Under any ancestor with a transform or
           * filter that input resolves against the ancestor instead, and
           * focusing it on press scrolls the page away mid-drag. */
          className={cn(
            "absolute z-10 size-4 rounded-full [contain:layout] border-2 border-selected bg-selected shadow-xs outline-none transition-[box-shadow,border-color] duration-150 ease-out focus-visible:ring-[3px] focus-visible:ring-ring/35 data-disabled:bg-[var(--control-quiet-surface)]",
          )}
          data-slot="slider-thumb"
          data-testid="slider-thumb"
          getAriaLabel={ariaLabel ? () => ariaLabel : undefined}
        />
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export { SliderPrimitive };
