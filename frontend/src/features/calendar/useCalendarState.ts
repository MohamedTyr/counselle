// View, date and panel state, all in the URL query of one route:
// `?view=month&date=2026-10-01&task=…` or `…&day=2027-01-01&round=RD`. A
// missing or invalid value falls back (month, today) and is never written
// back, so a bare `/app/calendar` stays bare. Every write merges into the
// current params and replaces history: paging months is not navigation.
import { useState } from "react";
import { useSearchParams } from "react-router";

import type { CalendarRound } from "@/api/calendar/types";
import {
  isCalendarView,
  shiftAnchor,
  type CalendarView,
} from "@/features/calendar/calendar-grid";
import { CALENDAR_ROUND_ORDER } from "@/features/calendar/calendar-items";
import {
  getDateKey,
  isValidDateKey,
  parseDateOnly,
} from "@/features/tasks/task-dates";
import { getNowDate } from "@/lib/time";

/** How a range change was asked for. Only a pointer gets the slide. */
export type NavigationSource = "pointer" | "keyboard";

export type RangeMotion = "next" | "prev" | "none";

export type DayPanelTarget = { day: string; round: CalendarRound };

function isCalendarRound(value: string | null): value is CalendarRound {
  return CALENDAR_ROUND_ORDER.includes(value as CalendarRound);
}

export function useCalendarState() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [rangeMotion, setRangeMotion] = useState<RangeMotion>("none");

  const rawView = searchParams.get("view");
  const view: CalendarView = isCalendarView(rawView) ? rawView : "month";
  const rawDate = searchParams.get("date");
  const anchor =
    rawDate && isValidDateKey(rawDate) ? parseDateOnly(rawDate) : getNowDate();
  const anchorKey = getDateKey(anchor);

  const activeTaskId = searchParams.get("task");
  const rawDay = searchParams.get("day");
  const rawRound = searchParams.get("round");
  const dayPanel: DayPanelTarget | null =
    rawDay && isValidDateKey(rawDay) && isCalendarRound(rawRound)
      ? { day: rawDay, round: rawRound }
      : null;

  function update(apply: (params: URLSearchParams) => void) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        apply(next);
        return next;
      },
      { replace: true },
    );
  }

  function goTo(day: Date, via: NavigationSource) {
    const key = getDateKey(day);
    if (key === anchorKey) {
      return;
    }
    setRangeMotion(
      via === "pointer" ? (key > anchorKey ? "next" : "prev") : "none",
    );
    update((params) => params.set("date", key));
  }

  /** `shown` is the view on screen, which a compact layout can narrow from
   * the URL's (Week renders as Month there, and pages by month). */
  function go(dir: 1 | -1, via: NavigationSource, shown: CalendarView) {
    goTo(shiftAnchor(anchor, shown, dir), via);
  }

  /** Switches view and date in one write: two writes in one tick would each
   * start from the same params, and the second would drop the first. */
  function openIn(next: CalendarView, day: Date) {
    setRangeMotion("none");
    update((params) => {
      params.set("view", next);
      params.set("date", getDateKey(day));
    });
  }

  function goToday(via: NavigationSource) {
    goTo(getNowDate(), via);
  }

  function setView(next: CalendarView) {
    setRangeMotion("none");
    update((params) => params.set("view", next));
  }

  function openTask(taskId: string) {
    update((params) => {
      params.set("task", taskId);
      params.delete("day");
      params.delete("round");
    });
  }

  function openDay(target: DayPanelTarget) {
    update((params) => {
      params.set("day", target.day);
      params.set("round", target.round);
      params.delete("task");
    });
  }

  function closePanel() {
    update((params) => {
      params.delete("task");
      params.delete("day");
      params.delete("round");
    });
  }

  return {
    activeTaskId,
    anchor,
    anchorKey,
    closePanel,
    dayPanel,
    go,
    goTo,
    goToday,
    openDay,
    openIn,
    openTask,
    rangeMotion,
    setView,
    view,
  };
}

export type CalendarState = ReturnType<typeof useCalendarState>;
