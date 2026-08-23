import { cn } from "@/lib/utils";

/**
 * Non-component chrome shared by the tool-beat widgets. Kept out of
 * `ToolBeat.tsx` so that file can export only components (react-refresh).
 */

/**
 * The one entrance every beat shares. A run streams beats in one at a time, so
 * only a newly-mounted beat animates — a calm fade + 4px settle, never a
 * layout-property animation. The content is visible by default; the keyframes
 * only run under `motion-safe`, so reduced-motion and headless renders show the
 * final state with no reveal to miss.
 */
export const toolBeatEnter =
  "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-200 motion-safe:ease-out";

/**
 * Shared chip shell. One height (44px touch target), one surface, one radius
 * across search results, workspace previews and viz tags. `interactive` adds
 * the hover + focus-ring affordance for links and expand triggers.
 */
export function toolChipClass(interactive = false): string {
  return cn(
    "inline-flex h-11 min-w-0 items-center gap-1.5 rounded-md bg-[var(--control-track)] px-2.5 text-xs text-[var(--ink-secondary)]",
    interactive &&
      "cursor-pointer transition-colors duration-200 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
  );
}

/** The "+N" overflow chip, shared by every widget that collapses its list. */
export function toolMoreChipClass(): string {
  return cn(
    toolChipClass(true),
    "min-w-11 justify-center tabular-nums text-muted-foreground",
  );
}
