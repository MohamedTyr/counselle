// The calendar's page-level shortcuts (plan P7.5), Google's set. Grid-internal
// keys (arrows, Home/End, PageUp/PageDown, Enter/Escape) live with the grid in
// calendar-grid-keys.ts; this hook only handles keys that mean the same thing
// wherever focus is. Nothing fires while focus is in a text field or inside an
// open popover, which owns its own keys.
import { useEffect, useLayoutEffect, useRef } from "react";

import type { CalendarView } from "@/features/calendar/calendar-grid";
import {
  isEditingSurface,
  isInsidePopover,
} from "@/features/tasks/useTaskKeymap";

const VIEW_KEYS: Record<string, CalendarView> = {
  a: "schedule",
  m: "month",
  w: "week",
};

export type CalendarKeymapHandlers = {
  onGo: (dir: 1 | -1) => void;
  onToday: () => void;
  onView: (view: CalendarView) => void;
  onQuickAdd: () => void;
  onGoToDate: () => void;
  onUndo: () => void;
  /** Escape outside every popover: close the panel, else clear the day. */
  onEscape: () => void;
};

/** ←/→ page the range only from somewhere that has no arrow keys of its own:
 * the page itself, not a grid, a tab list, a button or a link. */
function ownsArrowKeys(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        '[role="grid"],[role="tablist"],button,a[href],[role="button"],[role="checkbox"],[role="switch"]',
      ),
    )
  );
}

function isInsideDialog(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(
      target.closest('[role="dialog"],[role="menu"],[data-slot="sheet-popup"]'),
    )
  );
}

/** The docked side panel is not modal, so Escape still closes it, but its
 * buttons are not the calendar's: letters there must not page the range. */
function isInsideDockedPanel(target: EventTarget | null): boolean {
  return (
    target instanceof Element && Boolean(target.closest("[data-docked-panel]"))
  );
}

export function useCalendarKeymap(handlers: CalendarKeymapHandlers) {
  // Always the latest handlers, without re-binding the listener every render.
  const handlersRef = useRef(handlers);
  useLayoutEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const current = handlersRef.current;
      const target = event.target;
      if (isEditingSurface(target)) {
        return;
      }
      if (event.key === "Escape") {
        if (!isInsidePopover(target) && !isInsideDialog(target)) {
          current.onEscape();
        }
        return;
      }
      if (event.defaultPrevented) {
        return;
      }

      if (isInsidePopover(target) || isInsideDialog(target)) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "z" && (event.metaKey || event.ctrlKey) && !event.shiftKey) {
        event.preventDefault();
        current.onUndo();
        return;
      }
      if (isInsideDockedPanel(target)) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (key === "t") {
        current.onToday();
      } else if (key === "j" || key === "n") {
        current.onGo(1);
      } else if (key === "k" || key === "p") {
        current.onGo(-1);
      } else if (
        (event.key === "ArrowRight" || event.key === "ArrowLeft") &&
        !ownsArrowKeys(target)
      ) {
        current.onGo(event.key === "ArrowRight" ? 1 : -1);
      } else if (VIEW_KEYS[key]) {
        current.onView(VIEW_KEYS[key]);
      } else if (key === "c") {
        current.onQuickAdd();
      } else if (event.key === ".") {
        current.onGoToDate();
      } else {
        return;
      }
      event.preventDefault();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);
}
