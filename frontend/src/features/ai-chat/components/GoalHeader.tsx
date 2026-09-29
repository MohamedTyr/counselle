import {
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleDashedIcon,
  CircleIcon,
  TargetIcon,
  XCircleIcon,
} from "lucide-react";
import { useState } from "react";

import type { GoalCriterionView, GoalStepDetail } from "@/api/chat/types";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

import {
  goalStatusPresentation,
  goalToneClass,
  type GoalTone,
} from "./goal-status";

/** Whether a run is still actively working toward its criteria — drives the
 * goal line's live/pulsing icon. */
function isGoalRunning(
  detail: GoalStepDetail,
  isInterrupted: boolean,
): boolean {
  return detail.status === null && !isInterrupted;
}

/** Whether an unattempted criterion may still be checked — true while
 * running AND while paused on `awaiting_input`, since that run resumes and
 * will reach a real verdict. Only once neither holds does an unattempted
 * criterion become the permanent "not checked" (C9). */
function mayStillBeChecked(
  detail: GoalStepDetail,
  isInterrupted: boolean,
  wasStoppedByUser: boolean,
): boolean {
  if (isInterrupted || wasStoppedByUser) {
    return false;
  }
  return detail.status === null || detail.status === "awaiting_input";
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
  mayStillBeChecked,
}: {
  criterion: GoalCriterionView;
  mayStillBeChecked: boolean;
}) {
  if (!criterion.checked) {
    // "Not yet checked" (may still happen — running, or paused on the
    // student's answer) vs. "not checked" (terminal, never will) are given
    // both a shape AND a color differentiator — not stroke pattern alone —
    // so the distinction survives anything but the finest-grained vision
    // impairment (MEDIUM finding: solid vs. dashed stroke at the same muted
    // color was too subtle to rely on).
    return mayStillBeChecked ? (
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
  mayStillBeChecked,
}: {
  criterion: GoalCriterionView;
  mayStillBeChecked: boolean;
}) {
  return (
    <li className="grid grid-cols-[16px_minmax(0,1fr)] gap-2 text-sm leading-5">
      <CriterionMark criterion={criterion} mayStillBeChecked={mayStillBeChecked} />
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

/** The one row every goal state shares: the mark, the word "Goal", and
 * where the run stands. The statement is the student's own message, sitting
 * directly above this row — repeating it visually is noise, so it is kept
 * for assistive tech only. */
function GoalLine({
  children,
  live,
  statement,
  status,
  tone,
}: {
  children?: React.ReactNode;
  live: boolean;
  statement?: string;
  status: string;
  tone: GoalTone;
}) {
  return (
    <div aria-label="Goal" className="not-prose mb-3" role="region">
      <div className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-3">
        <span
          aria-hidden="true"
          className={cn(
            "flex h-5 items-center justify-center",
            goalToneClass[tone],
          )}
        >
          <TargetIcon
            className={cn("size-4", live && "motion-safe:animate-pulse")}
            strokeWidth={2}
          />
        </span>
        <div className="min-w-0">
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm leading-5">
            <span className="font-medium text-foreground">Goal</span>
            {statement !== undefined && (
              <span className="sr-only">{statement}.</span>
            )}
            <span aria-live="polite" className={goalToneClass[tone]}>
              {status}
            </span>
          </p>
          {children}
        </div>
      </div>
    </div>
  );
}

/** The goal line before the backend has emitted a single `goal` step — a
 * `/goal` turn spends its first seconds deciding what "done" means, and the
 * student should see that, not a generic start. */
export function GoalLinePending() {
  return (
    <GoalLine live status="Working out what done looks like" tone="neutral" />
  );
}

function timesChecked(count: number): string {
  if (count === 1) {
    return "once";
  }
  return count === 2 ? "twice" : `${count} times`;
}

/** The run's state as one line under the goal — the only always-on
 * indicator a goal run needs. A `check` step's `iteration` is the number of
 * checks completed so far, and saying so is what tells a student the run
 * was sent back to work rather than simply taking a long time. */
function statusLine(
  detail: GoalStepDetail,
  headline: string,
  running: boolean,
): string {
  if (!running) {
    return headline;
  }
  if (detail.criteria.length === 0) {
    return "Starting";
  }
  return detail.phase === "check"
    ? `Checked ${timesChecked(detail.iteration)}, still working`
    : headline;
}

/**
 * The goal line (plans/goal-mode-plan.md §5.2–§5.3). One row, not a card:
 * the agent's own plan, directly beneath it, is the run's single progress
 * list — this only says what the run is working toward and where it stands.
 * What the independent check looks for sits behind a closed disclosure, so
 * it stays inspectable without reading as a second to-do list.
 *
 * Derived from the latest `goal` step, so it never drifts from what
 * streamed. `isInterrupted` is computed by the caller via
 * `isInterruptedGoal` and always wins over `detail.status === null` — the
 * one case a `null` status does NOT mean "still running" (§5.3's crash rule).
 *
 * `stoppedByUser` is the turn's own `cancelled` status. A run the student
 * stops can end without ever reaching a `final` step; calling that
 * "interrupted" would describe their own deliberate action as a failure.
 */
export function GoalHeader({
  detail,
  isInterrupted = false,
  stoppedByUser = false,
}: {
  detail: GoalStepDetail;
  isInterrupted?: boolean;
  stoppedByUser?: boolean;
}) {
  const [criteriaOpen, setCriteriaOpen] = useState(false);
  const wasStoppedByUser = stoppedByUser && detail.status === null;
  const running = isGoalRunning(detail, isInterrupted) && !wasStoppedByUser;
  const criteriaMayStillBeChecked = mayStillBeChecked(
    detail,
    isInterrupted,
    wasStoppedByUser,
  );
  const { headline, tone } = goalStatusPresentation(
    wasStoppedByUser ? "stopped_user" : detail.status,
    isInterrupted && !wasStoppedByUser,
  );
  const hasCriteria = detail.criteria.length > 0;
  // Once a verdict exists the result below carries the checked criteria; the
  // header keeps them only while it is the sole place to see them — while
  // the run works, and while it waits on the student's answer.
  const showCriteria =
    hasCriteria &&
    (detail.status === null || detail.status === "awaiting_input");

  return (
    <GoalLine
      live={running}
      statement={detail.statement}
      status={statusLine(detail, headline, running)}
      tone={tone}
    >
      {/* §5.2 point 3b: the one state where explanatory copy is
              warranted, because the student has to do something — the check
              could not be set up, so nothing ran. */}
      {!hasCriteria && detail.status === "stopped_check_failed" && (
        <p className="mt-1 text-sm leading-5 text-muted-foreground">
          Counselle couldn't work out how to check this goal. Ask again, or say
          it as a checklist.
        </p>
      )}

      {showCriteria && (
        <Collapsible onOpenChange={setCriteriaOpen} open={criteriaOpen}>
          <CollapsibleTrigger className="mt-1 -ml-1 flex items-center gap-1 rounded-md px-1 py-0.5 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            <ChevronRightIcon
              aria-hidden="true"
              className={cn(
                "size-3.5 motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-out",
                criteriaOpen && "rotate-90",
              )}
            />
            Done when
            {detail.met_count > 0 && (
              <span className="ml-1 tabular-nums">
                {detail.met_count} of {detail.total_count} so far
              </span>
            )}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ol className="mt-1.5 flex flex-col gap-1.5">
              {detail.criteria.map((criterion) => (
                <CriterionRow
                  criterion={criterion}
                  key={criterion.id}
                  mayStillBeChecked={criteriaMayStillBeChecked}
                />
              ))}
            </ol>
          </CollapsibleContent>
        </Collapsible>
      )}
    </GoalLine>
  );
}
