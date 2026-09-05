import { Check, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { EssaySuggestionsController } from "@/features/essays/suggestions/useEssaySuggestions";
import { cn } from "@/lib/utils";

/*
 * Accept and reject, wherever a change is offered — the hover popover on the
 * change itself and the row for it in the pending-changes bar. One component,
 * because the two places are not merely shaped alike: they carry the same
 * rule about how a student's own writing may be rewritten, and that rule has
 * one reason to change.
 *
 * The pair is deliberately symmetric. These are peers, not a recommendation
 * and an escape hatch — the student's essay is not improved by default, and a
 * bordered Accept next to a link-weight Reject reads as a nudge.
 */

/*
 * Locked, but never `disabled`. A student can be keyboard-focused on any of
 * these, and the native attribute ejects focus from whatever holds it — which
 * is exactly why `Button`'s own loading state avoids it. So the lock is
 * `aria-disabled` plus the dim treatment, with the handler doing the actual
 * blocking. No `pointer-events-none`: staying hoverable and focusable while
 * locked is the whole point (`task-actions.tsx` sets the same precedent, and
 * likewise relies on its handler rather than on suppressing the pointer).
 */
export const lockedClass =
  "aria-disabled:cursor-not-allowed aria-disabled:opacity-64";

/*
 * Below a 26rem row the row cannot hold two labelled buttons and a description
 * of the change at the same time. The labels go and the icons stay: what a
 * student must never lose is the sentence being rewritten, so the description
 * is the last thing to give up width, never the first. Written out rather than
 * composed, because Tailwind only sees class names that appear literally.
 */
const COLLAPSING_LABEL_CLASS = "hidden @[26rem]/changes:inline";

/*
 * And once the labels are gone the pair has to move apart. Collapsed, Accept
 * and Reject are a 32px check and a 32px cross, but `buttonVariants` grows each
 * to a 44px coarse-pointer target — so at the labelled spacing the two hit
 * areas do not merely abut, they OVERLAP by 6px. Accepting rewrites the
 * student's own prose and this surface offers no undo, so a mis-tap here is the
 * failure that matters most.
 *
 * The gap has to clear 12px, not reach it: each 44px target overhangs its 32px
 * button by 6px per side, so a 12px gap puts the two hit edges at exactly the
 * same x — no overlap, but no dead zone either, which is the same mis-tap with
 * better arithmetic. 20px is the value that buys a real 8px dead zone (measured
 * at 768px) and is also the last step before the row's description starts
 * losing a line to truncation — and the description is the last thing to give
 * up width, never the first. Labelled, the buttons are wide enough already and
 * the tight pairing reads as one control.
 */
const COLLAPSING_GAP_CLASS = "gap-5 @[26rem]/changes:gap-1.5";

type ResolveButtonsProps = {
  acceptLabel: string;
  className?: string;
  /** Drop the labels in a narrow `@container/changes`. Rows only. */
  collapsible?: boolean;
  controller: EssaySuggestionsController;
  /**
   * Names the change these buttons resolve, appended to each button's label.
   * Without it a list of changes is a column of buttons all called "Accept",
   * which is the only keyboard path to rewriting a specific sentence.
   */
  describedChange?: string;
  onAccept: () => void;
  onReject: () => void;
  rejectLabel: string;
  /** Which resolve target these buttons stand for. */
  target: string;
};

export function ResolveButtons({
  acceptLabel,
  className,
  collapsible = false,
  controller,
  describedChange,
  onAccept,
  onReject,
  rejectLabel,
  target,
}: ResolveButtonsProps) {
  const { isResolving, resolving } = controller;
  const isTarget = resolving?.id === target;
  const locked = isResolving && !isTarget;
  const labelClass = collapsible ? COLLAPSING_LABEL_CLASS : undefined;
  const nameFor = (label: string) =>
    describedChange === undefined ? undefined : `${label}: ${describedChange}`;

  return (
    <div
      className={cn(
        "flex shrink-0 items-center",
        collapsible ? COLLAPSING_GAP_CLASS : "gap-1.5",
        className,
      )}
    >
      <Button
        aria-disabled={locked || undefined}
        aria-label={nameFor(acceptLabel)}
        className={lockedClass}
        loading={isTarget && resolving?.action === "accept"}
        /* A real click steals DOM focus, and accept must never pull the caret
         * out of the essay the student is reading. */
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (isResolving) {
            return;
          }
          onAccept();
        }}
        size="sm"
        type="button"
        variant="outline"
      >
        <Check
          className="text-(--essay-suggestion-insert-ink)"
          data-icon="inline-start"
        />
        <span className={labelClass}>{acceptLabel}</span>
      </Button>
      <Button
        aria-disabled={locked || undefined}
        aria-label={nameFor(rejectLabel)}
        className={lockedClass}
        loading={isTarget && resolving?.action === "reject"}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (isResolving) {
            return;
          }
          onReject();
        }}
        size="sm"
        type="button"
        variant="outline"
      >
        <X
          className="text-(--essay-suggestion-delete-ink)"
          data-icon="inline-start"
        />
        <span className={labelClass}>{rejectLabel}</span>
      </Button>
    </div>
  );
}
