// One action list for a task, rendered two ways.
//
// The UX decision this file encodes: a student should never have to open a
// task to act on it. There are three paths to the same verbs, in increasing
// order of discoverability cost and decreasing order of speed —
//
//   1. the row's hover cluster (TaskRow) — flag and schedule, the two things
//      done dozens of times a day, one click each;
//   2. this menu — everything else, reachable by right-clicking the row or
//      by the `...` button in that same cluster;
//   3. the keymap (useTaskKeymap) — the same verbs on a focused row.
//
// The detail panel keeps only *content* editing (title, notes, links). It is
// not a place you go to perform a verb.
//
// Both surfaces below render from `TaskMenuItems`, so a right-click
// menu and a `...` menu can never drift apart. That is one fact with one
// reason to change, not two lookalike blocks (AGENTS.md: DRY is about
// knowledge, not shape).
import type { ComponentType, ReactElement, ReactNode } from "react";
import {
  CalendarClock,
  CalendarRange,
  Circle,
  CircleCheck,
  Flag,
  Pencil,
  Trash2,
} from "lucide-react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Task } from "@/domain/task";
import { schedulerOptions } from "@/features/tasks/task-config";
import { getNowDate } from "@/lib/time";

/** Every verb a row exposes. The row, the menu and the keymap share it. */
export type TaskRowActions = {
  onOpen: (taskId: string) => void;
  onComplete: (taskId: string, done: boolean) => void;
  onSchedule: (
    taskId: string,
    field: "when_on" | "deadline_on",
    value: string | null,
  ) => void;
  onToggleFlag: (taskId: string) => void;
  onDelete: (taskId: string) => void;
};

/**
 * The Radix menu parts this file needs. ContextMenu and DropdownMenu are the
 * same primitive with two triggers, so the item tree is written once against
 * this shape and handed whichever family is rendering.
 */
type MenuParts = {
  Item: ComponentType<{
    children: ReactNode;
    onSelect?: () => void;
    variant?: "default" | "destructive";
  }>;
  Separator: ComponentType<Record<string, never>>;
  Shortcut: ComponentType<{ children: ReactNode }>;
  Sub: ComponentType<{ children: ReactNode }>;
  SubTrigger: ComponentType<{ children: ReactNode }>;
  SubContent: ComponentType<{ children: ReactNode }>;
};

const CONTEXT_PARTS = {
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
  Shortcut: ContextMenuShortcut,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
} as MenuParts;

const DROPDOWN_PARTS = {
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
  Shortcut: DropdownMenuShortcut,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
} as MenuParts;

/**
 * The date submenus reuse `schedulerOptions` — the same table the popover and
 * the keymap read, so "This weekend" resolves to one date everywhere. Only
 * the presets are offered here; "Pick a date…" stays in the row's own chip,
 * which is a calendar affordance already and is one click away.
 */
const DATE_PRESETS = schedulerOptions.filter((option) => option.resolveDate);

function DateSubmenu({
  field,
  parts,
  taskId,
  onSchedule,
}: {
  field: "when_on" | "deadline_on";
  parts: MenuParts;
  taskId: string;
  onSchedule: TaskRowActions["onSchedule"];
}) {
  const isDeadline = field === "deadline_on";
  const referenceDate = getNowDate();

  return (
    <parts.Sub>
      <parts.SubTrigger>
        {isDeadline ? (
          <CalendarRange aria-hidden="true" />
        ) : (
          <CalendarClock aria-hidden="true" />
        )}
        {isDeadline ? "Deadline" : "When"}
      </parts.SubTrigger>
      <parts.SubContent>
        {DATE_PRESETS.map((option) => (
          <parts.Item
            key={option.id}
            onSelect={() =>
              onSchedule(taskId, field, option.resolveDate!(referenceDate))
            }
          >
            {isDeadline && option.deadlineLabel
              ? option.deadlineLabel
              : option.label}
            <parts.Shortcut>{option.shortcutKey.toUpperCase()}</parts.Shortcut>
          </parts.Item>
        ))}
      </parts.SubContent>
    </parts.Sub>
  );
}

function TaskMenuItems({
  actions,
  parts,
  task,
}: {
  actions: TaskRowActions;
  parts: MenuParts;
  task: Task;
}) {
  const isDone = Boolean(task.done_at);

  return (
    <>
      <parts.Item onSelect={() => actions.onOpen(task.id)}>
        <Pencil aria-hidden="true" />
        Open
        <parts.Shortcut>E</parts.Shortcut>
      </parts.Item>
      <parts.Item onSelect={() => actions.onComplete(task.id, !isDone)}>
        {isDone ? (
          <Circle aria-hidden="true" />
        ) : (
          <CircleCheck aria-hidden="true" />
        )}
        {isDone ? "Mark as not done" : "Mark as done"}
        <parts.Shortcut>Space</parts.Shortcut>
      </parts.Item>
      <parts.Item onSelect={() => actions.onToggleFlag(task.id)}>
        <Flag
          aria-hidden="true"
          fill={task.flagged ? "currentColor" : "none"}
        />
        {task.flagged ? "Remove flag" : "Flag"}
        <parts.Shortcut>F</parts.Shortcut>
      </parts.Item>

      <parts.Separator />

      <DateSubmenu
        field="when_on"
        onSchedule={actions.onSchedule}
        parts={parts}
        taskId={task.id}
      />
      <DateSubmenu
        field="deadline_on"
        onSchedule={actions.onSchedule}
        parts={parts}
        taskId={task.id}
      />

      <parts.Separator />

      <parts.Item
        onSelect={() => actions.onDelete(task.id)}
        variant="destructive"
      >
        <Trash2 aria-hidden="true" />
        Delete
        <parts.Shortcut>⌫</parts.Shortcut>
      </parts.Item>
    </>
  );
}

/** Right-click anywhere on `children` (the row). */
export function TaskRowContextMenu({
  actions,
  children,
  task,
}: {
  actions: TaskRowActions;
  children: ReactElement;
  task: Task;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <TaskMenuItems actions={actions} parts={CONTEXT_PARTS} task={task} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** The same list, from the row's `...` button — for anyone who never
 * right-clicks, and for touch, where there is no right-click at all. */
export function TaskRowActionsMenu({
  actions,
  children,
  task,
}: {
  actions: TaskRowActions;
  children: ReactElement;
  task: Task;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <TaskMenuItems actions={actions} parts={DROPDOWN_PARTS} task={task} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
