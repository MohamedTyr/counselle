// The header bar (plan §2.5), in Google's order: Today, the two chevrons, then
// the range title — which is itself the "Go to date" button. The actions on the
// right are the view switch, the rail's popover twin when the rail has no room,
// and `+ Task`.
import type { MouseEvent, ReactElement, ReactNode } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Layers,
  Plus,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  formatRangeTitle,
  isCalendarView,
  type CalendarView,
} from "@/features/calendar/calendar-grid";
import { GoToDatePopover } from "@/features/calendar/GoToDatePopover";
import type { NavigationSource } from "@/features/calendar/useCalendarState";
import { cn } from "@/lib/utils";

export const CALENDAR_TITLE_ID = "calendar-range-title";

function Hint({
  children,
  keys,
  label,
}: {
  children: ReactElement;
  keys: string;
  label: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent sideOffset={6}>
        {label}
        <Kbd>{keys}</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}

/** A click from a pointer has `detail > 0`; Enter or Space on a focused button
 * reports 0. Only the pointer gets the slide (plan §2.9). */
function sourceOf(event: MouseEvent): NavigationSource {
  return event.detail > 0 ? "pointer" : "keyboard";
}

export function CalendarHeading({
  anchor,
  goToOpen,
  onGo,
  onGoTo,
  onGoToOpenChange,
  onToday,
  view,
}: {
  anchor: Date;
  goToOpen: boolean;
  onGo: (dir: 1 | -1, via: NavigationSource) => void;
  onGoTo: (day: Date) => void;
  onGoToOpenChange: (open: boolean) => void;
  onToday: (via: NavigationSource) => void;
  view: CalendarView;
}) {
  const title = formatRangeTitle(anchor, view);
  const unit =
    view === "week" ? "week" : view === "schedule" ? "8 weeks" : "month";

  return (
    <div className="flex min-w-0 items-center gap-3">
      <h1 className="sr-only">Calendar</h1>
      <Hint keys="T" label="Today">
        <Button
          className="shrink-0"
          onClick={(event) => onToday(sourceOf(event))}
          size="sm"
          variant="outline"
        >
          Today
        </Button>
      </Hint>
      <div className="flex shrink-0 items-center">
        <Hint keys="K" label={`Previous ${unit}`}>
          <Button
            aria-label={`Previous ${unit}`}
            className="active:scale-[0.97]"
            onClick={(event) => onGo(-1, sourceOf(event))}
            size="icon-sm"
            variant="ghost"
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
        </Hint>
        <Hint keys="J" label={`Next ${unit}`}>
          <Button
            aria-label={`Next ${unit}`}
            className="active:scale-[0.97]"
            onClick={(event) => onGo(1, sourceOf(event))}
            size="icon-sm"
            variant="ghost"
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </Hint>
      </div>
      <GoToDatePopover
        anchor={anchor}
        onGoTo={onGoTo}
        onOpenChange={onGoToOpenChange}
        open={goToOpen}
      >
        <button
          aria-label={`${title.primary} ${title.secondary}, go to date`}
          className={cn(
            "group/title -ms-1.5 flex min-w-0 items-center gap-1 rounded-lg px-1.5 py-0.5 outline-none",
            "transition-[background-color] duration-150 ease-out motion-reduce:transition-none",
            "hover:bg-[var(--canvas-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] data-[popup-open]:bg-[var(--canvas-hover)]",
          )}
          type="button"
        >
          <span
            aria-live="polite"
            className="text-xl leading-7 font-semibold tracking-tight whitespace-nowrap text-[var(--ink)]"
            id={CALENDAR_TITLE_ID}
          >
            {title.primary}{" "}
            <span className="font-normal text-[var(--ink-faint)]">
              {title.secondary}
            </span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className="size-4 shrink-0 text-[var(--ink-faint)] transition-[translate] duration-150 ease-out group-hover/title:translate-y-px motion-reduce:transition-none"
          />
        </button>
      </GoToDatePopover>
    </div>
  );
}

const VIEW_TABS: { view: CalendarView; label: string; keys: string }[] = [
  { keys: "M", label: "Month", view: "month" },
  { keys: "W", label: "Week", view: "week" },
  { keys: "A", label: "Schedule", view: "schedule" },
];

export function CalendarActions({
  compact,
  onAddTask,
  onViewChange,
  rail,
  railVisible,
  view,
}: {
  compact: boolean;
  onAddTask: (anchor: HTMLElement) => void;
  onViewChange: (view: CalendarView) => void;
  /** The rail's content, for the `Calendars` popover. */
  rail: ReactNode;
  railVisible: boolean;
  view: CalendarView;
}) {
  return (
    <div className="flex items-center gap-2">
      <Tabs
        onValueChange={(value) => {
          if (typeof value === "string" && isCalendarView(value)) {
            onViewChange(value);
          }
        }}
        value={view}
      >
        <TabsList aria-label="Calendar view" variant="pill">
          {VIEW_TABS.filter((tab) => !(compact && tab.view === "week")).map(
            (tab) => (
              <Hint keys={tab.keys} key={tab.view} label={tab.label}>
                <TabsTab value={tab.view}>{tab.label}</TabsTab>
              </Hint>
            ),
          )}
        </TabsList>
      </Tabs>
      {railVisible ? null : (
        <Popover>
          <PopoverTrigger
            render={
              <Button aria-label="Calendars" size="sm" variant="outline">
                <Layers aria-hidden="true" />
                <span className="hidden xl:inline">Calendars</span>
              </Button>
            }
          />
          <PopoverPopup align="end" className="w-64" sideOffset={6}>
            {rail}
          </PopoverPopup>
        </Popover>
      )}
      <Hint keys="C" label="New task">
        <Button
          className="active:scale-[0.97]"
          data-calendar-add=""
          onClick={(event) => onAddTask(event.currentTarget)}
          size="sm"
        >
          <Plus aria-hidden="true" />
          Task
        </Button>
      </Hint>
    </div>
  );
}
