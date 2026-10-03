// One day of the Month or Week grid (plan §2.4): a date band, then the day's
// chips. The cell is never filled to show selection — the selected day is
// marked on its date number — so no chip can disappear into it.
import { useState, type DragEvent, type MouseEvent } from "react";

import { CalendarChip } from "@/features/calendar/CalendarChip";
import { useCalendarContext } from "@/features/calendar/calendar-context";
import {
  formatDayLabel,
  formatMonthDay,
} from "@/features/calendar/calendar-grid";
import {
  visibleCellItems,
  type CalendarItem,
} from "@/features/calendar/calendar-items";
import { getDateKey } from "@/features/tasks/task-dates";
import { cn } from "@/lib/utils";

function countLabel(count: number): string {
  if (count === 0) {
    return "no items";
  }
  return count === 1 ? "1 item" : `${count} items`;
}

/** The date number: an ink pill for today, a quiet pill for the selected day. */
export function DateMark({
  day,
  inMonth = true,
  isSelected,
  isToday,
  size = "sm",
  showMonth = false,
}: {
  day: Date;
  inMonth?: boolean;
  isSelected: boolean;
  isToday: boolean;
  size?: "sm" | "lg";
  showMonth?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full font-medium tabular-nums",
        size === "sm"
          ? "h-[var(--calendar-today-size)] min-w-[var(--calendar-today-size)] px-1.5 text-chrome"
          : "h-8 min-w-8 px-2 text-lg",
        isToday
          ? "bg-[var(--calendar-today-fill)] text-[var(--calendar-today-ink)]"
          : isSelected
            ? "bg-[var(--calendar-selected-date)] text-[var(--ink)]"
            : inMonth
              ? "text-[var(--ink)]"
              : "text-[var(--calendar-outside-ink)]",
      )}
    >
      {showMonth ? formatMonthDay(day) : day.getDate()}
    </span>
  );
}

export function CalendarDayCell({
  className,
  day,
  inMonth = true,
  isFocusTarget,
  items,
  onOpenDate,
  showDateBand = true,
  visibleCount,
}: {
  className?: string;
  day: Date;
  inMonth?: boolean;
  /** The one cell in the grid that is a tab stop. */
  isFocusTarget: boolean;
  items: CalendarItem[];
  onOpenDate?: (dayKey: string) => void;
  showDateBand?: boolean;
  /** Month view caps the stack; Week view shows every chip. */
  visibleCount?: number;
}) {
  const ctx = useCalendarContext();
  const dayKey = getDateKey(day);
  const isToday = dayKey === ctx.todayKey;
  const isSelected = dayKey === ctx.selectedKey;
  const isWeekend = day.getDay() === 0 || day.getDay() === 6;
  const [isDropTarget, setIsDropTarget] = useState(false);

  const { hiddenCount, shown } =
    visibleCount === undefined
      ? { hiddenCount: 0, shown: items }
      : visibleCellItems(items, visibleCount);

  const label = `${formatDayLabel(day)}${isToday ? ", today" : ""}, ${countLabel(items.length)}`;

  function handleEmptyClick(event: MouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("[data-calendar-chip], button")) {
      return;
    }
    ctx.selectDay(dayKey);
    ctx.openQuickAdd(dayKey, event.currentTarget);
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    if (!ctx.drag.current()) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (!isDropTarget) {
      setIsDropTarget(true);
    }
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    const payload = ctx.drag.current();
    setIsDropTarget(false);
    if (!payload) {
      return;
    }
    event.preventDefault();
    ctx.drag.end();
    ctx.moveTask(payload, dayKey, "pointer");
  }

  return (
    <div
      aria-current={isToday ? "date" : undefined}
      aria-label={label}
      aria-selected={isSelected}
      className={cn(
        "relative flex min-h-0 min-w-0 cursor-default flex-col overflow-hidden outline-none",
        "transition-[background-color,box-shadow] duration-150 ease-out motion-reduce:transition-none",
        "focus-visible:shadow-[inset_0_0_0_2px_var(--focus-ring)]",
        isWeekend && "bg-[var(--calendar-weekend)]",
        isDropTarget &&
          "bg-[var(--calendar-drop-target)] shadow-[inset_0_0_0_1px_var(--calendar-aggregate-edge)]",
        className,
      )}
      data-day-key={dayKey}
      onClick={handleEmptyClick}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsDropTarget(false);
        }
      }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      role="gridcell"
      tabIndex={isFocusTarget ? 0 : -1}
    >
      <div className="calendar-cell-content flex min-h-0 flex-1 flex-col">
        {showDateBand ? (
          <div className="flex h-[var(--calendar-date-row)] shrink-0 items-center px-1">
            <button
              aria-label={`Open ${formatDayLabel(day)} in Schedule`}
              className={cn(
                "rounded-full outline-none",
                "transition-[background-color] duration-150 ease-out motion-reduce:transition-none",
                "hover:[&>span]:bg-[var(--surface-inset)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
                isToday && "hover:[&>span]:bg-[var(--brand-hover)]",
              )}
              onClick={(event) => {
                event.stopPropagation();
                onOpenDate?.(dayKey);
              }}
              tabIndex={-1}
              type="button"
            >
              <DateMark
                day={day}
                inMonth={inMonth}
                isSelected={isSelected}
                isToday={isToday}
                showMonth={day.getDate() === 1}
              />
            </button>
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col gap-[var(--calendar-chip-gap)] px-1 pb-1">
          {shown.map((item) => (
            <CalendarChip
              density={visibleCount === undefined ? "comfortable" : "compact"}
              item={item}
              key={item.key}
            />
          ))}
          {hiddenCount > 0 ? (
            <button
              className={cn(
                "flex h-[var(--calendar-chip-height)] shrink-0 items-center rounded-md px-1.5 text-left text-xs font-medium text-[var(--ink-secondary)] outline-none",
                "transition-[background-color,color] duration-150 ease-out motion-reduce:transition-none",
                "hover:bg-[var(--calendar-task-hover)] hover:text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-inset",
                "data-[popup-open]:bg-[var(--calendar-task-hover)]",
              )}
              data-calendar-more=""
              onClick={(event) => {
                event.stopPropagation();
                ctx.openDayPopover(dayKey, event.currentTarget);
              }}
              tabIndex={-1}
              type="button"
            >
              {hiddenCount} more
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
