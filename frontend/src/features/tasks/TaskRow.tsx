// The single most important component in the tasks redesign
// (plans/tasks-redesign-plan.md P5.3). Built to
// plans/tasks-redesign-design.md §3 (geometry, the redundancy rule,
// checkbox, title, agent glyph, derived label, When chip, deadline chip,
// flag, hover-revealed affordances, row states, responsive) and §4 (the
// completion motion) exactly. Every colour used below is on the §9.1
// permitted list.
import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { CalendarPlus, CircleAlert, Flag, GripVertical, Sparkles } from "lucide-react";

import type { ApplicationView, EssaySummary } from "@/api/workspace/types";
import { Checkbox } from "@/components/ui/checkbox";
import type { Task } from "@/domain/task";
import { getDerivedLabel } from "@/features/tasks/task-config";
import {
  formatDeadline,
  formatWhenChip,
  getDeadlineState,
  parseDateOnly,
} from "@/features/tasks/task-dates";
import { cn } from "@/lib/utils";

export type TaskRowProps = {
  task: Task;
  applicationsById: ReadonlyMap<string, ApplicationView>;
  essaysById: ReadonlyMap<string, EssaySummary>;
  /** Which meta the surrounding group already states — suppressed per §3.2. */
  suppress?: { label?: boolean; when?: boolean };
  isSelected: boolean;
  showReorderGrip?: boolean; // Today only, P9
  onOpen: (taskId: string) => void;
  onComplete: (taskId: string, done: boolean) => void;
  onSchedule: (taskId: string, field: "when_on" | "deadline_on") => void;
  onToggleFlag: (taskId: string) => void;
};

// ---- §4.1 / §4.2 timeline constants, in milliseconds. Every value is from
// the design doc's timeline diagram; none is invented. (The strike-through
// draw/retract durations — 180ms / 120ms — are Tailwind `after:duration-[…]`
// literals in the JSX below rather than constants here: Tailwind's JIT scan
// needs a complete, static class string, so it cannot consume a JS value.)
const COMPLETE_DWELL_MS = 300; // §4.1 step 4: the hold before the row starts to exit.
const ROW_EXIT_MS = 140;
const ROW_EXIT_MS_REDUCED = 100; // §4.3: row exit stays 100ms under reduced motion.
const UNCHECK_DWELL_MS = 200; // §4.2: the row leaves the Logbook at t=200.
const UNCHECK_EXIT_MS = 140; // §4.2: "the same 140ms fade."

// §4.1 step 5 — "the existing tasks spring, reused not reinvented"
// (DESIGN.md §12.3, already used by TaskCard.tsx / UpcomingTasksView.tsx).
const SIBLING_SPRING = { type: "spring", stiffness: 420, damping: 34, mass: 0.8 } as const;

/** The overdue `aria-label`'s long-form date, e.g. `1 January`. */
function formatOverdueAriaDate(deadlineOn: string): string {
  const date = parseDateOnly(deadlineOn);
  const monthLong = new Intl.DateTimeFormat("en-US", { month: "long" }).format(date);
  return `${date.getDate()} ${monthLong}`;
}

function DeadlineChip({ task }: { task: Task }) {
  const state = getDeadlineState(task.deadline_on);

  if (state === "hidden" || !task.deadline_on) {
    return null;
  }

  const word = state === "overdue" ? "overdue" : "due";
  const date = formatDeadline(task.deadline_on);
  const ariaLabel =
    state === "overdue"
      ? `Overdue — deadline was ${formatOverdueAriaDate(task.deadline_on)}`
      : undefined;

  return (
    <span
      aria-label={ariaLabel}
      className="inline-flex shrink-0 items-center gap-1 text-xs tabular-nums"
    >
      {state === "overdue" && (
        <CircleAlert aria-hidden="true" className="size-3 shrink-0 text-[var(--danger-fg)]" />
      )}
      <span
        aria-hidden={ariaLabel ? "true" : undefined}
        className={cn(
          state === "overdue" && "font-medium text-[var(--danger-fg)]",
          (state === "due-soon" || state === "normal") && "text-[var(--ink-faint)]",
        )}
      >
        {word}
      </span>
      <span
        aria-hidden={ariaLabel ? "true" : undefined}
        className={cn(
          "font-normal",
          state === "overdue" && "font-medium text-[var(--danger-fg)]",
          state === "due-soon" && "font-medium text-[var(--warning-fg)]",
          state === "normal" && "text-[var(--ink-secondary)]",
        )}
      >
        {date}
      </span>
    </span>
  );
}

export function TaskRow({
  task,
  applicationsById,
  essaysById,
  suppress = {},
  isSelected,
  showReorderGrip = false,
  onOpen,
  onComplete,
  onSchedule,
  onToggleFlag,
}: TaskRowProps) {
  const shouldReduceMotion = useReducedMotion();
  const isDone = Boolean(task.done_at);

  // ---- §4: the completion motion is choreographed locally, independent of
  // when the parent's mutation actually resolves. `onComplete` itself is
  // deferred until the visual sequence finishes (see `runTimeline` below),
  // so the actual removal-from-list / Logbook-restoration the parent does
  // in response only happens once the student has seen the full 440ms (or
  // 340ms, un-checking) they were promised. ----
  const [visualDone, setVisualDone] = useState(isDone);
  const [isRowExiting, setIsRowExiting] = useState(false);
  const [isUnchecking, setIsUnchecking] = useState(false);
  const [exitDurationMs, setExitDurationMs] = useState(ROW_EXIT_MS);
  const [syncedIsDone, setSyncedIsDone] = useState(isDone);
  const timeoutsRef = useRef<number[]>([]);

  // An externally-driven done-state change (toggled from the detail panel,
  // or on first mount) syncs instantly — the timeline below only runs for a
  // click that originates on this row's own checkbox. This is React's
  // "adjusting state when a prop changes" pattern (a guarded setState call
  // during render, not inside an effect) rather than a `useEffect` keyed on
  // `isDone`, which would re-render twice for the same update.
  if (isDone !== syncedIsDone) {
    setSyncedIsDone(isDone);
    setVisualDone(isDone);
    setIsRowExiting(false);
    setIsUnchecking(false);
  }

  useEffect(() => {
    const timeouts = timeoutsRef.current;
    return () => {
      timeouts.forEach((id) => window.clearTimeout(id));
    };
  }, []);

  function schedule(fn: () => void, delayMs: number) {
    timeoutsRef.current.push(window.setTimeout(fn, delayMs));
  }

  function handleCheckedChange(nextChecked: boolean) {
    setVisualDone(nextChecked);
    setIsUnchecking(!nextChecked);

    if (nextChecked) {
      const exitMs = shouldReduceMotion ? ROW_EXIT_MS_REDUCED : ROW_EXIT_MS;
      setExitDurationMs(exitMs);
      schedule(() => setIsRowExiting(true), COMPLETE_DWELL_MS);
      schedule(() => onComplete(task.id, true), COMPLETE_DWELL_MS + exitMs);
    } else {
      // §4.2 — un-checking mirrors completion but faster, with no spring on
      // re-entry ("the student is not looking at it").
      setExitDurationMs(UNCHECK_EXIT_MS);
      schedule(() => setIsRowExiting(true), UNCHECK_DWELL_MS);
      schedule(() => onComplete(task.id, false), UNCHECK_DWELL_MS + UNCHECK_EXIT_MS);
    }
  }

  const derivedLabel = getDerivedLabel(task, applicationsById, essaysById);
  const showLabel = Boolean(derivedLabel) && !suppress.label;

  const showWhenChip = Boolean(task.when_on) && !suppress.when;
  const whenLabel = task.when_on ? formatWhenChip(task.when_on) : undefined;

  const deadlineState = getDeadlineState(task.deadline_on);
  const hasDeadlineChip = deadlineState !== "hidden";

  const isAgentCreated = task.created_by_actor === "counselle";

  return (
    <motion.li
      animate={{ opacity: isRowExiting ? 0 : 1 }}
      className={cn(
        "group/row relative flex h-11 items-center gap-3 rounded-md px-2 outline-none md:h-9",
        "transition-[background-color] duration-150 ease-out motion-reduce:transition-none",
        isSelected
          ? "bg-[var(--surface-selected)] hover:bg-[var(--task-row-selected-hover)]"
          : "bg-transparent hover:bg-[var(--canvas-hover)] focus-within:bg-[var(--canvas-hover)] active:bg-[var(--canvas-active)]",
      )}
      data-selected={isSelected || undefined}
      data-slot="task-row"
      exit={{ opacity: 0, transition: { duration: 0 } }}
      layout="position"
      transition={{
        layout: shouldReduceMotion ? { duration: 0 } : SIBLING_SPRING,
        opacity: { duration: exitDurationMs / 1000, ease: "easeOut" },
      }}
    >
      {showReorderGrip && (
        // P9 wires the actual pointerdown-armed drag and the ⌥↑/↓ keyboard
        // path (design doc §3.10.2) against its own props; this phase only
        // renders the affordance's reserved presence, so it stays
        // non-interactive rather than shipping a button with no handler.
        <span
          aria-hidden="true"
          className={cn(
            "absolute top-1/2 left-0 hidden -translate-y-1/2 items-center justify-center text-[var(--ink-faint)] opacity-0",
            "transition-[opacity] duration-150 ease-out motion-reduce:transition-none",
            "group-hover/row:opacity-100 group-focus-within/row:opacity-100",
            "pointer-coarse:hidden md:flex",
          )}
        >
          <GripVertical className="size-3.5" />
        </span>
      )}

      <span onClick={(event) => event.stopPropagation()}>
        <Checkbox
          aria-label={`Complete "${task.title}"`}
          checked={visualDone}
          className="shrink-0"
          onCheckedChange={(checked) => handleCheckedChange(checked === true)}
        />
      </span>

      <div
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--canvas)]"
        onClick={(event) => {
          event.stopPropagation();
          onOpen(task.id);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.stopPropagation();
            onOpen(task.id);
          }
        }}
        role="button"
        tabIndex={0}
      >
        <span
          className={cn(
            "relative truncate text-sm leading-5 font-normal text-[var(--ink)]",
            "transition-[color] duration-200 ease-out",
            "after:absolute after:inset-x-0 after:top-1/2 after:h-px after:bg-[var(--ink-faint)] after:content-[''] after:[clip-path:inset(0_100%_0_0)]",
            "after:transition-[clip-path] after:ease-out after:motion-reduce:hidden",
            isUnchecking ? "after:duration-[120ms]" : "after:duration-[180ms]",
            visualDone && "text-[var(--ink-faint)] after:[clip-path:inset(0_0_0_0)] motion-reduce:line-through",
          )}
          data-done={visualDone || undefined}
          title={task.title}
        >
          {task.title}
        </span>
        {isAgentCreated && (
          <>
            <Sparkles aria-hidden="true" className="size-3 shrink-0 text-[var(--ink-faint)]" />
            <span className="sr-only">Created by Counselle</span>
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {showLabel && (
          <span className="max-w-[7rem] truncate text-xs leading-4 font-normal text-[var(--ink-faint)] sm:max-w-[11rem]">
            {derivedLabel}
          </span>
        )}

        {showWhenChip ? (
          <button
            aria-label={`Reschedule ${task.title}, currently ${whenLabel}`}
            className={cn(
              "-mx-1.5 inline-flex h-5 shrink-0 items-center rounded-sm px-1.5 text-xs tabular-nums text-[var(--ink-secondary)] outline-none",
              "transition-[background-color] duration-150 ease-out",
              "hover:bg-[var(--surface-inset)] active:bg-[var(--control-quiet-active)]",
              "focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--canvas)]",
              hasDeadlineChip && "hidden sm:inline-flex",
            )}
            onClick={(event) => {
              event.stopPropagation();
              onSchedule(task.id, "when_on");
            }}
            type="button"
          >
            {whenLabel}
          </button>
        ) : (
          <button
            aria-label={`Add a when date to "${task.title}"`}
            className={cn(
              "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-[var(--ink-faint)] opacity-0 outline-none",
              "transition-[opacity,background-color] duration-150 ease-out motion-reduce:transition-none",
              "hover:bg-[var(--surface-inset)]",
              "focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--canvas)]",
              "group-hover/row:opacity-100 group-focus-within/row:opacity-100",
            )}
            onClick={(event) => {
              event.stopPropagation();
              onSchedule(task.id, "when_on");
            }}
            type="button"
          >
            <CalendarPlus aria-hidden="true" className="size-3.5" />
          </button>
        )}

        <DeadlineChip task={task} />

        {task.flagged && (
          <button
            aria-label={`Remove flag from "${task.title}"`}
            className={cn(
              "-m-0.5 inline-flex shrink-0 items-center rounded-sm p-0.5 text-[var(--task-flag-ink)] outline-none",
              "transition-[background-color] duration-150 ease-out",
              "hover:bg-[var(--surface-inset)]",
              "focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--canvas)]",
            )}
            onClick={(event) => {
              event.stopPropagation();
              onToggleFlag(task.id);
            }}
            type="button"
          >
            <Flag aria-hidden="true" className="size-3.5" fill="currentColor" />
          </button>
        )}
      </div>
    </motion.li>
  );
}
