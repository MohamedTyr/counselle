/*
 * Profile form controls.
 *
 * These used to restate the primitives' own colours —
 * `border-[var(--profile-field-border)] bg-[var(--profile-field-surface)]`
 * is exactly what Input / Textarea / SelectTrigger already paint via
 * `border-input` (--edge-control) and `bg-[var(--field-surface)]`. The
 * restatement was not free: the naive `hover:border-…` fired while the
 * field was focused and while it was disabled (the primitives guard both
 * with `hover:not-has-focus-visible:not-has-disabled:`), and the extra
 * `focus-within:ring-2` stacked a second ring under the primitives'
 * `has-focus-visible:ring-[3px]`. Deleting them restores the real state
 * machine and leaves only what is genuinely profile-specific: size.
 *
 * Size is `lg` on every control, set at the call site through each
 * component's own size prop rather than by overriding heights here. That
 * matters because the two shapes only line up through the API: Input `lg`
 * is a 38px box inside a 1px frame and SelectTrigger `lg` is `min-h-10`,
 * both 40px outer, both 36px at `sm`. The previous hand-set heights
 * (`[&_[data-slot=input]]:!h-10` against the trigger's `min-h-10`) missed
 * the variants' own `sm:` steps, so from 640px up a text input rendered
 * 42px next to a 32px select in the same row.
 */

/** Grouping boxes on the Profile card — object-list items, document rows. */
export const profileGroupBoxClass =
  "rounded-xl bg-[var(--profile-group-surface)] p-4";

export const profileTextareaControlClass =
  "[&_[data-slot=textarea]]:min-h-28";

export const profileInlineLabelClass =
  "text-xs font-medium text-[var(--profile-field-label)]";

export const profileSegmentedControlClass = "inline-flex w-fit max-w-full gap-1";

export function profileSegmentedOptionClass(selected: boolean): string {
  return selected
    ? "border-[var(--profile-control-selected-border)] bg-[var(--profile-control-selected-surface)] text-foreground shadow-none"
    : "border-transparent bg-transparent text-[var(--profile-field-helper)] shadow-none hover:bg-transparent hover:text-[var(--profile-field-label)]";
}
