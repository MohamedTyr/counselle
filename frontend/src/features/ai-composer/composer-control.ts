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

export const composerControlButtonClass = `h-8 px-2.5 text-[13px] font-medium tracking-[-0.01em] sm:h-8 ${base} ${states}`;

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
