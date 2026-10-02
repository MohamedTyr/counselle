// The month grid (plan §2.3–§2.4): exactly the weeks the month touches, rows
// stretched to fill the sheet, hairlines between cells and no outer frame —
// the sheet's own border is the frame.
import { useRef } from "react";

import { CalendarDayCell } from "@/features/calendar/CalendarDayCell";
import {
  formatWeekdayLong,
  formatWeekdayShort,
  isSameMonth,
  monthMatrix,
  rovingDayKey,
} from "@/features/calendar/calendar-grid";
import { handleGridKeyDown } from "@/features/calendar/calendar-grid-keys";
import { useCalendarContext } from "@/features/calendar/calendar-context";
import type { CalendarItem } from "@/features/calendar/calendar-items";
import type { RangeMotion } from "@/features/calendar/useCalendarState";
import { useVisibleChipCount } from "@/features/calendar/useVisibleChipCount";
import { getDateKey } from "@/features/tasks/task-dates";
import { cn } from "@/lib/utils";

export type GridViewProps = {
  anchor: Date;
  itemsByDay: ReadonlyMap<string, CalendarItem[]>;
  labelledBy: string;
  onKeyboardMove: (day: Date) => void;
  onOpenDate: (dayKey: string) => void;
  rangeMotion: RangeMotion;
};

const EMPTY: CalendarItem[] = [];

/** Hidden chips the overflow count is measured from. */
function ChipProbe({ probeRef }: { probeRef: React.Ref<HTMLDivElement> }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none invisible absolute top-0 left-0 w-24"
      ref={probeRef}
    >
      <div className="h-[var(--calendar-date-row)]" data-probe-band="" />
      <div className="flex flex-col gap-[var(--calendar-chip-gap)]">
        <div
          className="h-[var(--calendar-chip-height)] pointer-coarse:h-[var(--calendar-chip-height-touch)]"
          data-probe-chip=""
        />
        <div
          className="h-[var(--calendar-chip-height)] pointer-coarse:h-[var(--calendar-chip-height-touch)]"
          data-probe-chip=""
        />
      </div>
    </div>
  );
}

export function WeekdayHeader({ days }: { days: Date[] }) {
  return (
    <div className="contents" role="row">
      {days.map((day) => (
        <div
          aria-label={formatWeekdayLong(day)}
          className="px-2.5 pt-2 pb-1 text-xs text-[var(--ink-faint)]"
          key={day.getDay()}
          role="columnheader"
        >
          {formatWeekdayShort(day)}
        </div>
      ))}
    </div>
  );
}

export function MonthView({
  anchor,
  itemsByDay,
  labelledBy,
  onKeyboardMove,
  onOpenDate,
  rangeMotion,
}: GridViewProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const weeks = monthMatrix(anchor);
  const visibleCount = useVisibleChipCount(gridRef, probeRef, weeks.length);
  const { selectedKey } = useCalendarContext();
  const focusKey = rovingDayKey(weeks.flat(), selectedKey, anchor);

  return (
    <div
      aria-labelledby={labelledBy}
      className="relative grid h-full min-h-0 grid-cols-7"
      data-range-motion={rangeMotion === "none" ? undefined : rangeMotion}
      onKeyDown={(event) => handleGridKeyDown(event, onKeyboardMove)}
      ref={gridRef}
      role="grid"
      style={{
        gridTemplateRows: `auto repeat(${weeks.length}, minmax(var(--calendar-row-min), 1fr))`,
      }}
    >
      <ChipProbe probeRef={probeRef} />
      <WeekdayHeader days={weeks[0]} />
      {weeks.map((week, weekIndex) => (
        <div
          className="contents"
          data-calendar-week=""
          key={getDateKey(week[0])}
          role="row"
        >
          {week.map((day, dayIndex) => {
            const dayKey = getDateKey(day);
            return (
              <CalendarDayCell
                className={cn(
                  weekIndex > 0 && "border-t border-[var(--calendar-gridline)]",
                  dayIndex > 0 && "border-l border-[var(--calendar-gridline)]",
                )}
                day={day}
                inMonth={isSameMonth(day, anchor)}
                isFocusTarget={dayKey === focusKey}
                items={itemsByDay.get(dayKey) ?? EMPTY}
                key={dayKey}
                onOpenDate={onOpenDate}
                visibleCount={visibleCount}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
