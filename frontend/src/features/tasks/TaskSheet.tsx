// The surface every task list sits on. Pages are transparent over the beams,
// so a bare row list floats; rows instead sit on one raised sheet, inset by
// --task-sheet-inset so a row's hover fill keeps a concentric radius.
//
// Two shapes: a view whose groups are slices of one timeline (Upcoming's
// days, Anytime's schools, the Logbook) is ONE sheet with a section per
// group, so a run of one-task days reads as a list and not a stack of
// cards. A group that is a different kind of thing — Today's "Due soon",
// Upcoming's "Deadlines without a plan" — is its own sheet with its name
// above it, drawn dashed because those tasks still need a place.
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type GroupVariant = "unplanned-deadlines";

export function TaskSheet({
  children,
  className,
  dashed = false,
}: {
  children: ReactNode;
  className?: string;
  dashed?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-[var(--task-sheet-surface)] p-[var(--task-sheet-inset)] shadow-[var(--elevation-1)]",
        dashed
          ? "border-dashed border-[var(--edge)]"
          : "border-[var(--task-sheet-border)]",
        className,
      )}
      data-slot="task-sheet"
    >
      {children}
    </div>
  );
}

export function TaskList({ children }: { children: ReactNode }) {
  return (
    <ul className="flex flex-col" role="list">
      {children}
    </ul>
  );
}

function GroupLabel({
  count,
  label,
  variant,
}: {
  count: number;
  label: string;
  variant?: GroupVariant;
}) {
  return (
    <>
      <h2
        className={cn(
          "font-semibold",
          variant === "unplanned-deadlines"
            ? "text-[var(--ink-secondary)]"
            : "text-[var(--ink)]",
        )}
      >
        {label}
      </h2>
      <span className="text-xs text-[var(--ink-faint)] tabular-nums">
        {count}
      </span>
    </>
  );
}

/** A group that stands apart from the main list: its name above, its own
 * sheet below. The name lines up with the sheet's checkbox column. */
export function TaskGroup({
  children,
  count,
  label,
  variant,
}: {
  children: ReactNode;
  count: number;
  label: string;
  variant?: GroupVariant;
}) {
  return (
    <section>
      <div className="mb-2 flex h-6 items-baseline gap-2 px-3 text-chrome">
        <GroupLabel count={count} label={label} variant={variant} />
      </div>
      <TaskSheet dashed>
        <TaskList>{children}</TaskList>
      </TaskSheet>
    </section>
  );
}

/** One group inside a shared sheet. Sections after the first are divided by
 * a full-width hairline, so the break between days is stronger than the
 * inset rule between rows. */
export function TaskSheetSection({
  children,
  count,
  label,
  variant,
}: {
  children: ReactNode;
  count: number;
  /** Omitted when the sheet holds one group whose name would say nothing. */
  label?: string;
  variant?: GroupVariant;
}) {
  return (
    <section className="not-first:mt-1 not-first:border-t not-first:border-[var(--hairline)] not-first:pt-1">
      {label && (
        <div className="flex items-baseline gap-2 px-2 pt-2.5 pb-1 text-chrome">
          <GroupLabel count={count} label={label} variant={variant} />
        </div>
      )}
      <TaskList>{children}</TaskList>
    </section>
  );
}
