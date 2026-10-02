 
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
export const PILL_HALF_WIDTH_PX = 20;

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
   * same geometry, `--school-chances-scenario` (the accent green) instead.
   * `"saved"`: the saved value once a scenario has replaced it as the
   * primary mark — a 1px dashed rule with no pill, so the plot still shows
   * where the student's real profile sits without competing with the
   * hypothetical for attention.
   */
  variant?: YouMarkVariant;
  /**
   * `ScrubbablePlot`'s only lever on this component's motion (plan §7): a
   * `scale(0.96)` press-feedback on the pill while a drag is live. Ignored
   * for `variant="saved"`, which has no pill.
   */
  pressed?: boolean;
  /**
   * `true` while a pointer drag is live: the rule and pill snap 1:1 with no
   * transition, because a spring or ease here reads as lag against a
   * pointer the student is actively moving. `false` (default) — on
   * mount, on release, and on every keyboard step — animates `left` over
   * 180ms `cubic-bezier(0.23, 1, 0.32, 1)` (plan §7).
   */
  instant?: boolean;
  className?: string;
};

export function YouMark({
  value,
  display,
  window,
  variant = "you",
  pressed = false,
  instant = false,
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
        style={{ transform: `translateX(${left}cqw)` }}
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
  /* FIX 5: `cqw` (container query width — 1cqw = 1% of the nearest
   * `container-type: inline-size` ancestor's inline size, `schools.css`)
   * instead of `%`, so this can move on `transform` instead of `left`. A
   * plain `translateX(${left}%)` would resolve its percentage against this
   * element's OWN box, not the plot's — `cqw` is what makes the container's
   * width the reference again. `transform` composes independently of the
   * `translate` CSS property Tailwind's `-translate-x-1/2` sets (Tailwind
   * v4), so the self-centering below is untouched by this. */
  const pillTranslateX = `clamp(${PILL_HALF_WIDTH_PX}px, ${left}cqw, calc(100cqw - ${PILL_HALF_WIDTH_PX}px))`;
  /* Plan §7: 180ms cubic-bezier(0.23, 1, 0.32, 1) on release/keyboard step,
   * nothing while a drag is live — `motion-reduce` collapses both to an
   * instant snap, since the mark must still move, only the tweening stops.
   * FIX 5: `transform` instead of `left` — a compositor-only property, so
   * this no longer forces a layout recalc the way `left` did whenever a
   * pointermove elsewhere read `getBoundingClientRect()` mid-tween. */
  const markTransition = cn(
    "transition-[transform] motion-reduce:transition-none",
    instant ? "duration-0" : "duration-[180ms] ease-[cubic-bezier(0.23,1,0.32,1)]",
  );

  return (
    <span className={cn("contents", className)} data-slot="you-mark" data-variant={variant}>
      <span
        className={cn(
          "pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2",
          markTransition,
        )}
        style={{ transform: `translateX(${left}cqw)`, background: color }}
      />
      <span
        className={cn(
          // text-chrome's explicit 20px line-height is what
          // ClassShape.tsx's PILL_LINE_HEIGHT_PX/YOU_MARK_PILL_CLEARANCE
          // derive from (FIX A) — a bare text-[13px] falls back to the
          // font's own default line height, which drifts across browsers
          // and font metrics.
          "pointer-events-none absolute top-0 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-[6px] px-1.5 py-0.5 text-chrome font-medium tabular-nums",
          pressed && "scale-[0.96]",
        )}
        data-instant={instant}
        data-slot="you-mark-pill"
        style={{
          transform: `translateX(${pillTranslateX})`,
          color,
          background: "var(--school-chances-you-chip)",
        }}
      >
        {display}
      </span>
    </span>
  );
}
