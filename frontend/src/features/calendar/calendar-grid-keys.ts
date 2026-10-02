// The W3C APG grid pattern for the Month and Week grids. One cell is a tab
// stop; arrows move a day or a week, Home/End the week's ends, PageUp/PageDown
// a month. Enter moves into the cell's chips, ↑/↓ rove them and Escape goes
// back out. Moving past the edge of the range pages it, with no animation —
// keyboard paging is instant by design.
import type { KeyboardEvent } from "react";

import { shiftMonths, startOfWeek } from "@/features/calendar/calendar-grid";
import { addDays, parseDateOnly } from "@/features/tasks/task-dates";

const CHIP_FOCUS_SELECTOR = "[data-calendar-focus], [data-calendar-more]";

function cellOf(element: Element): HTMLElement | null {
  return element.closest<HTMLElement>('[role="gridcell"]');
}

function chipFocusables(cell: HTMLElement): HTMLElement[] {
  return Array.from(cell.querySelectorAll<HTMLElement>(CHIP_FOCUS_SELECTOR));
}

function targetDay(key: string, current: Date, weekStep: number): Date | null {
  switch (key) {
    case "ArrowLeft":
      return addDays(current, -1);
    case "ArrowRight":
      return addDays(current, 1);
    case "ArrowUp":
      return addDays(current, -weekStep);
    case "ArrowDown":
      return addDays(current, weekStep);
    case "Home":
      return startOfWeek(current);
    case "End":
      return addDays(startOfWeek(current), 6);
    case "PageUp":
      return shiftMonths(current, -1);
    case "PageDown":
      return shiftMonths(current, 1);
    default:
      return null;
  }
}

/** Handles a keydown anywhere inside a grid. Returns true when it acted. */
export function handleGridKeyDown(
  event: KeyboardEvent<HTMLElement>,
  moveTo: (day: Date) => void,
): boolean {
  const target = event.target as HTMLElement;
  const cell = cellOf(target);
  if (!cell || event.metaKey || event.ctrlKey) {
    return false;
  }

  // On the cell itself: move between days, or step into its chips.
  if (target === cell) {
    if (event.altKey) {
      return false;
    }
    if (event.key === "Enter") {
      const [first] = chipFocusables(cell);
      if (first) {
        event.preventDefault();
        first.focus();
        return true;
      }
      return false;
    }
    const dayKey = cell.dataset.dayKey;
    const next = dayKey ? targetDay(event.key, parseDateOnly(dayKey), 7) : null;
    if (next) {
      event.preventDefault();
      moveTo(next);
      return true;
    }
    return false;
  }

  // Inside the cell: rove between its chips, and Escape back to the cell.
  if (event.key === "Escape") {
    // Left to bubble: the page's Escape also closes an open panel.
    cell.focus();
    return true;
  }
  // Tab is left alone so it leaves the grid, as the APG grid pattern expects.
  const isNext = event.key === "ArrowDown";
  const isPrev = event.key === "ArrowUp";
  if (!isNext && !isPrev) {
    return false;
  }
  const focusables = chipFocusables(cell);
  const index = focusables.findIndex(
    (element) => element === target || element.contains(target),
  );
  if (index === -1) {
    return false;
  }
  const nextIndex =
    (index + (isNext ? 1 : -1) + focusables.length) % focusables.length;
  event.preventDefault();
  focusables[nextIndex].focus();
  return true;
}

/** Focuses the calendar grid's cell for `dayKey`. False until it renders. */
export function focusDayCell(dayKey: string): boolean {
  const cell = document.querySelector<HTMLElement>(
    `[data-calendar-sheet] [role="gridcell"][data-day-key="${dayKey}"]`,
  );
  cell?.focus();
  return Boolean(cell);
}
