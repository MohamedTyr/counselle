// The phone month (plan §2.7): a grid of date numbers too narrow for chips, so
// each day carries one dot when it has anything, plus a second, red one when
// something that day is overdue. Tapping a day lists it underneath in the
// Schedule's row form.
import { useRef } from "react";

import { DateMark } from "@/features/calendar/CalendarDayCell";
import { useCalendarContext } from "@/features/calendar/calendar-context";
import {
  formatDayLabel,
  formatDayTitle,
  formatRelativeDay,
  isSameMonth,
  monthMatrix,
  rovingDayKey,
} from "@/features/calendar/calendar-grid";
import { handleGridKeyDown } from "@/features/calendar/calendar-grid-keys";
import {
  getItemState,
  type CalendarItem,
} from "@/features/calendar/calendar-items";
import { WeekdayHeader } from "@/features/calendar/MonthView";
import { ScheduleItem } from "@/features/calendar/ScheduleView";
import { TaskList } from "@/features/tasks/TaskSheet";
import { getDateKey, parseDateOnly } from "@/features/tasks/task-dates";
import { cn } from "@/lib/utils";

const EMPTY: CalendarItem[] = [];

function dayLabel(
  day: Date,
  items: CalendarItem[],
  isToday: boolean,
  today: Date,
) {
  const overdue = items.filter(
    (item) => getItemState(item, today) === "overdue",
  ).length;
  const parts = [formatDayLabel(day)];
  if (isToday) {
    parts.push("today");
  }
  parts.push(items.length === 1 ? "1 item" : `${items.length} items`);
  if (overdue > 0) {
    parts.push(`${overdue} overdue`);
  }
  return parts.join(", ");
}

export function CompactMonthView({
  anchor,
  itemsByDay,
  labelledBy,
  onKeyboardMove,
  onSelectDay,
}: {
  anchor: Date;
  itemsByDay: ReadonlyMap<string, CalendarItem[]>;
  labelledBy: string;
  onKeyboardMove: (day: Date) => void;
  onSelectDay: (day: Date) => void;
}) {
  const ctx = useCalendarContext();
  const gridRef = useRef<HTMLDivElement>(null);
  const weeks = monthMatrix(anchor);
  const anchorKey = rovingDayKey(weeks.flat(), ctx.selectedKey, anchor);
  const selectedItems = itemsByDay.get(anchorKey) ?? EMPTY;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        aria-labelledby={labelledBy}
        className="grid grid-cols-7 px-1 pb-1"
        onKeyDown={(event) => handleGridKeyDown(event, onKeyboardMove)}
        ref={gridRef}
        role="grid"
      >
        <WeekdayHeader days={weeks[0]} />
        {weeks.map((week) => (
          <div className="contents" key={getDateKey(week[0])} role="row">
            {week.map((day) => {
              const dayKey = getDateKey(day);
              const items = itemsByDay.get(dayKey) ?? EMPTY;
              const isToday = dayKey === ctx.todayKey;
              const isSelected = dayKey === anchorKey;
              const hasOverdue = items.some(
                (item) => getItemState(item, ctx.today) === "overdue",
              );
              return (
                <button
                  aria-current={isToday ? "date" : undefined}
                  aria-label={dayLabel(day, items, isToday, ctx.today)}
                  aria-selected={isSelected}
                  className={cn(
                    "flex min-h-11 flex-col items-center justify-start gap-1 rounded-lg pt-1 outline-none",
                    "transition-[background-color] duration-150 ease-out motion-reduce:transition-none",
                    "active:bg-[var(--canvas-active)] focus-visible:shadow-[inset_0_0_0_2px_var(--focus-ring)]",
                  )}
                  data-day-key={dayKey}
                  key={dayKey}
                  onClick={() => onSelectDay(day)}
                  role="gridcell"
                  tabIndex={isSelected ? 0 : -1}
                  type="button"
                >
                  <DateMark
                    day={day}
                    inMonth={isSameMonth(day, anchor)}
                    isSelected={isSelected}
                    isToday={isToday}
                  />
                  <span
                    aria-hidden="true"
                    className="flex h-1 items-center gap-0.5"
                  >
                    {items.length > 0 ? (
                      <span className="size-[var(--calendar-dot-size)] rounded-full bg-[var(--ink-faint)]" />
                    ) : null}
                    {hasOverdue ? (
                      <span className="size-[var(--calendar-dot-size)] rounded-full bg-[var(--danger-fg)]" />
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <section
        aria-labelledby="calendar-compact-day"
        className="min-h-0 flex-1 overflow-y-auto border-t border-[var(--hairline)] px-[var(--task-sheet-inset)] pb-2"
      >
        <h3
          className="flex items-baseline gap-2 px-2 pt-3 pb-1.5 text-sm font-medium text-[var(--ink)]"
          id="calendar-compact-day"
        >
          {formatDayTitle(parseDateOnly(anchorKey), ctx.today)}
          <span className="text-xs font-normal text-[var(--ink-faint)]">
            {formatRelativeDay(anchorKey, ctx.today)}
          </span>
        </h3>
        {selectedItems.length === 0 ? (
          <p className="px-2 pt-1 pb-3 text-sm text-[var(--ink-secondary)]">
            Nothing this day.
          </p>
        ) : (
          <TaskList>
            {selectedItems.map((item) => (
              <ScheduleItem item={item} key={item.key} />
            ))}
          </TaskList>
        )}
      </section>
    </div>
  );
}
