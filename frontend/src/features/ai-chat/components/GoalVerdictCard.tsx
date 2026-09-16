import type { GoalStepDetail } from "@/api/chat/types";
import { Badge } from "@/components/ui/badge";

import { CriterionRow } from "./GoalHeader";
import { goalStatusPresentation } from "./goal-status";

function formatElapsed(elapsedSeconds: number): string {
  const totalSeconds = Math.max(0, Math.round(elapsedSeconds));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0
    ? `${minutes}m ${seconds.toString().padStart(2, "0")}s`
    : `${seconds}s`;
}

function formatCost(estCostUsd: number | null): string {
  return estCostUsd === null ? "—" : `~$${estCostUsd.toFixed(2)}`;
}

/**
 * The closing card (plans/goal-mode-plan.md §5.2 point 7, §5.3). Renders in
 * the settled slot below the frozen stream — never above it, and it never
 * causes anything above it to re-render (invariant 3). Only rendered for a
 * genuine `phase: "final"` step: a crashed/interrupted run never reaches a
 * verdict, so it gets the header's "Stopped — interrupted" state and no
 * card at all, rather than a card fabricating a judgment nothing produced.
 */
export function GoalVerdictCard({ detail }: { detail: GoalStepDetail }) {
  const { headline, badge } = goalStatusPresentation(detail.status, false);
  const hasNotChecked = detail.not_checked_note.trim().length > 0;

  return (
    <div
      aria-label="Goal result"
      className="not-prose mt-3 rounded-xl bg-[var(--surface-raised)] px-3.5 py-3"
      role="region"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="text-sm font-medium text-foreground">Goal</span>
          <p className="mt-0.5 text-sm text-foreground [overflow-wrap:anywhere]">
            {detail.statement}
          </p>
        </div>
        <Badge variant={badge}>{headline}</Badge>
      </div>

      <div className="mt-3 rounded-lg bg-[var(--surface-inset)] px-3 py-2.5">
        <ol className="flex flex-col gap-2">
          {detail.criteria.map((criterion) => (
            <CriterionRow criterion={criterion} key={criterion.id} running={false} />
          ))}
        </ol>
      </div>

      {/* The one mandatory piece of explanatory copy in the feature (§5.9,
          C11): "Achieved" means these criteria are met, never that the
          broader stated goal is fully handled. */}
      {hasNotChecked && (
        <p className="mt-3 text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
          Not checked: {detail.not_checked_note}
        </p>
      )}

      {/* The ledger renders even at zero — silence about cost is not
          honest (see plan §5.2, "the ledger renders even at zero"). */}
      <p className="mt-3 text-xs tabular-nums text-muted-foreground">
        {detail.iteration} {detail.iteration === 1 ? "round" : "rounds"} ·{" "}
        {detail.requests_used} {detail.requests_used === 1 ? "request" : "requests"} ·{" "}
        {formatCost(detail.est_cost_usd)} · {formatElapsed(detail.elapsed_s)}
      </p>
    </div>
  );
}
