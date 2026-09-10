// The single most important component in the tasks redesign
// (plans/tasks-redesign-plan.md P5.3). Built to
// plans/tasks-redesign-design.md §3 (geometry, the redundancy rule,
// checkbox, title, agent glyph, derived label, When chip, deadline chip,
// flag, hover-revealed affordances, row states, responsive) and §4 (the
// completion motion) exactly. Every colour used below is on the §9.1
// permitted list.
import { useEffect, useRef, useState, type DragEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  CalendarPlus,
  CircleAlert,
  Flag,
  GripVertical,
  MoreHorizontal,
  Sparkles,
} from "lucide-react";

import type { ApplicationView, EssaySummary } from "@/api/workspace/types";
import { Checkbox } from "@/components/ui/checkbox";
import type { Task } from "@/domain/task";
import { SchedulerPopover } from "@/features/tasks/SchedulerPopover";
import {
  TaskRowActionsMenu,
  TaskRowContextMenu,
  type TaskRowActions,
} from "@/features/tasks/TaskRowMenu";
import { getDerivedLabel } from "@/features/tasks/task-config";
import {
  formatDeadline,
  formatWhenChip,
  getDeadlineState,
  parseDateOnly,
} from "@/features/tasks/task-dates";
import { cn } from "@/lib/utils";

/**
 * Today-only manual reorder wiring (plan P9, design doc §3.10.2). Presence
 * of this prop is what shows the grip; the three DnD callbacks are
 * `useTaskReorder`'s `startDrag`/`dragOverTask`/`drop`/`endDrag`, already
 * bound to this row's own `task.id` by the caller (TodayView).
 */
export type TaskRowReorderHandlers = {
  onDragStart: () => void;
  onDragOverRow: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
};

export type TaskRowProps = {
  task: Task;
  applicationsById: ReadonlyMap<string, ApplicationView>;
  essaysById: ReadonlyMap<string, EssaySummary>;
  /** Which meta the surrounding group already states — suppressed per §3.2. */
  suppress?: { label?: boolean; when?: boolean };
  isSelected: boolean;
  reorder?: TaskRowReorderHandlers;
  /**
   * Render the schedule affordance at rest instead of on hover. Only the two
   * groups that exist to say "this needs a when" set it — Today's "Due soon"
   * and Upcoming's "Deadlines without a plan" (plan P6.2).
   */
  scheduleAffordanceAtRest?: boolean;
} & TaskRowActions;

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
const SIBLING_SPRING = {
  type: "spring",
  stiffness: 420,
  damping: 34,
  mass: 0.8,
} as const;

/**
 * The row's two icon affordances (flag, `...`). One class string because they
 * are one control shape — 20px square, quiet until touched — and letting them
 * drift is how a row cluster starts looking assembled rather than designed.
 */
const ACTION_BUTTON_CLASS = cn(
  "inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-[var(--ink-faint)] outline-none",
  "transition-[opacity,background-color,color] duration-150 ease-out motion-reduce:transition-none",
  "hover:bg-[var(--surface-inset)] hover:text-[var(--ink-secondary)] active:bg-[var(--control-quiet-active)]",
  "focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--canvas)]",
);

/** Hidden at rest, revealed when the row is hovered or holds focus. The box
 * is always there — only the contents fade — so the row never reflows. */
const REVEAL_ON_ROW_HOVER = cn(
  "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100",
  // Stay up while the row's own menu is open, or the cluster vanishes at the
  // exact moment the student is using it.
  "group-data-[state=open]/row:opacity-100 group-has-data-[state=open]/row:opacity-100",
);

/**
 * A coarse pointer has no hover and no right-click, so nothing that waits for
 * hover is reachable there at all. Since the `...` menu now carries only what
 * the row cannot do (TaskRowMenu), hiding these on touch would leave a phone
 * with no path to flag or to schedule — so they stay up at rest instead. The
 * cost is ~40px of title width on a 390px row; the alternative was burying
 * the two most-used verbs two taps deep on the device where they matter most.
 */
const ALWAYS_ON_TOUCH = cn(REVEAL_ON_ROW_HOVER, "pointer-coarse:opacity-100");

/** The overdue `aria-label`'s long-form date, e.g. `1 January`. */
function formatOverdueAriaDate(deadlineOn: string): string {
  const date = parseDateOnly(deadlineOn);
  const monthLong = new Intl.DateTimeFormat("en-US", { month: "long" }).format(
    date,
  );
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
        <CircleAlert
          aria-hidden="true"
          className="size-3 shrink-0 text-[var(--danger-fg)]"
        />
      )}
      <span
        aria-hidden={ariaLabel ? "true" : undefined}
        className={cn(
          state === "overdue" && "font-medium text-[var(--danger-fg)]",
          (state === "due-soon" || state === "normal") &&
            "text-[var(--ink-faint)]",
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
  reorder,
  scheduleAffordanceAtRest = false,
  onOpen,
  onComplete,
  onSchedule,
  onToggleFlag,
  onDelete,
}: TaskRowProps) {
  const actions: TaskRowActions = {
    onComplete,
    onDelete,
    onOpen,
    onSchedule,
    onToggleFlag,
  };

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

  // `Set deadline…` in the row menu opens the same SchedulerPopover the When
  // chip and the detail panel use — presets, a calendar and `Anytime` — rather
  // than a submenu that could only offer presets. Its trigger is a zero-size
  // anchor in the row's right cluster, so the popover lands on the row it
  // belongs to. Opening is deferred a frame because the menu restores focus to
  // its own trigger as it closes, and the popover autofocuses its first row.
  const [isDeadlinePickerOpen, setIsDeadlinePickerOpen] = useState(false);

  function openDeadlinePicker() {
    requestAnimationFrame(() => setIsDeadlinePickerOpen(true));
  }

  // DESIGN.md §17.5 — "armed by pointerdown on a grip handle only." The row
  // is only `draggable` for the brief window between that pointerdown and
  // the drag ending, so a click anywhere else on the row never starts one.
  const [dragArmed, setDragArmed] = useState(false);

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
      schedule(
        () => onComplete(task.id, false),
        UNCHECK_DWELL_MS + UNCHECK_EXIT_MS,
      );
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
    <TaskRowContextMenu
      actions={actions}
      onPickDeadline={openDeadlinePicker}
      task={task}
    >
      <motion.li
        animate={{ opacity: isRowExiting ? 0 : 1 }}
        className={cn(
          "group/row relative flex h-11 items-center gap-3 rounded-md px-2 outline-none md:h-9",
          "transition-[background-color] duration-150 ease-out motion-reduce:transition-none",
          // The row rule. At 896px a bare row leaves ~400px of empty canvas
          // between a title and its date, and the eye stops tracking across it;
          // the hairline is what carries it. Inset to the spine so the checkbox
          // column reads as a gutter, and dropped on the last row of a group so
          // a group never closes with a dangling line.
          "before:pointer-events-none before:absolute before:right-2 before:bottom-0 before:left-[var(--task-row-spine)] before:h-px before:bg-[var(--hairline)]",
          "last:before:hidden",
          isSelected
            ? "bg-[var(--surface-selected)] hover:bg-[var(--task-row-selected-hover)]"
            : cn(
                "bg-transparent hover:bg-[var(--canvas-hover)] focus-within:bg-[var(--canvas-hover)] active:bg-[var(--canvas-active)]",
                // Radix marks its trigger `data-state=open`: for the context
                // menu that trigger is this row, for the `...` menu it is a
                // button inside it. Either way the row stays lit while its
                // menu is up, so the student never loses track of which row
                // they are acting on.
                "data-[state=open]:bg-[var(--canvas-hover)] has-data-[state=open]:bg-[var(--canvas-hover)]",
              ),
        )}
        data-selected={isSelected || undefined}
        data-slot="task-row"
        data-task-id={task.id}
        draggable={reorder ? dragArmed : undefined}
        exit={{ opacity: 0, transition: { duration: 0 } }}
        layout="position"
        onDragEnd={
          reorder
            ? () => {
                setDragArmed(false);
                reorder.onDragEnd();
              }
            : undefined
        }
        onDragOver={
          reorder
            ? (event: DragEvent<HTMLLIElement>) => {
                event.preventDefault();
                reorder.onDragOverRow();
              }
            : undefined
        }
        onDragStart={reorder ? () => reorder.onDragStart() : undefined}
        onDrop={
          reorder
            ? (event: DragEvent<HTMLLIElement>) => {
                event.preventDefault();
                reorder.onDrop();
              }
            : undefined
        }
        transition={{
          layout: shouldReduceMotion ? { duration: 0 } : SIBLING_SPRING,
          opacity: { duration: exitDurationMs / 1000, ease: "easeOut" },
        }}
      >
        {reorder && (
          // design doc §3.10.2 — the grip lives in the *list container's*
          // 16px gutter (the `<ul>` takes `pl-4`), not the row: `-left-4`
          // pulls it back into that gutter instead of the row's own content
          // box, so the row's own geometry — and the 36px spine — never
          // changes. DESIGN.md §17.5 — armed by pointerdown only.
          <span
            aria-hidden="true"
            className={cn(
              "absolute top-1/2 -left-4 hidden -translate-y-1/2 cursor-grab items-center justify-center text-[var(--ink-faint)] opacity-0",
              "active:cursor-grabbing",
              "transition-[opacity] duration-150 ease-out motion-reduce:transition-none",
              "group-hover/row:opacity-100 group-focus-within/row:opacity-100",
              "pointer-coarse:hidden md:flex",
            )}
            onPointerDown={() => setDragArmed(true)}
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

        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <div
            className="flex min-w-0 shrink cursor-pointer items-center gap-1.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--canvas)]"
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
                "relative min-w-0 truncate text-sm leading-5 font-normal text-[var(--ink)]",
                "transition-[color] duration-200 ease-out",
                "after:absolute after:inset-x-0 after:top-1/2 after:h-px after:bg-[var(--ink-faint)] after:content-[''] after:[clip-path:inset(0_100%_0_0)]",
                "after:transition-[clip-path] after:ease-out after:motion-reduce:hidden",
                isUnchecking
                  ? "after:duration-[120ms]"
                  : "after:duration-[180ms]",
                visualDone &&
                  "text-[var(--ink-faint)] after:[clip-path:inset(0_0_0_0)] motion-reduce:line-through",
              )}
              data-done={visualDone || undefined}
              title={task.title}
            >
              {task.title}
            </span>
            {isAgentCreated && (
              <>
                <Sparkles
                  aria-hidden="true"
                  className="size-3 shrink-0 text-[var(--ink-faint)]"
                />
                <span className="sr-only">Created by Counselle</span>
              </>
            )}
          </div>

          {/*
          The label sits with the title, not in the right-hand column. It is
          context *about this task* ("Essay · Penn"), so it belongs where the
          eye already is; only the date column is worth right-aligning, and
          only because a column of dates is what a task list is scanned by.
          It stays a *sibling* of the open-task button rather than a child:
          inside it, it would join that button's accessible name, so the row
          would announce as "Finish the Penn supplement Essay · Penn".
        */}
          {showLabel && (
            <span className="hidden max-w-[9rem] shrink truncate text-xs leading-4 font-normal text-[var(--ink-faint)] sm:inline sm:max-w-[14rem]">
              {derivedLabel}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/*
          Both affordances are the *trigger* of a SchedulerPopover, so
          rescheduling from any surface stays two clicks — the chip, then the
          choice (spec §13). Routing them through the detail panel instead
          would make it three.
        */}
          <SchedulerPopover
            field="when_on"
            onChange={(value) => onSchedule(task.id, "when_on", value)}
            value={task.when_on}
          >
            {showWhenChip ? (
              <button
                aria-label={`Reschedule ${task.title}, currently ${whenLabel}`}
                className={cn(
                  "-mx-1.5 inline-flex h-5 shrink-0 items-center rounded-sm px-1.5 text-xs tabular-nums text-[var(--ink-secondary)] outline-none",
                  "transition-[background-color] duration-150 ease-out",
                  "hover:bg-[var(--surface-inset)] active:bg-[var(--control-quiet-active)]",
                  "data-[popup-open]:bg-[var(--surface-inset)]",
                  "focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--canvas)]",
                  hasDeadlineChip && "hidden sm:inline-flex",
                )}
                onClick={(event) => event.stopPropagation()}
                type="button"
              >
                {whenLabel}
              </button>
            ) : scheduleAffordanceAtRest ? (
              // The two groups whose whole purpose is "this needs a when" —
              // Today's Due soon and Upcoming's Deadlines without a plan —
              // show the control at rest, because hiding the one thing that
              // resolves the group would defeat the group (plan P6.2). It is
              // also the one place the control carries a word: a bare glyph
              // beside a deadline chip reads as more date, not as a button.
              // `order-1` moves it past the deadline chip without moving it in
              // the DOM (nothing before it is focusable, so tab order is
              // unaffected) — that keeps every one of these buttons on a
              // single vertical line instead of stepping in and out with the
              // width of the date beside it.
              <button
                aria-label={`Add a when date to "${task.title}"`}
                className={cn(
                  "order-1 inline-flex h-5.5 shrink-0 items-center gap-1 rounded-md border border-[var(--edge)] px-1.5 text-xs text-[var(--ink-secondary)] outline-none",
                  "transition-[background-color,border-color,color] duration-150 ease-out motion-reduce:transition-none",
                  "hover:border-[var(--edge-strong)] hover:bg-[var(--surface-inset)] hover:text-[var(--ink)]",
                  "active:bg-[var(--control-quiet-active)]",
                  "data-[popup-open]:bg-[var(--surface-inset)]",
                  "focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--canvas)]",
                )}
                onClick={(event) => event.stopPropagation()}
                type="button"
              >
                <CalendarPlus aria-hidden="true" className="size-3.5" />
                <span className="hidden sm:inline">Plan it</span>
              </button>
            ) : (
              <button
                aria-label={`Add a when date to "${task.title}"`}
                className={cn(
                  ACTION_BUTTON_CLASS,
                  ALWAYS_ON_TOUCH,
                  "data-[popup-open]:bg-[var(--surface-inset)] data-[popup-open]:opacity-100",
                )}
                onClick={(event) => event.stopPropagation()}
                type="button"
              >
                <CalendarPlus aria-hidden="true" className="size-3.5" />
              </button>
            )}
          </SchedulerPopover>

          <DeadlineChip task={task} />

          {/*
          The two verbs that earn a permanent seat. Both keep their box at
          rest and only fade their contents in, so nothing on the row moves
          when the pointer arrives — a list that reflows under the cursor is
          a list you mis-click. A raised flag is a fact about the task, so it
          stays visible at rest; an unraised one is only an affordance, so it
          waits for hover. Everything rarer lives behind the `...` (and the
          same menu is on right-click).
        */}
          <button
            aria-label={
              task.flagged
                ? `Remove flag from "${task.title}"`
                : `Flag "${task.title}"`
            }
            aria-pressed={task.flagged}
            className={cn(
              ACTION_BUTTON_CLASS,
              "order-2",
              task.flagged
                ? "text-[var(--task-flag-ink)] opacity-100"
                : ALWAYS_ON_TOUCH,
            )}
            onClick={(event) => {
              event.stopPropagation();
              onToggleFlag(task.id);
            }}
            type="button"
          >
            <Flag
              aria-hidden="true"
              className="size-3.5 transition-[fill] duration-150 ease-out motion-reduce:transition-none"
              fill={task.flagged ? "currentColor" : "transparent"}
            />
          </button>

          {/* The deadline picker's anchor: no size, no tab stop, no ink —
              it exists so the popover has a position on this row. */}
          <SchedulerPopover
            field="deadline_on"
            onChange={(value) => onSchedule(task.id, "deadline_on", value)}
            onOpenChange={setIsDeadlinePickerOpen}
            open={isDeadlinePickerOpen}
            value={task.deadline_on}
          >
            {/* Absolute, so it does not take a slot in the cluster's flex row
                — a zero-width child still consumes the `gap-2`. */}
            <span
              aria-hidden="true"
              className="absolute top-1/2 right-2 size-0"
            />
          </SchedulerPopover>

          <TaskRowActionsMenu
            actions={actions}
            onPickDeadline={openDeadlinePicker}
            task={task}
          >
            <button
              aria-label={`More actions for "${task.title}"`}
              className={cn(
                ACTION_BUTTON_CLASS,
                ALWAYS_ON_TOUCH,
                "order-2 data-[state=open]:bg-[var(--surface-inset)] data-[state=open]:opacity-100",
              )}
              onClick={(event) => event.stopPropagation()}
              type="button"
            >
              <MoreHorizontal aria-hidden="true" className="size-4" />
            </button>
          </TaskRowActionsMenu>
        </div>
      </motion.li>
    </TaskRowContextMenu>
  );
}
