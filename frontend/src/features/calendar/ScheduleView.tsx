// Schedule (plan P6.2): eight weeks from the anchor as a list, only the days
// that have something, each under a sticky date. Tasks are real task rows, so
// every verb the Tasks page has works here too; deadlines are rows that open
// the same card the grid's chips do. This is the screen-reader-friendly view.
import { useRef, type ReactNode } from "react";
import { Building2, CalendarClock, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useCalendarContext } from "@/features/calendar/calendar-context";
import {
  formatDayTitle,
  formatRelativeDay,
  SCHEDULE_DAYS,
} from "@/features/calendar/calendar-grid";
import {
  calendarRoundLabel,
  getItemState,
  pluralSchools,
  schoolFieldLabel,
  type CalendarItem,
} from "@/features/calendar/calendar-items";
import { chipAccessibleName } from "@/features/calendar/calendar-labels";
import { SchoolFavicon } from "@/features/schools/school-cells";
import { deadlineSourceLabel } from "@/features/schools/school-workspace-format";
import { TaskList } from "@/features/tasks/TaskSheet";
import { TaskRow } from "@/features/tasks/TaskRow";
import { addDays, getDateKey } from "@/features/tasks/task-dates";
import { cn } from "@/lib/utils";

const ROW_CLASS = cn(
  "group/row relative flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left outline-none md:h-10 md:min-h-0 md:py-0",
  "transition-[background-color] duration-150 ease-out motion-reduce:transition-none",
  "hover:bg-[var(--canvas-hover)] active:bg-[var(--canvas-active)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-inset",
  "data-[popup-open]:bg-[var(--canvas-hover)]",
);

function StateWord({ item, today }: { item: CalendarItem; today: Date }) {
  const state = getItemState(item, today);
  const relative = formatRelativeDay(item.date, today);
  const word =
    state === "submitted"
      ? "Submitted"
      : state === "passed"
        ? "Passed"
        : state === "overdue"
          ? "Overdue"
          : relative;
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-full text-xs tabular-nums",
        state === "overdue" &&
          "bg-[var(--danger-surface)] px-2 font-medium text-[var(--danger-fg)]",
        state === "due-soon" &&
          "bg-[var(--warning-surface)] px-2 font-medium text-[var(--warning-fg)]",
        state === "submitted" && "text-[var(--success-fg)]",
        (state === "normal" || state === "passed" || state === "done") &&
          "text-[var(--ink-faint)]",
      )}
    >
      {word}
    </span>
  );
}

function DeadlineRow({
  glyph,
  item,
  meta,
  onActivate,
  title,
}: {
  glyph: ReactNode;
  item: CalendarItem;
  meta?: string | null;
  onActivate: (anchor: HTMLElement) => void;
  title: ReactNode;
}) {
  const ctx = useCalendarContext();
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <li className="relative before:pointer-events-none before:absolute before:right-2 before:bottom-0 before:left-[var(--task-row-spine)] before:h-px before:bg-[var(--hairline)] last:before:hidden">
      <button
        aria-label={chipAccessibleName(item, ctx.today)}
        className={ROW_CLASS}
        onClick={() => ref.current && onActivate(ref.current)}
        ref={ref}
        type="button"
      >
        <span className="grid size-4 shrink-0 place-items-center text-[var(--ink-faint)]">
          {glyph}
        </span>
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="min-w-0 truncate text-sm text-[var(--ink)]">
            {title}
          </span>
          {meta ? (
            <span className="hidden truncate text-xs text-[var(--ink-faint)] sm:inline">
              {meta}
            </span>
          ) : null}
        </span>
        <StateWord item={item} today={ctx.today} />
      </button>
    </li>
  );
}

export function ScheduleItem({ item }: { item: CalendarItem }) {
  const ctx = useCalendarContext();

  const task =
    item.kind === "task"
      ? item.task
      : item.kind === "due" && "task" in item.source
        ? item.source.task
        : null;
  if (task) {
    return (
      <TaskRow
        applicationsById={ctx.applicationsById}
        essaysById={ctx.essaysById}
        isSelected={ctx.activeTaskId === task.id}
        persistOnComplete={ctx.showCompleted}
        prefix={
          item.kind === "due" ? (
            <span className="inline-flex shrink-0 items-center gap-1 text-xs text-[var(--ink-secondary)]">
              <CalendarClock aria-hidden="true" className="size-3.5" />
              Due
            </span>
          ) : undefined
        }
        suppress={{ when: item.kind === "task" }}
        task={task}
        {...ctx.actions}
      />
    );
  }

  if (item.kind === "due") {
    const essay = "essay" in item.source ? item.source.essay : null;
    return (
      <DeadlineRow
        glyph={<CalendarClock aria-hidden="true" className="size-3.5" />}
        item={item}
        meta={essay?.school_name}
        onActivate={() => essay && ctx.openEssay(essay.id)}
        title={
          <>
            <span className="text-[var(--ink-secondary)]">Due · </span>
            {essay?.title}
          </>
        }
      />
    );
  }

  if (item.kind === "school") {
    const application = item.application;
    const source =
      item.field === "deadline"
        ? deadlineSourceLabel(
            application.deadline_source,
            application.deadline_checked_at,
          )
        : item.field === "aid_deadline"
          ? deadlineSourceLabel(
              application.aid_deadline_source,
              application.aid_deadline_checked_at,
            )
          : deadlineSourceLabel("student", null);
    return (
      <DeadlineRow
        glyph={<SchoolFavicon size={16} websiteUrl={application.website_url} />}
        item={item}
        meta={source}
        onActivate={(anchor) => ctx.openDeadline(item, anchor)}
        title={
          <>
            {application.school_name}
            <span className="text-[var(--ink-secondary)]">
              {" "}
              · {schoolFieldLabel(application, item.field, "long")}
            </span>
          </>
        }
      />
    );
  }

  if (item.kind !== "aggregate") {
    return null;
  }
  const single = item.schools.length === 1 ? item.schools[0] : null;
  return (
    <DeadlineRow
      glyph={
        single ? (
          <SchoolFavicon size={16} websiteUrl={single.website_url} />
        ) : (
          <Building2 aria-hidden="true" className="size-3.5" />
        )
      }
      item={item}
      onActivate={(anchor) =>
        single
          ? ctx.openDeadline(item, anchor)
          : ctx.openDayPanel({ day: item.date, round: item.round })
      }
      title={
        <>
          {single ? single.school_name : pluralSchools(item.schools.length)}
          <span className="text-[var(--ink-secondary)]">
            {" "}
            · {calendarRoundLabel(item.round, "long")}
          </span>
        </>
      }
    />
  );
}

export function ScheduleView({
  anchor,
  itemsByDay,
  onNextWindow,
}: {
  anchor: Date;
  itemsByDay: ReadonlyMap<string, CalendarItem[]>;
  onNextWindow: () => void;
}) {
  const ctx = useCalendarContext();
  const days = Array.from({ length: SCHEDULE_DAYS }, (_, index) =>
    addDays(anchor, index),
  ).filter((day) => (itemsByDay.get(getDateKey(day)) ?? []).length > 0);

  return (
    <div className="h-full min-h-0 overflow-y-auto px-[var(--task-sheet-inset)] pb-2">
      {days.length === 0 ? (
        <p className="px-3 pt-6 pb-4 text-sm text-[var(--ink-secondary)]">
          Nothing in the next 8 weeks.
        </p>
      ) : (
        days.map((day) => {
          const dayKey = getDateKey(day);
          const relative = formatRelativeDay(dayKey, ctx.today);
          const near = relative === "Today" || relative === "Tomorrow";
          return (
            <section
              aria-labelledby={`schedule-${dayKey}`}
              className="not-first:mt-1 not-first:border-t not-first:border-[var(--hairline)]"
              key={dayKey}
            >
              <h3
                className="sticky top-0 z-[var(--z-floating-panel)] flex items-baseline gap-2 bg-[var(--task-sheet-surface)] px-2 pt-3 pb-1.5 text-sm font-medium text-[var(--ink)]"
                id={`schedule-${dayKey}`}
              >
                {formatDayTitle(day, ctx.today)}
                {near ? (
                  <span
                    className={cn(
                      "text-xs font-normal",
                      relative === "Today"
                        ? "text-[var(--ink)]"
                        : "text-[var(--ink-faint)]",
                    )}
                  >
                    {relative}
                  </span>
                ) : null}
              </h3>
              <TaskList>
                {(itemsByDay.get(dayKey) ?? []).map((item) => (
                  <ScheduleItem item={item} key={item.key} />
                ))}
              </TaskList>
            </section>
          );
        })
      )}
      <div className="flex px-2 pt-3 pb-2">
        <Button onClick={onNextWindow} size="sm" variant="ghost">
          Next 8 weeks
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
