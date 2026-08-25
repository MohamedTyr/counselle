import type { BadgeProps } from "@/components/ui/badge";
import type {
  TaskAssignee,
  TaskCategory,
  TaskPriority,
  TaskStatus,
} from "@/domain/task";
import type { AllTaskColumn, TodayColumn } from "@/features/tasks/task-types";

export const selectionDragThreshold = 5;
export const emptyTaskIdSet: ReadonlySet<string> = new Set();

export const todayColumns: TodayColumn[] = [
  {
    id: "todo",
    title: "Later Today",
    description: "Queued for today, not active yet.",
  },
  {
    id: "doing",
    title: "Doing Now",
    description: "Keep this lane to one or two tasks.",
  },
  {
    id: "waiting",
    title: "Waiting",
    description: "Paused on a person, portal, or answer.",
  },
  {
    id: "done",
    title: "Done",
    description: "Completed today. Keep the receipt visible.",
  },
];

export const categoryLabel: Record<TaskCategory, string> = {
  essay: "Essay",
  lor: "LOR",
  aid: "Aid",
  research: "Research",
  other: "Other",
  form: "Form",
  interview: "Interview",
};

export const priorityLabel: Record<TaskPriority, string> = {
  low: "Low",
  med: "Med",
  high: "High",
};

export const prioritySortRank: Record<TaskPriority, number> = {
  high: 0,
  med: 1,
  low: 2,
};

export const statusLabel: Record<TaskStatus, string> = {
  todo: "Todo",
  doing: "Doing Now",
  waiting: "Waiting",
  done: "Done",
};

export const assigneeLabel: Record<TaskAssignee, string> = {
  student: "Student",
  counselle: "Counselle",
};

export const statusOptions = [
  { label: statusLabel.todo, value: "todo" },
  { label: statusLabel.doing, value: "doing" },
  { label: statusLabel.waiting, value: "waiting" },
  { label: statusLabel.done, value: "done" },
] as const;

export const categoryOptions = [
  { label: categoryLabel.essay, value: "essay" },
  { label: categoryLabel.lor, value: "lor" },
  { label: categoryLabel.aid, value: "aid" },
  { label: categoryLabel.research, value: "research" },
  { label: categoryLabel.form, value: "form" },
  { label: categoryLabel.interview, value: "interview" },
  { label: categoryLabel.other, value: "other" },
] as const;

export const priorityOptions = [
  { label: priorityLabel.low, value: "low" },
  { label: priorityLabel.med, value: "med" },
  { label: priorityLabel.high, value: "high" },
] as const;

export const assigneeOptions = [
  { label: assigneeLabel.student, value: "student" },
  { label: assigneeLabel.counselle, value: "counselle" },
] as const;

export const allTaskColumns: AllTaskColumn[] = [
  { id: "task", label: "Task", width: 310 },
  { id: "status", label: "Status", width: 118 },
  { id: "category", label: "Type", width: 104 },
  { id: "priority", label: "Priority", width: 94 },
  { id: "workDate", label: "Work date", width: 108 },
  { id: "dueDate", label: "Due date", width: 104 },
  { id: "reminder", label: "Reminder", width: 106 },
];
export const allTasksTableWidth = allTaskColumns.reduce(
  (totalWidth, column) => totalWidth + column.width,
  0,
);

export const booleanOptions = [
  { label: "No", value: "false" },
  { label: "Yes", value: "true" },
] as const;

export const laneThemeClass: Record<TaskStatus, string> = {
  todo: "[--lane-surface:var(--task-todo-surface)] [--lane-header:var(--task-todo-header)] [--lane-card:var(--task-todo-card)] [--lane-card-hover:var(--task-todo-card-hover)] [--lane-border:var(--task-todo-border)] [--lane-card-border:var(--task-todo-card-border)] [--lane-muted:var(--task-todo-muted)] [--lane-pill-bg:var(--task-todo-pill-bg)] [--lane-pill-fg:var(--task-todo-pill-fg)] [--lane-dot:var(--task-todo-dot)] [--lane-drop-surface:var(--task-todo-drop-surface)] [--lane-drop-border:var(--task-todo-drop-border)]",
  doing:
    "[--lane-surface:var(--task-doing-surface)] [--lane-header:var(--task-doing-header)] [--lane-card:var(--task-doing-card)] [--lane-card-hover:var(--task-doing-card-hover)] [--lane-border:var(--task-doing-border)] [--lane-card-border:var(--task-doing-card-border)] [--lane-muted:var(--task-doing-muted)] [--lane-pill-bg:var(--task-doing-pill-bg)] [--lane-pill-fg:var(--task-doing-pill-fg)] [--lane-dot:var(--task-doing-dot)] [--lane-drop-surface:var(--task-doing-drop-surface)] [--lane-drop-border:var(--task-doing-drop-border)]",
  waiting:
    "[--lane-surface:var(--task-waiting-surface)] [--lane-header:var(--task-waiting-header)] [--lane-card:var(--task-waiting-card)] [--lane-card-hover:var(--task-waiting-card-hover)] [--lane-border:var(--task-waiting-border)] [--lane-card-border:var(--task-waiting-card-border)] [--lane-muted:var(--task-waiting-muted)] [--lane-pill-bg:var(--task-waiting-pill-bg)] [--lane-pill-fg:var(--task-waiting-pill-fg)] [--lane-dot:var(--task-waiting-dot)] [--lane-drop-surface:var(--task-waiting-drop-surface)] [--lane-drop-border:var(--task-waiting-drop-border)]",
  done: "[--lane-surface:var(--task-done-surface)] [--lane-header:var(--task-done-header)] [--lane-card:var(--task-done-card)] [--lane-card-hover:var(--task-done-card-hover)] [--lane-border:var(--task-done-border)] [--lane-card-border:var(--task-done-card-border)] [--lane-muted:var(--task-done-muted)] [--lane-pill-bg:var(--task-done-pill-bg)] [--lane-pill-fg:var(--task-done-pill-fg)] [--lane-dot:var(--task-done-dot)] [--lane-drop-surface:var(--task-done-drop-surface)] [--lane-drop-border:var(--task-done-drop-border)]",
};

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

/*
 * Priority is an ORDERED scale, so only its alarm end earns a hue. It used
 * to be error / warning / success, which put `low` in the same green as
 * `done` — a low-priority task reading as a finished one — and put `med` in
 * the same amber as `waiting`, one column away in the same table row. High
 * is the only priority that changes what you do next; the other two are the
 * neutral label chip and are told apart by their word.
 */
export const priorityBadgeVariant: Record<TaskPriority, BadgeVariant> = {
  high: "error",
  low: "secondary",
  med: "secondary",
};

/*
 * Two of four statuses are tinted, and that is the point: Waiting is amber
 * because something is blocked on a person, Done is leaf because that is the
 * moment worth marking. Todo and Doing are the ordinary states of a task.
 * `doing` was blue before the palette pass — see the --info note in
 * primitives.css for why the ordinary state stopped getting a colour.
 */
export const statusBadgeVariant: Record<TaskStatus, BadgeVariant> = {
  doing: "secondary",
  done: "success",
  todo: "secondary",
  waiting: "warning",
};

/*
 * One chip, seven categories. These were seven hue-coded triads (plum,
 * mauve, amber, teal, slate, blue, grey) until the palette pass; four of
 * those hues existed in the whole design system for these chips alone. A
 * category is a label, not a state — every one of them now draws --label-*
 * through its own task.css token. The per-category keys stay so a future
 * category is still a one-line addition here.
 */
const CATEGORY_CHIP =
  "border-[color:var(--label-border)] bg-[color:var(--label-surface)] text-[color:var(--label-ink)]";

export const categoryChipClass: Record<TaskCategory, string> = {
  aid: CATEGORY_CHIP,
  essay: CATEGORY_CHIP,
  form: CATEGORY_CHIP,
  interview: CATEGORY_CHIP,
  lor: CATEGORY_CHIP,
  other: CATEGORY_CHIP,
  research: CATEGORY_CHIP,
};

/* "Assigned to Counselle" is not a completed task. It was drawing the done
 * green, which is the one colour in this system that should mean finished. */
export const assigneeBadgeVariant: Record<TaskAssignee, BadgeVariant> = {
  counselle: "secondary",
  student: "secondary",
};
