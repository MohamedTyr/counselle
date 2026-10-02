/*
 * Profile form controls.
 *
 * Inputs, textareas and selects take the primitives' own colours and state
 * machine (`border-input`, `bg-[var(--field-surface)]`, the guarded hover
 * and the focus ring) — restating them here once stacked a second ring
 * under the primitives' and fired hover on a focused field. What lives here
 * is only what the profile adds on top: the choice chips, the score picker,
 * and the sheet everything sits on.
 *
 * Size is `lg` on every text control, set at the call site through each
 * component's own size prop, so an input and a chip row line up at 40px.
 */

/** The surface every profile tab's content sits on. Pages are transparent
 * over the beams, so content rests on one raised sheet — the same shape the
 * task lists use. */
export const profileSheetClass =
  "rounded-2xl border border-[var(--profile-section-border)] bg-[var(--profile-section-surface)] shadow-[var(--elevation-1)]";

export const profileTextareaControlClass =
  "[&_[data-slot=textarea]]:min-h-20 [&_[data-slot=textarea]]:resize-none";

export const profileInlineLabelClass =
  "text-xs font-medium text-[var(--profile-field-label)]";

const PRESS =
  "transition-[color,background-color,border-color,box-shadow,scale] duration-150 ease-out active:scale-[0.96] motion-reduce:transition-none";

/** A choice on show — single-select options, Yes/No, multi-select options.
 * Every option is visible, so a choice is one click instead of two. The
 * chosen one carries the brand tint, an --accent-solid rim and a heavier
 * weight, so it survives greyscale. */
export function profileChipClass(selected: boolean): string {
  const base = `h-9 rounded-full px-3.5 text-sm sm:h-9 ${PRESS}`;
  return selected
    ? `${base} border-[var(--accent-solid)] bg-[var(--brand-subtle)] font-medium text-[var(--brand-subtle-ink)] shadow-none hover:bg-[var(--brand-subtle)]`
    : `${base} border-[var(--profile-field-border)] bg-[var(--field-surface)] text-[var(--ink-secondary)] shadow-none hover:border-[var(--profile-field-hover-border)] hover:bg-[var(--field-surface)] hover:text-[var(--ink)]`;
}

/** A short numeric scale (an AP score, 1–5) as a quiet track with the chosen
 * number lifted onto a raised square — the tabs' grammar in miniature. */
export const profileScorePickerClass =
  "inline-flex h-10 w-fit items-center gap-0.5 rounded-[10px] bg-[var(--control-quiet-surface)] p-0.5 sm:h-9";

export function profileScoreOptionClass(selected: boolean): string {
  const base = `size-9 rounded-lg text-sm tabular-nums sm:size-8 ${PRESS}`;
  return selected
    ? `${base} bg-[var(--surface-raised)] font-semibold text-[var(--ink)] shadow-[var(--elevation-1)]`
    : `${base} text-[var(--ink-secondary)] hover:text-[var(--ink)]`;
}

/** The "this needs a place" signal the tasks use: an add affordance drawn
 * dashed, turning brand on hover. */
export const profileDashedAddClass = `border-dashed border-[var(--edge)] bg-transparent text-[var(--ink-secondary)] shadow-none hover:border-[var(--accent-solid)] hover:bg-transparent hover:text-[var(--brand-subtle-ink)] ${PRESS}`;

/** A quiet track with the chosen value lifted onto a raised pill, the same
 * grammar as the page's tabs. */
export const profileSegmentedControlClass =
  "inline-flex w-fit max-w-full gap-0.5 rounded-full bg-[var(--control-quiet-surface)] p-0.5";

export function profileSegmentedOptionClass(selected: boolean): string {
  const base =
    "h-7 rounded-full border-transparent px-3 text-xs transition-[color,background-color,box-shadow,scale] duration-150 ease-out active:scale-[0.96] sm:h-7 motion-reduce:transition-none";
  return selected
    ? `${base} bg-[var(--surface-raised)] font-medium text-[var(--ink)] shadow-[var(--elevation-1)] hover:bg-[var(--surface-raised)]`
    : `${base} bg-transparent text-[var(--ink-secondary)] shadow-none hover:bg-transparent hover:text-[var(--ink)]`;
}

/** Read-only pill: a saved list item, a fact read back in a header. */
export const profilePillClass =
  "inline-flex h-6 max-w-full items-center rounded-full bg-[var(--control-quiet-surface)] px-2.5 text-xs text-[var(--ink-secondary)]";

/** Every tab is the same two columns — a 200px rail or aside, then the
 * content — so switching tabs never moves the content's left edge. */
export const PROFILE_LAYOUT_CLASS =
  "grid grid-cols-[minmax(0,1fr)] items-start gap-6 md:grid-cols-[200px_minmax(0,1fr)] lg:gap-8";

/** An empty or failed tab: the sheet drawn dashed, the same signal the task
 * lists use for a place that has nothing in it yet. */
export const profileEmptySheetClass =
  "rounded-xl border border-dashed border-[var(--edge)] bg-[var(--profile-section-surface)] py-12";

/** A row's destructive or secondary action: present at rest on touch, where
 * there is no hover, and revealed by hover or focus on a fine pointer. */
export const profileRowActionClass =
  "text-[var(--ink-faint)] hover:text-[var(--ink)] pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100 transition-[opacity,color] duration-150 ease-out";
