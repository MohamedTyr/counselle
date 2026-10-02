import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** `stack` is a field under a question, label above the control; `compact`
 * is a field inside a score tile, with a smaller label and no hint. */
export type FieldLayout = "stack" | "compact";

const LABEL_CLASS: Record<FieldLayout, string> = {
  stack: "text-chrome font-medium text-[var(--ink-secondary)]",
  compact: "text-xs font-medium text-[var(--ink-faint)]",
};

export function ProfileFieldLabel({
  htmlFor,
  id,
  label,
  layout = "stack",
  visuallyHidden = false,
}: {
  htmlFor?: string;
  id?: string;
  label: string;
  layout?: FieldLayout;
  /** On when the question above already names the only field under it. */
  visuallyHidden?: boolean;
}) {
  const className = visuallyHidden ? "sr-only" : LABEL_CLASS[layout];
  return htmlFor ? (
    <label className={className} htmlFor={htmlFor} id={id}>
      {label}
    </label>
  ) : (
    <span className={className} id={id}>
      {label}
    </span>
  );
}

/** How much of the answer grid a control takes, from what it holds: a score
 * or a date is a third, a name is half, a set of choices or a paragraph is
 * the whole row. Two halves or three thirds share a row, so a name sits
 * beside its pronouns and a city beside its state. */
export type FieldWidth = "third" | "half" | "full";

const WIDTH_CLASS: Record<FieldWidth, string> = {
  third: "col-span-1 sm:col-span-2",
  half: "col-span-2 sm:col-span-3",
  full: "col-span-2 sm:col-span-6",
};

/** The grid every question's answers sit on: two columns on a phone, six
 * from `sm` up, which is what lets thirds and halves mix. */
export const PROFILE_ANSWER_GRID_CLASS =
  "grid grid-cols-2 content-start gap-x-3 gap-y-5 sm:grid-cols-6";

/** One field: its label, the control, then the hint. The hint sits under
 * the control so that two fields sharing a row keep their controls on one
 * line whether or not either has a hint. */
export function ProfileFieldRow({
  children,
  help,
  helpId,
  label,
  startsRow = false,
  width,
}: {
  children: ReactNode;
  help?: string;
  helpId?: string;
  label: ReactNode;
  /** Begins a new row of the answer grid instead of filling the last. */
  startsRow?: boolean;
  width: FieldWidth;
}) {
  return (
    <div
      className={cn("flex min-w-0 flex-col gap-2", WIDTH_CLASS[width])}
      // Inline, because the responsive `col-span-*` utilities set the
      // `grid-column` shorthand, which resets a `col-start-*` class.
      style={startsRow ? { gridColumnStart: 1 } : undefined}
    >
      {label}
      {children}
      {help ? (
        <p
          className="-mt-0.5 text-xs leading-5 text-pretty text-[var(--ink-faint)]"
          id={helpId}
        >
          {help}
        </p>
      ) : null}
    </div>
  );
}

export function ProfileFieldError({
  id,
  text,
}: {
  id: string;
  text: string | null;
}) {
  return text ? (
    <p
      aria-live="polite"
      className="text-xs leading-5 text-destructive-foreground"
      id={id}
    >
      {text}
    </p>
  ) : null;
}
