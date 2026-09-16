import { cn } from "@/lib/utils";

import { scorePosition, type PlotWindow } from "./academic-comparison-geometry";

/*
 * The student's mark (plan §2.2) — identical geometry across all three
 * `ClassShape` renderers, and the only full-contrast object on the plot.
 *
 * Fully controlled by `value`/`display`, and nothing else: it holds no state
 * and reads no pointer or keyboard event. A later scrub wrapper (P3's
 * `ScrubbablePlot`) drives the live value during a drag by re-rendering this
 * component with a new `value`/`display` on every frame — it never needs to
 * reach into this file to do that.
 */

/**
 * Half the pill's widest realistic rendered width (FIX B) — the widest
 * value this mark ever shows is a 4-char GPA like "4.00"/"0.00" (measured
 * ≈37.3px at `text-chrome`/`px-1.5`), rounded up with a few px of margin
 * for font-metric variance. Used to keep the pill's own box fully inside
 * the plot bounds near either window edge; the value's rule below is never
 * clamped by it.
 */
const PILL_HALF_WIDTH_PX = 20;

export type YouMarkVariant = "you" | "scenario" | "saved";

export type YouMarkProps = {
  /** The value's position on the same axis `window` describes. */
  value: number;
  /** The exact string the pill shows — always the caller's own formatting. */
  display: string;
  window: PlotWindow;
  /**
   * `"you"` (default): the saved profile value, solid rule + pill.
   * `"scenario"`: a local hypothetical that differs from the saved value —
   * same geometry, `--school-chances-scenario` (lime) instead.
   * `"saved"`: the saved value once a scenario has replaced it as the
   * primary mark — a 1px dashed rule with no pill, so the plot still shows
   * where the student's real profile sits without competing with the
   * hypothetical for attention.
   */
  variant?: YouMarkVariant;
  className?: string;
};

export function YouMark({
  value,
  display,
  window,
  variant = "you",
  className,
}: YouMarkProps): React.ReactElement | null {
  if (window.hi <= window.lo) return null;
  const clamped = Math.min(window.hi, Math.max(window.lo, value));
  const left = scorePosition(clamped, window.lo, window.hi) * 100;

  if (variant === "saved") {
    return (
      <span
        className={cn(
          "pointer-events-none absolute inset-y-0 w-px border-l border-dashed border-[var(--ink-faint)]",
          className,
        )}
        data-slot="you-mark"
        data-variant={variant}
        style={{ left: `${left}%` }}
      />
    );
  }

  const color =
    variant === "scenario" ? "var(--school-chances-scenario)" : "var(--school-chances-you)";
  /*
   * FIX B: the rule below sits at the value's exact `left: ${left}%` and is
   * never adjusted. The pill is positioned independently (`display:
   * contents` on the wrapper below removes it from the layout tree, so
   * both children lay out directly against the plot box rather than
   * against a zero-width anchor) and its own `left` is clamped so its box
   * never overflows the plot bounds near either window edge — a value
   * sitting on the window's own 0%/100% edge would otherwise center a
   * ~37px pill exactly on the boundary and clip it by roughly half its
   * width.
   */
  const pillLeft = `clamp(${PILL_HALF_WIDTH_PX}px, ${left}%, calc(100% - ${PILL_HALF_WIDTH_PX}px))`;

  return (
    <span className={cn("contents", className)} data-slot="you-mark" data-variant={variant}>
      <span
        className={cn("pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2")}
        style={{ left: `${left}%`, background: color }}
      />
      <span
        className={cn(
          // text-chrome's explicit 20px line-height is what
          // ClassShape.tsx's PILL_LINE_HEIGHT_PX/YOU_MARK_PILL_CLEARANCE
          // derive from (FIX A) — a bare text-[13px] falls back to the
          // font's own default line height, which drifts across browsers
          // and font metrics.
          "pointer-events-none absolute top-0 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-[6px] px-1.5 py-0.5 text-chrome font-medium tabular-nums",
        )}
        style={{ left: pillLeft, color, background: "var(--school-chances-you-chip)" }}
      >
        {display}
      </span>
    </span>
  );
}
