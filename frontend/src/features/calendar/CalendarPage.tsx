// /app/calendar (plans/calendar-plan.md). The page owns the data, the URL state,
// the one open popover and the task verbs; the views only render what it hands
// them through CalendarContext.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";

import { useSchoolDeadlines } from "@/api/calendar/hooks";
import type { SchoolDeadlineItem } from "@/api/calendar/types";
import { useApplications, useEssays, useTasks } from "@/api/workspace/hooks";
import type { ApplicationView } from "@/api/workspace/types";
import { Button } from "@/components/ui/button";
import { UndoToast } from "@/components/undo-toast";
import { useIsDesktop } from "@/hooks/use-desktop";
import { PageContainer } from "@/components/workspace/PageContainer";
import { taskFromApi } from "@/domain/task";
import {
  CalendarContext,
  type CalendarContextValue,
  type DragPayload,
} from "@/features/calendar/calendar-context";
import {
  isInRange,
  type CalendarView,
} from "@/features/calendar/calendar-grid";
import { buildCalendarItems } from "@/features/calendar/calendar-items";
import {
  CALENDAR_TITLE_ID,
  CalendarActions,
  CalendarHeading,
} from "@/features/calendar/CalendarHeader";
import {
  CalendarOverlays,
  type CalendarOverlay,
} from "@/features/calendar/CalendarOverlays";
import { CalendarRail } from "@/features/calendar/CalendarRail";
import { CompactMonthView } from "@/features/calendar/CompactMonthView";
import { DayPanel } from "@/features/calendar/DayPanel";
import { focusDayCell } from "@/features/calendar/calendar-grid-keys";
import { MonthView } from "@/features/calendar/MonthView";
import { ScheduleView } from "@/features/calendar/ScheduleView";
import { useAddToList } from "@/features/calendar/useAddToList";
import { useCalendarKeymap } from "@/features/calendar/useCalendarKeymap";
import { useCalendarLayers } from "@/features/calendar/useCalendarLayers";
import { useCalendarLayout } from "@/features/calendar/useCalendarLayout";
import { useCalendarState } from "@/features/calendar/useCalendarState";
import { WeekView } from "@/features/calendar/WeekView";
import { TaskDetailPanel } from "@/features/tasks/TaskDetailPanel";
import { getDateKey, parseDateOnly } from "@/features/tasks/task-dates";
import { useTaskLookups } from "@/features/tasks/useTaskLookups";
import { useTaskRowActions } from "@/features/tasks/useTaskRowActions";
import { useIsMobile } from "@/hooks/use-mobile";
import { getNowDate } from "@/lib/time";

function listOrEmpty<TItem>(value: TItem[] | undefined): TItem[] {
  return Array.isArray(value) ? value : [];
}

function useFinePointer(): boolean {
  const [fine, setFine] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: fine)").matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia("(pointer: fine)");
    const onChange = () => setFine(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return fine;
}

type SourceError = { label: string; retry: () => void };

function SourceErrors({ errors }: { errors: SourceError[] }) {
  if (errors.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1.5">
      {errors.map((error) => (
        <div
          className="flex items-center justify-between gap-3 rounded-lg bg-[var(--danger-surface)] px-3 py-2 text-sm text-[var(--danger-fg)]"
          key={error.label}
          role="alert"
        >
          Could not load {error.label}
          <Button onClick={error.retry} size="xs" variant="outline">
            Try again
          </Button>
        </div>
      ))}
    </div>
  );
}

function EmptyLine({ kind }: { kind: "no-layers" | "first-run" | null }) {
  if (!kind) {
    return null;
  }
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-sm text-[var(--ink-secondary)]">
      {kind === "no-layers" ? (
        "Turn on a calendar to see it here."
      ) : (
        <>
          Add schools to your list to see their deadlines here.
          <Link
            className="font-medium text-[var(--ink)] underline decoration-[var(--edge-strong)] underline-offset-4 transition-[text-decoration-color] duration-150 ease-out hover:decoration-[var(--ink)]"
            to="/app/schools"
          >
            Find schools
          </Link>
        </>
      )}
    </p>
  );
}

export function CalendarPage() {
  const navigate = useNavigate();
  const calendar = useCalendarState();
  const { layers, setFlag, toggleRound } = useCalendarLayers();
  const isDesktop = useIsDesktop();
  const isMobile = useIsMobile();
  const canDrag = useFinePointer();

  const tasksQuery = useTasks();
  const applicationsQuery = useApplications();
  const essaysQuery = useEssays();
  const deadlinesQuery = useSchoolDeadlines({ enabled: layers.allSchools });

  const tasks = useMemo(
    () => listOrEmpty(tasksQuery.data).map(taskFromApi),
    [tasksQuery.data],
  );
  const applications = listOrEmpty(applicationsQuery.data);
  const essays = listOrEmpty(essaysQuery.data);
  const { applicationsById, essaysById } = useTaskLookups(applications, essays);

  // All-schools chips wait for the student's own list too: without it the
  // exclusion cannot run, and their own schools would show as "other".
  const schoolDeadlines =
    deadlinesQuery.data && applicationsQuery.isSuccess
      ? deadlinesQuery.data.items
      : undefined;

  const itemsByDay = useMemo(
    () =>
      buildCalendarItems({
        applications,
        essays,
        layers,
        schoolDeadlines,
        tasks,
      }),
    [applications, essays, layers, schoolDeadlines, tasks],
  );

  const today = getNowDate();
  const todayKey = getDateKey(today);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // The day a keyboard move asked to focus; cleared once its cell exists, so
  // a move that pages the range lands after the new range renders.
  const pendingDayFocus = useRef<string | null>(null);
  const [focusSeq, setFocusSeq] = useState(0);
  const [overlay, setOverlay] = useState<CalendarOverlay>(null);
  const [goToOpen, setGoToOpen] = useState(false);
  const dragRef = useRef<DragPayload | null>(null);
  const pendingChipFocus = useRef<{ key: string; day: string } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const activeTask = tasks.find((task) => task.id === calendar.activeTaskId);
  const dayPanelOpen = Boolean(calendar.dayPanel && deadlinesQuery.data);
  const panelOpen = Boolean(activeTask) || dayPanelOpen;
  const layout = useCalendarLayout(bodyRef, { isDesktop, panelOpen });
  const { railVisible, reservePanel } = layout;
  const isCompact = isMobile || layout.compact;
  // Week needs seven readable columns; where the month is compact, so is Week.
  const view: CalendarView =
    isCompact && calendar.view === "week" ? "month" : calendar.view;
  // A selection paged off screen no longer decides where `c` or `a` lands.
  const selectedInRange =
    selectedKey && isInRange(parseDateOnly(selectedKey), calendar.anchor, view)
      ? selectedKey
      : null;

  const { actions, undo, undoToastProps } = useTaskRowActions({
    onAfterDelete: (taskId) => {
      if (taskId === calendar.activeTaskId) {
        calendar.closePanel();
      }
    },
    onOpen: calendar.openTask,
    tasks,
  });
  const { addToList } = useAddToList(deadlinesQuery.data?.cycle_year);

  // A chip moved from the keyboard keeps focus once it lands on its new day.
  // A task's `due:` chip moved onto its own when day merges into the `task:`
  // chip, so the match falls back to any chip ending in the same task id.
  useEffect(() => {
    const pending = pendingChipFocus.current;
    if (!pending) {
      return;
    }
    const day = `[data-day-key="${pending.day}"]`;
    const taskId = pending.key.split(":").at(-1);
    const chip =
      document.querySelector<HTMLElement>(
        `${day} [data-chip-key="${pending.key}"]`,
      ) ??
      document.querySelector<HTMLElement>(
        `${day} [data-chip-key^="task:"][data-chip-key$=":${taskId}"]`,
      );
    const target = chip?.matches("[data-calendar-focus]")
      ? chip
      : chip?.querySelector<HTMLElement>("[data-calendar-focus]");
    if (target) {
      target.focus();
      pendingChipFocus.current = null;
    }
  }, [itemsByDay]);

  useEffect(() => {
    const pending = pendingDayFocus.current;
    if (pending && focusDayCell(pending)) {
      pendingDayFocus.current = null;
    }
  }, [focusSeq, calendar.anchorKey, view]);

  function moveToDay(day: Date) {
    const key = getDateKey(day);
    if (!isInRange(day, calendar.anchor, view)) {
      calendar.goTo(day, "keyboard");
    }
    setSelectedKey(key);
    pendingDayFocus.current = key;
    setFocusSeq((seq) => seq + 1);
  }

  function selectFromPointer(day: Date) {
    setSelectedKey(getDateKey(day));
    calendar.goTo(day, "pointer");
  }

  function openQuickAdd(dayKey: string, anchor: HTMLElement) {
    setOverlay({ anchor, defaults: { when_on: dayKey }, kind: "quickAdd" });
  }

  function openQuickAddOnSelected() {
    const dayKey = defaultAddDay;
    const cell = document.querySelector<HTMLElement>(
      `[role="gridcell"][data-day-key="${dayKey}"]`,
    );
    const anchor =
      cell ?? document.querySelector<HTMLElement>("[data-calendar-add]");
    if (anchor) {
      openQuickAdd(dayKey, anchor);
    }
  }

  function addTaskFromDeadline(application: ApplicationView, date: string) {
    const anchor = overlay?.anchor;
    if (!anchor) {
      return;
    }
    setOverlay({
      anchor,
      defaults: { application_id: application.id, deadline_on: date },
      kind: "quickAdd",
    });
  }

  function handleAddToList(school: SchoolDeadlineItem) {
    void addToList(school);
  }

  function handleEscape() {
    if (calendar.activeTaskId || calendar.dayPanel) {
      calendar.closePanel();
    } else {
      setSelectedKey(null);
    }
  }

  useCalendarKeymap({
    onEscape: handleEscape,
    onGo: (dir) => calendar.go(dir, "keyboard", view),
    onGoToDate: () => setGoToOpen(true),
    onQuickAdd: openQuickAddOnSelected,
    onToday: () => {
      calendar.goToday("keyboard");
      setSelectedKey(null);
    },
    onUndo: undo,
    onView: (next) => {
      if (isCompact && next === "week") {
        return;
      }
      if (next === "schedule" && selectedInRange) {
        calendar.openIn(next, parseDateOnly(selectedInRange));
      } else {
        calendar.setView(next);
      }
    },
  });

  const contextValue: CalendarContextValue = {
    actions,
    activeTaskId: calendar.activeTaskId,
    applicationsById,
    canDrag,
    drag: {
      current: () => dragRef.current,
      end: () => {
        dragRef.current = null;
      },
      start: (payload) => {
        dragRef.current = payload;
      },
    },
    essaysById,
    moveTask: (payload, toDay, via) => {
      if (payload.fromDay === toDay) {
        return;
      }
      actions.onSchedule(payload.taskId, payload.field, toDay);
      if (via === "keyboard") {
        pendingChipFocus.current = {
          day: toDay,
          key:
            payload.field === "when_on"
              ? `task:${payload.taskId}`
              : `due:task:${payload.taskId}`,
        };
        const day = parseDateOnly(toDay);
        if (!isInRange(day, calendar.anchor, view)) {
          calendar.goTo(day, "keyboard");
        }
      }
    },
    openDayPanel: (target) => {
      setOverlay(null);
      calendar.openDay(target);
    },
    openDayPopover: (dayKey, anchor) =>
      setOverlay({ anchor, dayKey, kind: "day" }),
    openDeadline: (item, anchor) => {
      if (item.kind === "school" || item.kind === "aggregate") {
        setOverlay({ anchor, item, kind: "deadline" });
      }
    },
    openDeadlinePicker: (taskId, anchor) =>
      // The context menu hands focus back to its trigger as it closes; open a
      // frame later so the picker keeps it.
      requestAnimationFrame(() =>
        setOverlay({ anchor, kind: "deadlinePicker", taskId }),
      ),
    openEssay: (essayId) => navigate(`/app/essays/${essayId}`),
    openQuickAdd,
    selectDay: setSelectedKey,
    selectedKey,
    showCompleted: layers.showCompleted,
    today,
    todayKey,
  };

  // Loading honesty (plan §2.10): an empty month is never read as "nothing
  // due" while any enabled source is still missing.
  const sources = [
    { enabled: layers.tasks || layers.due, query: tasksQuery },
    {
      enabled: layers.mySchools || layers.due || layers.allSchools,
      query: applicationsQuery,
    },
    { enabled: layers.due, query: essaysQuery },
    { enabled: layers.allSchools, query: deadlinesQuery },
  ];
  const allLoaded = sources.every(
    (source) => !source.enabled || source.query.isSuccess,
  );
  const anyLayerOn =
    layers.tasks || layers.due || layers.mySchools || layers.allSchools;
  const emptyKind = !anyLayerOn
    ? "no-layers"
    : allLoaded &&
        !layers.allSchools &&
        tasks.length === 0 &&
        applications.length === 0
      ? "first-run"
      : null;

  const errors: SourceError[] = [
    { label: "your tasks", query: tasksQuery },
    { label: "your schools", query: applicationsQuery },
    { label: "your essays", query: essaysQuery },
    { label: "school deadlines", query: deadlinesQuery },
  ]
    .filter((source) => source.query.isError)
    .map((source) => ({
      label: source.label,
      retry: () => void source.query.refetch(),
    }));

  // `+ Task` and `c` add to the selected day, else today when it is on
  // screen, else the first day of the range.
  const defaultAddDay =
    selectedInRange ??
    (isInRange(today, calendar.anchor, view) ? todayKey : calendar.anchorKey);

  const rail = (
    <CalendarRail
      anchor={calendar.anchor}
      layers={layers}
      onSelectDay={selectFromPointer}
      onSetFlag={setFlag}
      onToggleRound={toggleRound}
      schoolDeadlines={{
        data: deadlinesQuery.data,
        isPending: deadlinesQuery.isPending,
      }}
    />
  );

  const gridProps = {
    anchor: calendar.anchor,
    itemsByDay,
    labelledBy: CALENDAR_TITLE_ID,
    onKeyboardMove: moveToDay,
    onOpenDate: (dayKey: string) => {
      setSelectedKey(dayKey);
      calendar.openIn("schedule", parseDateOnly(dayKey));
    },
    rangeMotion: calendar.rangeMotion,
  };

  return (
    <CalendarContext.Provider value={contextValue}>
      <PageContainer
        actions={
          <CalendarActions
            compact={isCompact}
            onAddTask={(anchor) => openQuickAdd(defaultAddDay, anchor)}
            onViewChange={calendar.setView}
            rail={rail}
            railVisible={railVisible && !isMobile}
            view={view}
          />
        }
        className="gap-3"
        fill
        wrapHeader
        heading={
          <CalendarHeading
            anchor={calendar.anchor}
            goToOpen={goToOpen}
            onGo={(dir, via) => calendar.go(dir, via, view)}
            onGoTo={(day) => {
              setSelectedKey(getDateKey(day));
              calendar.goTo(day, "pointer");
            }}
            onGoToOpenChange={setGoToOpen}
            onToday={(via) => {
              setSelectedKey(null);
              calendar.goToday(via);
            }}
            view={view}
          />
        }
        overlay={
          <>
            <UndoToast {...undoToastProps} />
            <CalendarOverlays
              applications={applications}
              essays={essays}
              itemsByDay={itemsByDay}
              onAddTaskFromDeadline={addTaskFromDeadline}
              onAddToList={handleAddToList}
              onClose={() => setOverlay(null)}
              overlay={overlay}
              reportedPeriod={deadlinesQuery.data?.reported_period}
              tasks={tasks}
            />
            <TaskDetailPanel
              applicationsById={applicationsById}
              essaysById={essaysById}
              onDelete={actions.onDelete}
              onOpenChange={(open) => {
                if (!open) {
                  calendar.closePanel();
                }
              }}
              open={Boolean(activeTask)}
              task={activeTask}
            />
            <DayPanel
              deadlines={deadlinesQuery.data?.items}
              listedUnitids={
                new Set(
                  applications.map((application) => application.school_unitid),
                )
              }
              onAddToList={addToList}
              onClose={calendar.closePanel}
              reportedPeriod={deadlinesQuery.data?.reported_period}
              rounds={layers.allSchoolsRounds}
              target={calendar.dayPanel}
            />
          </>
        }
        title="Calendar"
        width="full"
      >
        <SourceErrors errors={errors} />
        <EmptyLine kind={emptyKind} />
        <div
          className="flex min-h-0 flex-1 gap-6"
          data-calendar-body=""
          ref={bodyRef}
          style={
            reservePanel
              ? { paddingInlineEnd: "var(--calendar-panel-reserve)" }
              : undefined
          }
        >
          {railVisible && !isMobile ? (
            <aside
              aria-label="Calendars"
              className="hidden w-[var(--calendar-rail-width)] shrink-0 overflow-x-hidden overflow-y-auto md:block"
            >
              {rail}
            </aside>
          ) : null}
          <div
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--task-sheet-border)] bg-[var(--task-sheet-surface)] shadow-[var(--elevation-1)]"
            aria-busy={!allLoaded}
            data-calendar-sheet=""
          >
            {view === "schedule" ? (
              <ScheduleView
                anchor={calendar.anchor}
                itemsByDay={itemsByDay}
                loading={!allLoaded}
                onNextWindow={() => calendar.go(1, "pointer", view)}
              />
            ) : isCompact ? (
              <CompactMonthView
                anchor={calendar.anchor}
                itemsByDay={itemsByDay}
                labelledBy={CALENDAR_TITLE_ID}
                onKeyboardMove={moveToDay}
                onSelectDay={selectFromPointer}
              />
            ) : view === "week" ? (
              <WeekView {...gridProps} />
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <MonthView {...gridProps} />
              </div>
            )}
          </div>
        </div>
      </PageContainer>
    </CalendarContext.Provider>
  );
}
