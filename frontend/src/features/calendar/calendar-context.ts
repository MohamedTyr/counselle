// What every chip, cell and row needs from the page, in one place, so the
// views do not thread a dozen callbacks through three levels of props.
import { createContext, useContext } from "react";

import type { ApplicationView, EssaySummary } from "@/api/workspace/types";
import type { CalendarItem } from "@/features/calendar/calendar-items";
import type { DayPanelTarget } from "@/features/calendar/useCalendarState";
import type { QuickAddDefaults } from "@/features/tasks/QuickAddBar";
import type { TaskRowActions } from "@/features/tasks/TaskRowMenu";

export type DragPayload = {
  taskId: string;
  field: "when_on" | "deadline_on";
  fromDay: string;
};

export type CalendarContextValue = {
  today: Date;
  todayKey: string;
  /** The selected day, if the student picked one this visit. */
  selectedKey: string | null;
  activeTaskId: string | null;
  showCompleted: boolean;
  actions: TaskRowActions;
  applicationsById: ReadonlyMap<string, ApplicationView>;
  essaysById: ReadonlyMap<string, EssaySummary>;
  /** Fine pointer: chips can be dragged. */
  canDrag: boolean;
  /** The drag in flight. `dataTransfer` cannot be read during `dragover`,
   * so the page keeps it. */
  drag: {
    current: () => DragPayload | null;
    end: () => void;
    start: (payload: DragPayload) => void;
  };
  /** Moves a task's date through the same undoable action as everything else,
   * keeping the moved chip focused when the keyboard did it. */
  moveTask: (
    payload: DragPayload,
    toDay: string,
    via: "pointer" | "keyboard",
  ) => void;
  openDayPanel: (target: DayPanelTarget) => void;
  openDayPopover: (dayKey: string, anchor: HTMLElement) => void;
  openDeadline: (item: CalendarItem, anchor: HTMLElement) => void;
  openDeadlinePicker: (taskId: string, anchor: HTMLElement) => void;
  openEssay: (essayId: string) => void;
  openQuickAdd: (
    dayKey: string,
    anchor: HTMLElement,
    defaults?: QuickAddDefaults,
  ) => void;
  selectDay: (dayKey: string) => void;
};

export const CalendarContext = createContext<CalendarContextValue | null>(null);

export function useCalendarContext(): CalendarContextValue {
  const value = useContext(CalendarContext);
  if (!value) {
    throw new Error("useCalendarContext must be used inside CalendarPage.");
  }
  return value;
}
