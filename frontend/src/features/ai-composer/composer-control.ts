/*
 * The composer's quiet control chips (mode / sources / response-mode / the
 * bare "@" icon button).
 *
 * These are shadcn `variant="outline"` Buttons, which is why almost every
 * declaration is `!`-flagged — the variant ships a border color, a fill, a
 * shadow, and a `before:` inset highlight, and a soft-fill chip has to
 * override all four rather than layer on top of them. The border is set
 * transparent rather than removed so the 1px box model still matches every
 * other button in the app.
 *
 * Ink deepens with the fill on hover/open (see
 * --workspace-composer-control-active-foreground): at 8px of label a fill
 * step alone is a weak state signal.
 */
const base =
  "!rounded-[var(--workspace-composer-control-radius)] !border-[var(--workspace-composer-control-border)] !bg-[var(--workspace-composer-control-surface)] !text-[var(--workspace-composer-sources-foreground)] !shadow-none before:!rounded-[calc(var(--workspace-composer-control-radius)-1px)] before:!shadow-none transition-[background-color,color] duration-150 motion-reduce:transition-none";

const states =
  "hover:!bg-[var(--workspace-composer-control-hover-surface)] hover:!text-[var(--workspace-composer-control-active-foreground)] data-pressed:!bg-[var(--workspace-composer-control-active-surface)] data-pressed:!text-[var(--workspace-composer-control-active-foreground)] data-popup-open:!bg-[var(--workspace-composer-control-active-surface)] data-popup-open:!text-[var(--workspace-composer-control-active-foreground)]";

/*
 * Internal rhythm of a labelled chip, left to right:
 *
 *   10px | icon 16 | 6px | label | 4px | chevron 14 | 8px
 *
 * Three things this fixes over "px-2.5 + gap-1.5 and let the icons sit
 * where they land":
 *
 *  - Button's global `[&_svg]:-mx-0.5` pulled 2px off BOTH icons, so the
 *    6px gap rendered as 4px on either side of the label. A 16px glyph
 *    4px from its own text reads as a collision, not a pairing; the
 *    leading icon gets its margin zeroed so the 6px is real.
 *  - The chevron was a second 16px icon at the same 80% ink as the mode
 *    icon, so every chip carried two equal-weight glyphs and the one that
 *    means something lost. It drops to 14px at 65% and tightens to 4px
 *    from the label: it belongs to the value, it isn't a peer of it.
 *    65% and not 60% because 60 composites to 2.94:1 against the chip
 *    fill and a disclosure arrow is a UI component (1.4.11, 3:1); 65
 *    measures 3.28:1.
 *  - Padding is asymmetric (10 left / 8 right) because a chevron carries
 *    its own optical whitespace — an equal 10px right inset measures the
 *    same and looks larger.
 *
 * `sm:text-[13px]` is not redundant with `text-[13px]`: buttonVariants
 * ships `sm:text-sm`, which is a different variant bucket, so it wins
 * from 640px up and the chips silently rendered at 14px on every desktop.
 * 13px is the point of the token — the composer input is 16px, and the
 * chips have to read as secondary to it.
 */
const chipContents =
  "gap-1.5 [&_[data-icon=inline-start]]:!mx-0 [&_[data-icon=inline-end]]:!-ml-0.5 [&_[data-icon=inline-end]]:!mr-0 [&_[data-icon=inline-end]]:!size-3.5 [&_[data-icon=inline-end]]:!opacity-65";

export const composerControlButtonClass = `h-8 pr-2 pl-2.5 text-[13px] font-medium tracking-[-0.01em] sm:h-8 sm:text-[13px] ${chipContents} ${base} ${states}`;

/* Icon-only variant of the same chip — square, no horizontal padding. */
export const composerControlIconButtonClass = `size-8 ${base} ${states}`;

/*
 * The send / stop button.
 *
 * The disabled state is overridden away from Button's global
 * `disabled:opacity-64`. Fading a saturated brand green to 64% over white
 * does not produce "a dim green button", it produces a washed sage that
 * reads as a colour someone chose on purpose — the single worst pixel in
 * the resting composer, and the state it sits in most of the time, since
 * the composer is empty until you type. Disabled now drops to the same
 * quiet fill as the chips with muted ink, so an unsendable message reads
 * as inert rather than as a bad green.
 */
export const composerSendButtonClass =
  "shrink-0 rounded-[var(--workspace-composer-control-radius)] transition-[background-color,color,border-color] duration-150 disabled:!opacity-100 disabled:!border-transparent disabled:!bg-[var(--workspace-composer-control-surface)] disabled:!text-[var(--ink-disabled)] disabled:!shadow-none motion-reduce:transition-none";
