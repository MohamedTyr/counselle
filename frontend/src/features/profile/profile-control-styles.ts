export const profileInputControlClass =
  "border-[var(--profile-field-border)] bg-[var(--profile-field-surface)] text-foreground transition-[border-color,background-color,box-shadow] hover:border-[var(--profile-field-hover-border)] focus-within:border-[var(--profile-field-focus-border)] focus-within:ring-2 focus-within:ring-[var(--profile-field-focus-border)]/30 [&_[data-slot=input]]:!h-10 [&_[data-slot=input]]:px-3";

export const profileSelectControlClass =
  "min-h-10 border-[var(--profile-field-border)] bg-[var(--profile-field-surface)] px-3 text-foreground transition-[border-color,background-color,box-shadow] hover:border-[var(--profile-field-hover-border)] focus-visible:border-[var(--profile-field-focus-border)] focus-visible:ring-2 focus-visible:ring-[var(--profile-field-focus-border)]/30";

export const profileTextareaControlClass =
  "border-[var(--profile-field-border)] bg-[var(--profile-field-surface)] text-foreground transition-[border-color,background-color,box-shadow] hover:border-[var(--profile-field-hover-border)] focus-within:border-[var(--profile-field-focus-border)] focus-within:ring-2 focus-within:ring-[var(--profile-field-focus-border)]/30 [&_[data-slot=textarea]]:min-h-28 [&_[data-slot=textarea]]:px-3 [&_[data-slot=textarea]]:py-2.5";

export const profileInlineLabelClass =
  "text-xs font-medium text-[var(--profile-field-label)]";

export const profileListRowClass =
  "rounded-xl border border-[var(--profile-field-border)] bg-[var(--profile-field-surface)] p-4";

export const profileSegmentedControlClass =
  "inline-flex w-fit max-w-full gap-1";

export function profileSegmentedOptionClass(selected: boolean): string {
  return selected
    ? "border-[var(--profile-control-selected-border)] bg-[var(--profile-control-selected-surface)] text-foreground shadow-none"
    : "border-transparent bg-transparent text-[var(--profile-field-helper)] shadow-none hover:bg-transparent hover:text-[var(--profile-field-label)]";
}
