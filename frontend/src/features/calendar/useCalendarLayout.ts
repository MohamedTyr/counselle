// The width budget (plan §2.3). One ResizeObserver on the calendar body decides
// two things: whether the rail fits beside the grid, and whether an open panel
// can keep room for itself or has to overlay the grid instead. JS rather than a
// container query, because the `Calendars` button that replaces the rail lives
// in the page header, outside the body being measured.
import { useEffect, useState, type RefObject } from "react";

import {
  DAYS_PER_WEEK,
  MIN_DAY_COLUMN_WIDTH,
  RAIL_MIN_BODY_WIDTH,
} from "@/features/calendar/calendar-grid";

/** `--calendar-panel-reserve` in px: the panel's 26rem plus its inset. */
const PANEL_RESERVE_PX = 26 * 16 + 16;

export function useCalendarLayout(
  bodyRef: RefObject<HTMLElement | null>,
  { isDesktop, panelOpen }: { isDesktop: boolean; panelOpen: boolean },
) {
  const [bodyWidth, setBodyWidth] = useState<number | null>(null);

  useEffect(() => {
    const element = bodyRef.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      // Border box, not content box: the panel reserve is padding on this same
      // element, and measuring inside it would flip the reserve off again.
      setBodyWidth(
        entry.borderBoxSize[0]?.inlineSize ?? entry.contentRect.width,
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [bodyRef]);

  // Before the first measurement (and in jsdom) assume a wide desktop.
  const width = bodyWidth ?? RAIL_MIN_BODY_WIDTH;
  const railVisible = !panelOpen && width >= RAIL_MIN_BODY_WIDTH;
  const reservePanel =
    panelOpen &&
    isDesktop &&
    width - PANEL_RESERVE_PX >= DAYS_PER_WEEK * MIN_DAY_COLUMN_WIDTH;

  // Too narrow for seven readable columns: the month becomes a grid of dates
  // with the selected day listed underneath, as on a phone.
  const compact = width < DAYS_PER_WEEK * MIN_DAY_COLUMN_WIDTH;

  return { compact, railVisible, reservePanel };
}
