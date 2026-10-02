/*
 * The practice screen's chrome: the sheets the questions sit on, the toolbar
 * pills, and the window controls. Semantic tokens only (styles/README.md);
 * the pill grammar is the pill tabs' and the profile segmented control's —
 * a quiet track, with state carried by the item inside it.
 */

const PRESS =
  "transition-[color,background-color,border-color,box-shadow,scale] duration-150 ease-out active:scale-[0.97] motion-reduce:transition-none";

/** A raised sheet over the beams — the question, the passage, the docked
 * calculator all rest on one. */
export const satSheetClass =
  "min-h-0 min-w-0 overflow-hidden rounded-2xl border border-[var(--hairline)] bg-[var(--surface-raised)] shadow-[var(--elevation-1)]";

/** The tools sit in one quiet track; each item is a pill. */
export const satToolTrackClass =
  "inline-flex items-center gap-0.5 rounded-full bg-[var(--control-quiet-surface)] p-0.5";

/** A raised outline track — the timer, which is a reading rather than a tool. */
export const satReadoutTrackClass =
  "inline-flex items-center gap-0.5 rounded-full border border-[var(--edge-button)] bg-[var(--surface-raised)] p-0.5 shadow-[var(--elevation-1)]";

/** One pill inside either track. `pressed` is the green state tint: it
 * marks what is switched on, and keeps its meaning in greyscale through the
 * rim and the weight. */
export function satToolItemClass(pressed = false): string {
  const base = `h-8 gap-1.5 rounded-full px-2.5 text-[13px] font-medium sm:h-7 ${PRESS}`;
  return pressed
    ? `${base} border-[var(--brand-subtle-border)] bg-[var(--brand-subtle)] text-[var(--brand-subtle-ink)] hover:bg-[var(--brand-subtle)]`
    : `${base} border-transparent bg-transparent text-[var(--ink-secondary)] hover:bg-[var(--control-quiet-hover)] hover:text-[var(--ink)]`;
}

/** A square icon-only pill (play/pause, the window controls). */
export const satIconItemClass = `size-8 rounded-full p-0 text-[var(--ink-secondary)] sm:size-7 border-transparent bg-transparent hover:bg-[var(--control-quiet-hover)] hover:text-[var(--ink)] ${PRESS}`;

/** The keyboard hint inside a button — reads on ink and on the disabled
 * track alike, because it tints from the button's own text colour. */
export const satKbdOnButtonClass =
  "pointer-coarse:hidden bg-[color-mix(in_oklab,currentColor_16%,transparent)] text-current";
