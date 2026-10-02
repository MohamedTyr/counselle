// Every anchored surface the calendar opens, in one place: the `N more` day
// popover, the deadline card, quick-add and a task's deadline picker. The page
// holds at most one of them open at a time, pinned to whatever opened it, so
// hundreds of chips never each carry a popover root of their own.
import { CalendarClock, Circle } from "lucide-react";

import type { SchoolDeadlineItem } from "@/api/calendar/types";
import type { ApplicationView, EssaySummary } from "@/api/workspace/types";
import type { Task } from "@/domain/task";
import { AnchoredPopover } from "@/features/calendar/AnchoredPopover";
import { CalendarChip } from "@/features/calendar/CalendarChip";
import { useCalendarContext } from "@/features/calendar/calendar-context";
import { formatDayTitle } from "@/features/calendar/calendar-grid";
import type { CalendarItem } from "@/features/calendar/calendar-items";
import {
  DeadlineCard,
  type DeadlineCardItem,
} from "@/features/calendar/DeadlineCard";
import {
  QuickAddBar,
  type QuickAddDefaults,
} from "@/features/tasks/QuickAddBar";
import { SchedulerPopover } from "@/features/tasks/SchedulerPopover";
import { parseDateOnly } from "@/features/tasks/task-dates";

export type CalendarOverlay =
  | { kind: "day"; dayKey: string; anchor: HTMLElement }
  | { kind: "deadline"; item: DeadlineCardItem; anchor: HTMLElement }
  | { kind: "quickAdd"; anchor: HTMLElement; defaults: QuickAddDefaults }
  | { kind: "deadlinePicker"; taskId: string; anchor: HTMLElement }
  | null;

function DayPopoverBody({
  dayKey,
  items,
}: {
  dayKey: string;
  items: CalendarItem[];
}) {
  const ctx = useCalendarContext();
  return (
    <div className="flex w-64 flex-col gap-2">
      <p className="px-0.5 text-sm font-medium text-[var(--ink)]">
        {formatDayTitle(parseDateOnly(dayKey), ctx.today)}
      </p>
      <div className="-mx-1 flex flex-col gap-[var(--calendar-chip-gap)]">
        {items.map((item) => (
          <CalendarChip item={item} key={item.key} tabbable />
        ))}
      </div>
    </div>
  );
}

/** Which day the new task lands on — the bar itself shows only what is typed.
 * A typed date still wins over it. */
function QuickAddDayLine({ defaults }: { defaults: QuickAddDefaults }) {
  const ctx = useCalendarContext();
  const dayKey = defaults.when_on ?? defaults.deadline_on;
  if (!dayKey) {
    return null;
  }
  return (
    <p className="flex items-center gap-1.5 px-2 pt-1 text-xs text-[var(--ink-secondary)]">
      {defaults.when_on ? (
        <Circle aria-hidden="true" className="size-3" strokeWidth={2.25} />
      ) : (
        <CalendarClock aria-hidden="true" className="size-3" />
      )}
      {defaults.when_on ? "" : "Due "}
      {formatDayTitle(parseDateOnly(dayKey), ctx.today)}
    </p>
  );
}

export function CalendarOverlays({
  applications,
  essays,
  itemsByDay,
  onAddTaskFromDeadline,
  onAddToList,
  onClose,
  overlay,
  reportedPeriod,
  tasks,
}: {
  applications: ApplicationView[];
  essays: EssaySummary[];
  itemsByDay: ReadonlyMap<string, CalendarItem[]>;
  onAddTaskFromDeadline: (application: ApplicationView, date: string) => void;
  onAddToList: (school: SchoolDeadlineItem) => void;
  onClose: () => void;
  overlay: CalendarOverlay;
  reportedPeriod: string | undefined;
  tasks: Task[];
}) {
  const ctx = useCalendarContext();
  const onOpenChange = (open: boolean) => {
    if (!open) {
      onClose();
    }
  };

  if (overlay?.kind === "deadlinePicker") {
    const task = tasks.find((item) => item.id === overlay.taskId);
    return (
      <SchedulerPopover
        anchor={overlay.anchor}
        field="deadline_on"
        onChange={(value) =>
          ctx.actions.onSchedule(overlay.taskId, "deadline_on", value)
        }
        onOpenChange={onOpenChange}
        open={Boolean(task)}
        value={task?.deadline_on}
      />
    );
  }

  const dayItems =
    overlay?.kind === "day" ? (itemsByDay.get(overlay.dayKey) ?? []) : [];

  return (
    <AnchoredPopover
      anchor={overlay?.anchor ?? null}
      className={
        overlay?.kind === "quickAdd"
          ? "w-[26rem] max-w-[calc(100vw-2rem)]"
          : undefined
      }
      label={
        overlay?.kind === "quickAdd"
          ? "New task"
          : overlay?.kind === "deadline"
            ? "Deadline"
            : overlay?.kind === "day"
              ? formatDayTitle(parseDateOnly(overlay.dayKey), ctx.today)
              : "Calendar"
      }
      onOpenChange={onOpenChange}
      open={overlay !== null && (overlay.kind !== "day" || dayItems.length > 0)}
    >
      {overlay?.kind === "day" ? (
        <DayPopoverBody dayKey={overlay.dayKey} items={dayItems} />
      ) : overlay?.kind === "deadline" ? (
        <DeadlineCard
          item={overlay.item}
          onAddTask={onAddTaskFromDeadline}
          onAddToList={(school) => {
            // The card is anchored to the chip that adding removes, so it
            // closes first.
            onClose();
            onAddToList(school);
          }}
          onClose={onClose}
          reportedPeriod={reportedPeriod}
        />
      ) : overlay?.kind === "quickAdd" ? (
        // Mounted only while open: the bar binds a global `n`, which on this
        // page means "next".
        <div className="-m-2 flex flex-col gap-1.5">
          <QuickAddDayLine defaults={overlay.defaults} />
          <QuickAddBar
            applications={applications}
            autoFocus
            defaults={overlay.defaults}
            essays={essays}
            onSubmitted={onClose}
          />
        </div>
      ) : null}
    </AnchoredPopover>
  );
}
