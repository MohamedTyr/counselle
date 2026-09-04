import { addDays, getDateKey } from "@/features/tasks/task-dates";
import type { ApplicationView, EssaySummary } from "@/api/workspace/types";
import type { Task, TaskCategory } from "@/domain/task";

/*
 * Two declared divergences from DESIGN.md §14.2 (plans/tasks-redesign-plan.md
 * §1, argued in plans/tasks-redesign-design.md §3.8 and §3.9). Both are
 * accepted. Do not "fix" them back to DESIGN.md's generic mapping.
 *
 * 1. THE FLAG IS `--brand` (WINE), NOT `--danger-fg` (RED). DESIGN.md §14.2
 *    maps `priority: high → error`. Here `flagged` is not a state of the
 *    task — it is the student's own mark on it, which is the same claim
 *    `--brand` already makes for "the current selection," and keeping it out
 *    of red is what lets red mean exactly one thing on this page: a date the
 *    world has already passed. See TaskRow's flag glyph (design doc §3.9).
 *
 * 2. DEADLINE URGENCY IS AMBER AT ≤2 DAYS AND RED WHEN OVERDUE, NOT RED AT
 *    ≤14 DAYS. Fourteen days of red in a forty-row list is why the current
 *    board reads as an alarm. See `getDeadlineState` in task-dates.ts and
 *    TaskRow's deadline chip (design doc §3.8).
 *
 * Neither divergence is represented as a colour value in this file — colours
 * live in CSS (task.css / theme.css). These are the mapping decisions only.
 */

/*
 * Derived label (spec §2.3). Exactly one label per row, computed at render
 * time — never stored, never picked from a category enum in the UI.
 *
 * The `category` column stays in the schema for agent use only (P1.2), so a
 * task the student created still has a category value (defaulted to
 * "other"). "other" is the UI's "no category was meaningfully set" state, so
 * it is treated as absent rather than shown as a label.
 */
export const categoryLabel: Record<TaskCategory, string> = {
  essay: "Essay",
  lor: "LOR",
  aid: "Aid",
  research: "Research",
  other: "Other",
  form: "Form",
  interview: "Interview",
};

export function getDerivedLabel(
  task: Task,
  applicationsById: ReadonlyMap<string, ApplicationView>,
  essaysById: ReadonlyMap<string, EssaySummary>,
): string | undefined {
  if (task.essay_id) {
    const essay = essaysById.get(task.essay_id);
    return essay?.school_name ? `Essay · ${essay.school_name}` : "Essay";
  }

  if (task.application_id) {
    const application = applicationsById.get(task.application_id);
    if (application) {
      return application.school_name;
    }
  }

  if (task.category !== "other") {
    return categoryLabel[task.category];
  }

  return undefined;
}

/*
 * Scheduler popover rows (design doc §6.2, spec §5). Single column, six
 * rows, in this exact order. `resolveDate` is undefined for "Pick a date…"
 * because it opens the calendar rather than resolving a value directly;
 * "Anytime" resolves to `null`, the scheduler's clear sentinel.
 */
export type SchedulerOptionId =
  | "today"
  | "tomorrow"
  | "weekend"
  | "nextWeek"
  | "pickDate"
  | "anytime";

export type SchedulerOption = {
  id: SchedulerOptionId;
  label: string;
  /** "No deadline" when the popover is editing `deadline_on` (spec §5). */
  deadlineLabel?: string;
  shortcutKey: string;
  resolveDate?: (referenceDate: Date) => string | null;
};

function daysUntilWeekday(referenceDate: Date, targetWeekday: number): number {
  const day = referenceDate.getDay();
  return (targetWeekday - day + 7) % 7;
}

export const schedulerOptions: SchedulerOption[] = [
  {
    id: "today",
    label: "Today",
    shortcutKey: "t",
    resolveDate: (referenceDate) => getDateKey(referenceDate),
  },
  {
    id: "tomorrow",
    label: "Tomorrow",
    shortcutKey: "m",
    resolveDate: (referenceDate) => getDateKey(addDays(referenceDate, 1)),
  },
  {
    id: "weekend",
    label: "This weekend",
    shortcutKey: "w",
    // The upcoming Saturday (0 days out if today already is one). Sunday is
    // still technically "the weekend," but spec §5 doesn't define that edge
    // case, so this rolls a Sunday forward to next Saturday rather than back.
    resolveDate: (referenceDate) =>
      getDateKey(addDays(referenceDate, daysUntilWeekday(referenceDate, 6))),
  },
  {
    id: "nextWeek",
    label: "Next week",
    shortcutKey: "k",
    // The Monday that starts next week, never this week's (today's Monday
    // resolves 7 days out, not 0).
    resolveDate: (referenceDate) =>
      getDateKey(
        addDays(referenceDate, daysUntilWeekday(referenceDate, 1) || 7),
      ),
  },
  {
    id: "pickDate",
    label: "Pick a date…",
    shortcutKey: "p",
  },
  {
    id: "anytime",
    label: "Anytime",
    deadlineLabel: "No deadline",
    shortcutKey: "a",
    resolveDate: () => null,
  },
];
