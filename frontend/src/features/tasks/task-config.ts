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
  todo: "[--lane-surface:var(--task-todo-surface)] [--lane-header:var(--task-todo-header)] [--lane-card:var(--task-todo-card)] [--lane-card-hover:var(--task-todo-card-hover)] [--lane-border:var(--task-todo-border)] [--lane-card-border:var(--task-todo-card-border)] [--lane-muted:var(--task-todo-muted)] [--lane-pill-bg:var(--task-todo-pill-bg)] [--lane-pill-fg:var(--task-todo-pill-fg)] [--lane-dot:var(--task-todo-dot)]",
  doing:
    "[--lane-surface:var(--task-doing-surface)] [--lane-header:var(--task-doing-header)] [--lane-card:var(--task-doing-card)] [--lane-card-hover:var(--task-doing-card-hover)] [--lane-border:var(--task-doing-border)] [--lane-card-border:var(--task-doing-card-border)] [--lane-muted:var(--task-doing-muted)] [--lane-pill-bg:var(--task-doing-pill-bg)] [--lane-pill-fg:var(--task-doing-pill-fg)] [--lane-dot:var(--task-doing-dot)]",
  waiting:
    "[--lane-surface:var(--task-waiting-surface)] [--lane-header:var(--task-waiting-header)] [--lane-card:var(--task-waiting-card)] [--lane-card-hover:var(--task-waiting-card-hover)] [--lane-border:var(--task-waiting-border)] [--lane-card-border:var(--task-waiting-card-border)] [--lane-muted:var(--task-waiting-muted)] [--lane-pill-bg:var(--task-waiting-pill-bg)] [--lane-pill-fg:var(--task-waiting-pill-fg)] [--lane-dot:var(--task-waiting-dot)]",
  done: "[--lane-surface:var(--task-done-surface)] [--lane-header:var(--task-done-header)] [--lane-card:var(--task-done-card)] [--lane-card-hover:var(--task-done-card-hover)] [--lane-border:var(--task-done-border)] [--lane-card-border:var(--task-done-card-border)] [--lane-muted:var(--task-done-muted)] [--lane-pill-bg:var(--task-done-pill-bg)] [--lane-pill-fg:var(--task-done-pill-fg)] [--lane-dot:var(--task-done-dot)]",
};

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

export const priorityBadgeVariant: Record<TaskPriority, BadgeVariant> = {
  high: "error",
  med: "warning",
  low: "success",
};

export const statusBadgeVariant: Record<TaskStatus, BadgeVariant> = {
  todo: "secondary",
  doing: "info",
  waiting: "warning",
  done: "success",
};

export const categoryChipClass: Record<TaskCategory, string> = {
  essay:
    "border-[color:var(--task-category-essay-border)] bg-[color:var(--task-category-essay-bg)] text-[color:var(--task-category-essay-fg)]",
  lor: "border-[color:var(--task-category-lor-border)] bg-[color:var(--task-category-lor-bg)] text-[color:var(--task-category-lor-fg)]",
  aid: "border-[color:var(--task-category-aid-border)] bg-[color:var(--task-category-aid-bg)] text-[color:var(--task-category-aid-fg)]",
  research:
    "border-[color:var(--task-category-research-border)] bg-[color:var(--task-category-research-bg)] text-[color:var(--task-category-research-fg)]",
  form: "border-[color:var(--task-category-form-border)] bg-[color:var(--task-category-form-bg)] text-[color:var(--task-category-form-fg)]",
  interview:
    "border-[color:var(--task-category-interview-border)] bg-[color:var(--task-category-interview-bg)] text-[color:var(--task-category-interview-fg)]",
  other:
    "border-[color:var(--task-category-other-border)] bg-[color:var(--task-category-other-bg)] text-[color:var(--task-category-other-fg)]",
};

export const assigneeBadgeVariant: Record<TaskAssignee, BadgeVariant> = {
  student: "secondary",
  counselle: "success",
};
