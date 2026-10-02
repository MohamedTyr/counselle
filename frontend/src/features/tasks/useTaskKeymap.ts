// The tasks feature's keyboard map (plans/tasks-redesign-plan.md P7.4, spec
// §9). One feature's keymap, not a general-purpose registry (YAGNI) — the
// reference implementation for the single-letter-shortcuts-must-not-fire-
// while-editing problem is `features/cds-admin/review/use-review-
// controller.ts`. `n` (focus quick-add) is already bound inside
// `QuickAddBar.tsx` and is deliberately not re-bound here.
import { useEffect } from "react";

import { schedulerOptions } from "@/features/tasks/task-config";

export type TaskKeymapView = "today" | "upcoming" | "anytime";

export type TaskKeymapHandlers = {
  onComplete: (taskId: string, done: boolean) => void;
  /** `⌫`/`Delete` on a focused row. Undoable, so there is no confirm step —
   * the toast is the confirmation (spec §9's `⌘Z` is already wired). */
  onDelete: (taskId: string) => void;
  onNavigateView: (view: TaskKeymapView) => void;
  onOpenSearch: () => void;
  onOpenTask: (taskId: string) => void;
  /** `⌥↑`/`⌥↓` — Today's manual reorder (plan P9, spec §9). Only fires when
   * the focused row is actually reorderable (TasksLayout's handler is a
   * no-op off Today, since `todayGroups.main` won't contain the id). */
  onReorder: (taskId: string, direction: -1 | 1) => void;
  onSchedule: (
    taskId: string,
    field: "when_on" | "deadline_on",
    value: string | null,
  ) => void;
  onToggleFlag: (taskId: string) => void;
  onUndo: () => void;
  /** Whether a task's completed state, keyed by id — `space`/`e` toggle it. */
  isTaskDone: (taskId: string) => boolean;
};

const VIEW_KEYS: Record<string, TaskKeymapView> = {
  "1": "today",
  "2": "upcoming",
  "3": "anytime",
};

/** Moved verbatim from the pre-redesign `TasksRoute.tsx:75-85` (`git show
 * HEAD~2:…`) — guards every single-letter binding below. */
export function isEditingSurface(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        "input,textarea,select,[contenteditable=true],[data-task-editing-field]," +
          "[data-slot^='select'],[data-slot^='dropdown-menu'],[role='menuitem'],[role='option'],[role='listbox']",
      ),
    )
  );
}

/** The task row whose title button currently has DOM focus, if any — rows
 * carry `data-task-id` (TaskRow.tsx) for exactly this lookup. No separate
 * "focused row" state is kept; the DOM's own focus is the source of truth. */
function focusedTaskId(): string | null {
  const active = document.activeElement;
  if (!(active instanceof Element)) {
    return null;
  }
  return active.closest("[data-task-id]")?.getAttribute("data-task-id") ?? null;
}

/** True while a `SchedulerPopover` (or any Base UI popover) is open and the
 * event originated inside it — its own `handleListKeyDown` already owns
 * `t m w k a p` there (spec §5), so this hook defers entirely rather than
 * double-dispatching a reschedule. */
export function isInsidePopover(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest('[data-slot="popover-popup"]'))
  );
}

function focusableRows(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-slot="task-row"] [role="button"]',
    ),
  );
}

function moveRowFocus(direction: 1 | -1) {
  const rows = focusableRows();
  if (rows.length === 0) {
    return;
  }
  const currentIndex = rows.findIndex((row) => row === document.activeElement);
  const nextIndex =
    currentIndex === -1
      ? 0
      : Math.min(Math.max(currentIndex + direction, 0), rows.length - 1);
  rows[nextIndex]?.focus();
}

/**
 * Reschedules the focused row's `when` via the exact same `schedulerOptions`
 * table `SchedulerPopover` uses — spec §5: "these also work with a row
 * focused and no popover open." When a popover *is* open, its own
 * `handleListKeyDown` already owns these keys; this hook only reacts when
 * nothing has swallowed the event (i.e. no popover intercepted it first).
 */
function resolveSchedulerShortcut(key: string): string | null | undefined {
  const option = schedulerOptions.find((item) => item.shortcutKey === key);
  if (!option?.resolveDate) {
    return undefined;
  }
  return option.resolveDate(new Date());
}

export function useTaskKeymap(handlers: TaskKeymapHandlers) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey) {
        if ((event.key === "k" || event.key === "K") && event.metaKey) {
          event.preventDefault();
          handlers.onOpenSearch();
          return;
        }
        if ((event.key === "z" || event.key === "Z") && event.metaKey) {
          event.preventDefault();
          handlers.onUndo();
        }
        return;
      }

      if (isInsidePopover(event.target)) {
        return;
      }

      if (event.key === "/" && !isEditingSurface(event.target)) {
        event.preventDefault();
        handlers.onOpenSearch();
        return;
      }

      if (isEditingSurface(event.target)) {
        return;
      }

      // `⌥↑`/`⌥↓` — spec §9's Today reorder, checked ahead of the plain
      // arrow-key row-focus movement below since it's the same two keys
      // with a modifier.
      if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        const taskId = focusedTaskId();
        if (taskId) {
          event.preventDefault();
          handlers.onReorder(taskId, event.key === "ArrowUp" ? -1 : 1);
        }
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveRowFocus(-1);
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveRowFocus(1);
        return;
      }

      const view = VIEW_KEYS[event.key];
      if (view) {
        handlers.onNavigateView(view);
        return;
      }

      const taskId = focusedTaskId();
      if (!taskId) {
        return;
      }

      if (event.key === " ") {
        event.preventDefault();
        handlers.onComplete(taskId, !handlers.isTaskDone(taskId));
        return;
      }
      if (event.key === "e") {
        event.preventDefault();
        handlers.onOpenTask(taskId);
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        handlers.onDelete(taskId);
        return;
      }

      if (event.key === "f") {
        handlers.onToggleFlag(taskId);
        return;
      }

      const resolvedDate = resolveSchedulerShortcut(event.key);
      if (resolvedDate !== undefined) {
        handlers.onSchedule(taskId, "when_on", resolvedDate);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
    // No dependency array: `handlers` is a plain object literal the caller
    // passes fresh every render, so listing it would re-subscribe on every
    // render anyway — re-subscribing directly keeps the closures fresh.
  });
}
