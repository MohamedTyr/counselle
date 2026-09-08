// One action list for a task, rendered two ways.
//
// The rule this file encodes: **if the row can do it, the menu does not offer
// it.** One verb, one place. The row already carries, permanently, every verb
// a student reaches for dozens of times a day — the checkbox completes, the
// flag button flags, the When chip (or `Plan it`, or the calendar glyph)
// schedules, and clicking the title opens the detail panel. Re-listing those
// here made a six-item menu out of two items of real content and made the row
// feel heavier than it is.
//
// So the menu holds exactly what the row cannot do:
//   - **Set deadline…** — the row's deadline chip is read-only display text,
//     and a task with no deadline has no chip at all, so this is the only
//     pointer path to the field. (`When`, by contrast, always has a row
//     affordance, which is why it is not here.) It opens the row's
//     SchedulerPopover rather than duplicating its presets in a submenu.
//   - **Delete** — deliberately kept one level down.
//
// The keymap (useTaskKeymap) still carries the full set on a focused row —
// it is invisible, so it costs no clutter.
//
// Both surfaces below render from `TaskMenuItems`, so a right-click
// menu and a `...` menu can never drift apart. That is one fact with one
// reason to change, not two lookalike blocks (AGENTS.md: DRY is about
// knowledge, not shape).
import type { ComponentType, ReactElement, ReactNode } from "react";
import { CalendarRange, Trash2 } from "lucide-react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Task } from "@/domain/task";

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
};

const CONTEXT_PARTS = {
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
  Shortcut: ContextMenuShortcut,
} as MenuParts;

const DROPDOWN_PARTS = {
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
  Shortcut: DropdownMenuShortcut,
} as MenuParts;

function TaskMenuItems({
  actions,
  onPickDeadline,
  parts,
  task,
}: {
  actions: TaskRowActions;
  onPickDeadline: () => void;
  parts: MenuParts;
  task: Task;
}) {
  return (
    <>
      {/*
        Not a submenu of presets. It hands off to the SchedulerPopover the row
        chip and the detail panel already use, which carries the same presets
        *plus* a calendar and `Anytime` — so a deadline is picked from one
        surface everywhere, and an arbitrary date is two clicks rather than
        impossible.
      */}
      <parts.Item onSelect={onPickDeadline}>
        <CalendarRange aria-hidden="true" />
        {task.deadline_on ? "Change deadline…" : "Set deadline…"}
      </parts.Item>

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
  onPickDeadline,
  task,
}: {
  actions: TaskRowActions;
  children: ReactElement;
  onPickDeadline: () => void;
  task: Task;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <TaskMenuItems
          actions={actions}
          onPickDeadline={onPickDeadline}
          parts={CONTEXT_PARTS}
          task={task}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** The same list, from the row's `...` button — for anyone who never
 * right-clicks, and for touch, where there is no right-click at all. */
export function TaskRowActionsMenu({
  actions,
  children,
  onPickDeadline,
  task,
}: {
  actions: TaskRowActions;
  children: ReactElement;
  onPickDeadline: () => void;
  task: Task;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <TaskMenuItems
          actions={actions}
          onPickDeadline={onPickDeadline}
          parts={DROPDOWN_PARTS}
          task={task}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
