import type { GoalStepDetail } from "@/api/chat/types";
import { cn } from "@/lib/utils";

import { CriterionRow } from "./GoalHeader";
import { goalStatusPresentation, goalToneClass } from "./goal-status";

function formatElapsed(elapsedSeconds: number): string {
  const totalSeconds = Math.max(0, Math.round(elapsedSeconds));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0
    ? `${minutes}m ${seconds.toString().padStart(2, "0")}s`
    : `${seconds}s`;
}

/**
 * The closing result (plans/goal-mode-plan.md §5.2 point 7, §5.3). Renders in
 * the settled slot below the frozen stream — never above it, and it never
 * causes anything above it to re-render (invariant 3). Only rendered for a
 * genuine `phase: "final"` step: a crashed/interrupted run never reaches a
 * verdict, so it gets the goal line's interrupted state and no result at
 * all, rather than one fabricating a judgment nothing produced.
 *
 * The goal statement is not repeated here — the goal line at the top of the
 * message already carries it. This is the one place the checked criteria
 * are laid out in full.
 */
export function GoalVerdictCard({ detail }: { detail: GoalStepDetail }) {
  const { headline, tone } = goalStatusPresentation(detail.status, false);
  const hasNotChecked = detail.not_checked_note.trim().length > 0;

  return (
    <div
      aria-label="Goal result"
      className="not-prose mt-4 rounded-lg bg-[var(--control-track)] px-3.5 py-3"
      role="region"
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className={cn("text-sm font-medium", goalToneClass[tone])}>
          {headline}
        </p>
        {/* The list below already shows what was met. The only numbers worth
            a student's attention are how long it took and, when the run was
            sent back to work, how many checks that took. */}
        <p className="flex shrink-0 items-baseline gap-2 text-xs tabular-nums text-muted-foreground">
          {detail.iteration > 1 && <span>Checked {detail.iteration} times</span>}
          <span>{formatElapsed(detail.elapsed_s)}</span>
        </p>
      </div>

      <ol className="mt-3 flex flex-col gap-2">
        {detail.criteria.map((criterion) => (
          <CriterionRow
            criterion={criterion}
            key={criterion.id}
            mayStillBeChecked={false}
          />
        ))}
      </ol>

      {/* The one mandatory piece of explanatory copy in the feature (§5.9,
          C11): "All done" means these criteria are met, never that the
          broader stated goal is fully handled. */}
      {hasNotChecked && (
        <p className="mt-3 text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
          Not checked: {detail.not_checked_note}
        </p>
      )}
    </div>
  );
}
