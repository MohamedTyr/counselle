import {
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleDashedIcon,
  CircleIcon,
  XCircleIcon,
} from "lucide-react";
import { useState } from "react";

import type { GoalCriterionView, GoalStepDetail } from "@/api/chat/types";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Meter, MeterIndicator, MeterTrack } from "@/components/ui/meter";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { goalStatusPresentation } from "./goal-status";

/** Whether a run is still actively working toward its criteria — the only
 * state where an unattempted criterion reads "not yet checked" rather than
 * the permanent "not checked" (C9). */
function isGoalRunning(detail: GoalStepDetail, isInterrupted: boolean): boolean {
  return detail.status === null && !isInterrupted;
}

/** One criterion's icon + `sr-only` text. Deliberately spelled out rather
 * than delegated to `PlanChecklist`'s four-state icon vocabulary — a
 * binary criterion (met / not met / not checked) doesn't map onto a
 * pending/in-progress/completed/cancelled task (§5.7).
 *
 * Gates on `criterion.checked` FIRST, never on `criterion.met` alone (C9):
 * `checked` is the canonical "was this ever attempted" signal, and a
 * criterion the run never touched must never render as "not met" — that is
 * an unambiguous false claim, not a rounding of "unknown". Only once
 * `checked` is true does `met` get to decide pass vs. fail. */
function CriterionMark({
  criterion,
  running,
}: {
  criterion: GoalCriterionView;
  running: boolean;
}) {
  if (!criterion.checked) {
    // "Not yet checked" (running, may still happen) vs. "not checked"
    // (terminal, never will) are given both a shape AND a color
    // differentiator — not stroke pattern alone — so the distinction
    // survives anything but the finest-grained vision impairment (MEDIUM
    // finding: solid vs. dashed stroke at the same muted color was too
    // subtle to rely on).
    return running ? (
      <span className="mt-0.5 flex size-4 items-center justify-center text-[var(--warning-fg)]">
        <CircleIcon aria-hidden="true" className="size-3.5" />
        <span className="sr-only">not yet checked: </span>
      </span>
    ) : (
      <span className="mt-0.5 flex size-4 items-center justify-center text-muted-foreground">
        <CircleDashedIcon aria-hidden="true" className="size-3.5" />
        <span className="sr-only">not checked: </span>
      </span>
    );
  }

  if (criterion.met === true) {
    return (
      <span className="mt-0.5 flex size-4 items-center justify-center text-[var(--success-fg)]">
        <CheckCircle2Icon aria-hidden="true" className="size-3.5" />
        <span className="sr-only">met: </span>
      </span>
    );
  }

  return (
    <span className="mt-0.5 flex size-4 items-center justify-center text-destructive">
      <XCircleIcon aria-hidden="true" className="size-3.5" />
      <span className="sr-only">not met: </span>
    </span>
  );
}

/** A criterion row shared by the header and the closing card, so the two
 * read as one object rather than two independently-styled lists. A `reason`
 * renders as plain text directly beneath the row — never behind a
 * disclosure (C5): a failed or unchecked criterion's explanation is exactly
 * the fact a student most needs to see without a click. */
export function CriterionRow({
  criterion,
  running,
}: {
  criterion: GoalCriterionView;
  running: boolean;
}) {
  return (
    <li className="grid grid-cols-[16px_minmax(0,1fr)] gap-2 text-sm leading-5">
      <CriterionMark criterion={criterion} running={running} />
      <div className="min-w-0">
        <span
          className={cn(
            criterion.met === true
              ? "text-muted-foreground"
              : "text-foreground",
            "[overflow-wrap:anywhere]",
          )}
        >
          {criterion.text}
        </span>
        {/* Reason text is load-bearing only for an unmet or unchecked
            criterion — a met criterion restating why it passed is exactly
            the descriptive-copy-under-a-label pattern AGENTS.md forbids
            (§5.9). */}
        {criterion.met !== true &&
          criterion.reason !== null &&
          criterion.reason.length > 0 && (
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
            {criterion.reason}
          </p>
        )}
      </div>
    </li>
  );
}

function CriteriaSkeleton() {
  return (
    <div aria-hidden="true" className="mt-3 flex flex-col gap-2">
      <Skeleton className="h-3.5 w-3/4" />
      <Skeleton className="h-3.5 w-1/2" />
    </div>
  );
}

function budgetPercent(detail: GoalStepDetail): number | null {
  if (detail.requests_limit <= 0) {
    return null;
  }
  return Math.round((detail.requests_used / detail.requests_limit) * 100);
}

/**
 * The pinned goal header (plans/goal-mode-plan.md §5.2–§5.3). Derived from
 * the latest `goal` step, exactly the way `PlanChecklist` derives from the
 * latest `write_plan` step — so it never drifts from what streamed, and by
 * the time `done` fires it already shows the last streamed frame
 * (invariant 3).
 *
 * `isInterrupted` is computed by the caller via `isInterruptedGoal` and
 * always wins over `detail.status === null` — the one case a `null` status
 * does NOT mean "still running" (§5.3's crash rule).
 */
export function GoalHeader({
  detail,
  isInterrupted = false,
}: {
  detail: GoalStepDetail;
  isInterrupted?: boolean;
}) {
  const [criteriaOpen, setCriteriaOpen] = useState(true);
  const running = isGoalRunning(detail, isInterrupted);
  const { headline, badge } = goalStatusPresentation(detail.status, isInterrupted);
  const hasCriteria = detail.criteria.length > 0;
  const percent = budgetPercent(detail);

  return (
    <div
      aria-label="Goal"
      className="not-prose mb-3 rounded-xl bg-[var(--surface-raised)] px-3.5 py-3"
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

      {!hasCriteria && running && <CriteriaSkeleton />}

      {/* §5.2 point 3b: the one state where explanatory copy is warranted,
          because the student has to do something — criteria derivation
          failed before a single tool call ran, so there is nothing else to
          show. */}
      {!hasCriteria && detail.status === "stopped_check_failed" && (
        <p className="mt-2 text-sm text-muted-foreground">
          Counselle couldn't work out how to check this goal. Ask again, or
          say it as a checklist.
        </p>
      )}

      {hasCriteria && (
        <Collapsible
          className="mt-3 rounded-lg bg-[var(--surface-inset)] px-3 py-2.5"
          onOpenChange={setCriteriaOpen}
          open={criteriaOpen}
        >
          <div className="flex items-center justify-between gap-3">
            <span
              aria-label={`${detail.met_count} of ${detail.total_count} criteria met`}
              className="rounded-full bg-[var(--surface-raised)] px-2 py-1 text-xs tabular-nums text-muted-foreground"
            >
              {detail.met_count}/{detail.total_count}
            </span>
            {/* Only reachable at narrow widths — the expanded (sm+) header
                never collapses its criteria (§5.8). */}
            <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground sm:hidden">
              {criteriaOpen ? "Hide" : "Show"}
              <ChevronDownIcon
                aria-hidden="true"
                className={cn(
                  "size-3.5 motion-safe:transition-transform motion-safe:duration-200",
                  criteriaOpen && "rotate-180",
                )}
              />
            </CollapsibleTrigger>
          </div>

          {running && (
            <div className="mt-2 hidden items-center gap-2 sm:flex">
              <Meter
                aria-label="Goal progress"
                className="flex-1 gap-0"
                max={Math.max(detail.total_count, 1)}
                value={detail.met_count}
              >
                <MeterTrack className="h-1 rounded-full">
                  <MeterIndicator className="rounded-full motion-safe:transition-[transform] motion-safe:duration-200" />
                </MeterTrack>
              </Meter>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                round {detail.iteration} of {detail.max_iterations}
                {percent !== null && ` · ${percent}% budget`}
              </span>
            </div>
          )}

          <CollapsibleContent className="sm:!block">
            <ol className="mt-2.5 flex flex-col gap-2">
              {detail.criteria.map((criterion) => (
                <CriterionRow
                  criterion={criterion}
                  key={criterion.id}
                  running={running}
                />
              ))}
            </ol>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
