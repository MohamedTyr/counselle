// Week view (plan §2.8): seven columns, a small weekday over a large date, and
// one all-day lane per day showing every chip — no cap, and each chip gets a
// second line. Same grid semantics and interactions as Month.
import { useRef } from "react";

import { CalendarDayCell, DateMark } from "@/features/calendar/CalendarDayCell";
import { useCalendarContext } from "@/features/calendar/calendar-context";
import {
  formatDayLabel,
  formatWeekdayLong,
  formatWeekdayShort,
  weekDays,
  rovingDayKey,
} from "@/features/calendar/calendar-grid";
import { handleGridKeyDown } from "@/features/calendar/calendar-grid-keys";
import type { CalendarItem } from "@/features/calendar/calendar-items";
import type { GridViewProps } from "@/features/calendar/MonthView";
import { getDateKey } from "@/features/tasks/task-dates";
import { cn } from "@/lib/utils";

const EMPTY: CalendarItem[] = [];

export function WeekView({
  anchor,
  itemsByDay,
  labelledBy,
  onKeyboardMove,
  onOpenDate,
  rangeMotion,
}: GridViewProps) {
  const ctx = useCalendarContext();
  const gridRef = useRef<HTMLDivElement>(null);
  const days = weekDays(anchor);
  const focusKey = rovingDayKey(days, ctx.selectedKey, anchor);

  return (
    <div
      aria-labelledby={labelledBy}
      className="relative grid h-full min-h-0 grid-cols-7 grid-rows-[auto_1fr] overflow-y-auto"
      data-range-motion={rangeMotion === "none" ? undefined : rangeMotion}
      onKeyDown={(event) => handleGridKeyDown(event, onKeyboardMove)}
      ref={gridRef}
      role="grid"
    >
      <div className="contents" role="row">
        {days.map((day, index) => {
          const dayKey = getDateKey(day);
          return (
            <div
              aria-label={formatWeekdayLong(day)}
              className={cn(
                "sticky top-0 z-[var(--z-floating-panel)] flex flex-col items-start gap-0.5 border-b border-[var(--calendar-gridline)] bg-[var(--task-sheet-surface)] px-2.5 pt-2.5 pb-2",
                index > 0 && "border-l",
              )}
              key={dayKey}
              role="columnheader"
            >
              <span className="text-xs text-[var(--ink-faint)]">
                {formatWeekdayShort(day)}
              </span>
              <button
                aria-label={`Open ${formatDayLabel(day)} in Schedule`}
                className="-ml-2 rounded-full outline-none hover:[&>span]:bg-[var(--surface-inset)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] [&>span]:transition-[background-color] [&>span]:duration-150 [&>span]:ease-out motion-reduce:[&>span]:transition-none"
                onClick={() => onOpenDate(dayKey)}
                tabIndex={-1}
                type="button"
              >
                <DateMark
                  day={day}
                  isSelected={dayKey === ctx.selectedKey}
                  isToday={dayKey === ctx.todayKey}
                  size="lg"
                />
              </button>
            </div>
          );
        })}
      </div>
      <div className="contents" role="row">
        {days.map((day, index) => {
          const dayKey = getDateKey(day);
          return (
            <CalendarDayCell
              className={cn(
                "min-h-[var(--calendar-row-min)] pt-1",
                index > 0 && "border-l border-[var(--calendar-gridline)]",
              )}
              day={day}
              isFocusTarget={dayKey === focusKey}
              items={itemsByDay.get(dayKey) ?? EMPTY}
              key={dayKey}
              showDateBand={false}
            />
          );
        })}
      </div>
    </div>
  );
}
