// The tasks route's parent layout (plans/tasks-redesign-plan.md P6.1,
// plans/tasks-redesign-design.md §2.1-2.3). Hoists `useTasks()`,
// `useApplications()`, `useEssays()` once and threads the result — plus the
// four views' pre-computed groups, so a tab count, a page subtitle, and a
// rendered row count can never disagree (P6.1) — through `<Outlet
// context={…} />`. Also owns the page scaffold, the view tabs, the
// quick-add bar, the detail panel, and the undo-toast seam.
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import {
  NavLink,
  Outlet,
  useLocation,
  useOutletContext,
  useSearchParams,
} from "react-router";

import type { ApplicationView, EssaySummary } from "@/api/workspace/types";
import {
  useApplications,
  useCompleteTask,
  useEssays,
  useTasks,
  useScheduleTask,
  useToggleFlag,
} from "@/api/workspace/hooks";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { UndoToast } from "@/components/undo-toast";
import { PageContainer } from "@/components/workspace/PageContainer";
import { taskFromApi, type Task } from "@/domain/task";
import { QuickAddBar, type QuickAddDefaults } from "@/features/tasks/QuickAddBar";
import { PlanWithAgentButton } from "@/features/tasks/task-actions";
import { TaskDetailPanel } from "@/features/tasks/TaskDetailPanel";
import {
  getAnytimeGroups,
  getDoneThisWeekCount,
  getLogbookGroups,
  getTodayGroups,
  getUpcomingGroups,
  hasCompletedTodayPlan,
  type TaskGroup,
  type TodayGroups,
} from "@/features/tasks/task-filters";
import { formatPageSubtitle, getDateKey, type TaskSubtitleView } from "@/features/tasks/task-dates";
import { getNowDate } from "@/lib/time";
import { cn } from "@/lib/utils";

export type TasksOutletContext = {
  tasks: Task[];
  applications: ApplicationView[];
  essays: EssaySummary[];
  applicationsById: ReadonlyMap<string, ApplicationView>;
  essaysById: ReadonlyMap<string, EssaySummary>;
  todayGroups: TodayGroups;
  upcomingGroups: TaskGroup[];
  anytimeGroups: TaskGroup[];
  logbookGroups: TaskGroup[];
  doneThisWeekCount: number;
  hasCompletedTodayPlan: boolean;
  activeTaskId: string | null;
  onOpenTask: (taskId: string) => void;
  onComplete: (taskId: string, done: boolean) => void;
  onSchedule: (
    taskId: string,
    field: "when_on" | "deadline_on",
    value: string | null,
  ) => void;
  onToggleFlag: (taskId: string) => void;
};

export function useTasksOutletContext() {
  return useOutletContext<TasksOutletContext>();
}

type TaskViewName = "today" | "upcoming" | "anytime" | "logbook";

function resolveView(pathname: string): TaskViewName {
  if (pathname.endsWith("/upcoming")) {
    return "upcoming";
  }
  if (pathname.endsWith("/anytime")) {
    return "anytime";
  }
  if (pathname.endsWith("/logbook")) {
    return "logbook";
  }
  return "today";
}

const VIEW_TITLES: Record<TaskViewName, string> = {
  anytime: "Anytime",
  logbook: "Logbook",
  today: "Today",
  upcoming: "Upcoming",
};

function listOrEmpty<TItem>(value: TItem[] | undefined): TItem[] {
  return Array.isArray(value) ? value : [];
}

/** design doc §2.3 — one tab, shared by Today/Upcoming/Anytime. Logbook is
 * deliberately absent from the tab row (spec §6.4: footer link only).
 * `active` is computed by the caller (from the already-known `view`) rather
 * than from `NavLink`'s own render-prop `isActive`, so `aria-selected` can
 * sit on the same `role="tab"` element instead of a nested presentational
 * span. */
function ViewTab({
  active,
  count,
  label,
  to,
}: {
  active: boolean;
  count: number;
  label: string;
  to: string;
}) {
  return (
    <NavLink
      aria-selected={active}
      className={cn(
        "relative inline-flex h-8 cursor-pointer items-center gap-1.5 text-sm outline-none",
        "transition-[color] duration-150 ease-out",
        "focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)] focus-visible:rounded-sm",
        active
          ? "font-medium text-[var(--ink)] after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-[var(--brand)]"
          : "text-[var(--ink-faint)] hover:text-[var(--ink-secondary)]",
      )}
      end
      role="tab"
      to={to}
    >
      {label}
      <span className="ml-2 text-[var(--ink-faint)] tabular-nums">{count}</span>
    </NavLink>
  );
}

/**
 * design doc §2.5 — one group-header treatment, every view. `isFirst` drops
 * the 24px `mt-6` for whichever group renders directly under the quick-add
 * bar (that gap is already the quick-add-to-content 8px, not the 24px
 * between-groups rhythm). `sticky` is true for Upcoming and Anytime only —
 * Today and Logbook have too few groups for it to matter.
 */
export function TaskGroupHeader({
  count,
  isFirst = false,
  label,
  sticky = false,
  variant,
}: {
  count: number;
  isFirst?: boolean;
  label: string;
  sticky?: boolean;
  variant?: "unplanned-deadlines";
}) {
  return (
    <div
      className={cn(
        "-mx-2 mb-1 flex h-7 items-center bg-[var(--canvas)] pr-2 pl-[calc(var(--task-row-spine)+--spacing(2))]",
        !isFirst && "mt-6",
        sticky && "sticky top-0 z-[var(--z-sticky)]",
      )}
    >
      <span
        className={cn(
          "text-[13px] font-medium",
          variant === "unplanned-deadlines"
            ? "text-[var(--ink-secondary)]"
            : "text-[var(--ink)]",
        )}
      >
        {label}
      </span>
      <span className="ml-2 text-[13px] text-[var(--ink-faint)] tabular-nums">{count}</span>
    </div>
  );
}

/** design doc §2.5 — the hairline that closes "Deadlines without a plan",
 * the one rule in the list body. */
export function TaskGroupCloseRule() {
  return <div className="mt-3 h-px bg-[var(--hairline)]" aria-hidden="true" />;
}

export function TasksLayout() {
  const tasksQuery = useTasks();
  const applicationsQuery = useApplications();
  const essaysQuery = useEssays();
  const completeTaskMutation = useCompleteTask();
  const scheduleTaskMutation = useScheduleTask();
  const toggleFlagMutation = useToggleFlag();

  const [searchParams, setSearchParams] = useSearchParams();
  const [searchOpen, setSearchOpen] = useState(false);
  const location = useLocation();
  const view = resolveView(location.pathname);
  const referenceDate = getNowDate();

  const tasks = useMemo(
    () => listOrEmpty(tasksQuery.data).map(taskFromApi),
    [tasksQuery.data],
  );
  const applications = listOrEmpty(applicationsQuery.data);
  const essays = listOrEmpty(essaysQuery.data);
  const applicationsById = useMemo(
    () => new Map(applications.map((application) => [application.id, application])),
    [applications],
  );
  const essaysById = useMemo(
    () => new Map(essays.map((essay) => [essay.id, essay])),
    [essays],
  );

  // Computed once, here, and threaded to every consumer (tabs, subtitle,
  // views) — the MUST from plan P6.1: never a separate count query, never
  // hand-duplicated filter logic.
  const todayGroups = useMemo(
    () => getTodayGroups(tasks, referenceDate),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- referenceDate is a fresh Date every render; the tasks list is the real dependency.
    [tasks],
  );
  const upcomingGroups = useMemo(
    () => getUpcomingGroups(tasks, referenceDate),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks],
  );
  const anytimeGroups = useMemo(
    () => getAnytimeGroups(tasks, applicationsById, essaysById),
    [tasks, applicationsById, essaysById],
  );
  const logbookGroups = useMemo(
    () => getLogbookGroups(tasks, referenceDate),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks],
  );
  const doneThisWeekCount = useMemo(
    () => getDoneThisWeekCount(tasks, referenceDate),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks],
  );
  const completedTodayPlan = useMemo(
    () => hasCompletedTodayPlan(tasks, referenceDate),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks],
  );

  const todayCount = todayGroups.main.length;
  const upcomingCount = upcomingGroups.reduce((sum, group) => sum + group.tasks.length, 0);
  const anytimeCount = anytimeGroups.reduce((sum, group) => sum + group.tasks.length, 0);

  const subtitleCount: Record<TaskViewName, number> = {
    anytime: anytimeCount,
    logbook: doneThisWeekCount,
    today: todayCount,
    upcoming: upcomingCount,
  };
  const subtitle = formatPageSubtitle(
    view as TaskSubtitleView,
    subtitleCount[view],
    referenceDate,
  );

  const activeTaskId = searchParams.get("task");
  const activeTask = tasks.find((task) => task.id === activeTaskId);

  function openTask(taskId: string) {
    setSearchParams(
      (currentParams) => {
        const nextParams = new URLSearchParams(currentParams);
        nextParams.set("task", taskId);
        return nextParams;
      },
      { replace: true },
    );
  }

  function closeTask() {
    setSearchParams(
      (currentParams) => {
        const nextParams = new URLSearchParams(currentParams);
        nextParams.delete("task");
        return nextParams;
      },
      { replace: true },
    );
  }

  // The row's When chip and hover-revealed affordance are themselves
  // SchedulerPopover triggers, so by the time this runs the student has
  // already chosen a date — this only writes it. That is what keeps
  // "reschedule from any surface" at two clicks (spec §13).
  function handleSchedule(
    taskId: string,
    field: "when_on" | "deadline_on",
    value: string | null,
  ) {
    scheduleTaskMutation.mutate({ id: taskId, field, value });
  }

  function handleComplete(taskId: string, done: boolean) {
    completeTaskMutation.mutate({ id: taskId, done });
  }

  function handleToggleFlag(taskId: string) {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) {
      return;
    }
    toggleFlagMutation.mutate({ id: taskId, flagged: !task.flagged });
  }

  const quickAddDefaults: QuickAddDefaults =
    view === "today" ? { when_on: getDateKey(referenceDate) } : {};

  const isLoading = tasksQuery.isLoading;
  const isError = tasksQuery.isError;

  const outletContext: TasksOutletContext = {
    activeTaskId,
    anytimeGroups,
    applications,
    applicationsById,
    doneThisWeekCount,
    essays,
    essaysById,
    hasCompletedTodayPlan: completedTodayPlan,
    logbookGroups,
    onComplete: handleComplete,
    onOpenTask: openTask,
    onSchedule: handleSchedule,
    onToggleFlag: handleToggleFlag,
    tasks,
    todayGroups,
    upcomingGroups,
  };

  return (
    <PageContainer
      actions={
        <>
          {/* TaskSearch itself is P7.3 — this is the seam: a plain toggle
           * button with local `searchOpen` state and no dialog wired yet. */}
          <Button
            aria-label="Search tasks"
            aria-pressed={searchOpen}
            className="w-auto gap-1.5 px-2"
            onClick={() => setSearchOpen((current) => !current)}
            variant="ghost"
          >
            <Search aria-hidden="true" />
            <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
          </Button>
          <PlanWithAgentButton>Plan with Counselle</PlanWithAgentButton>
        </>
      }
      className="gap-0"
      overlay={
        <>
          <UndoToast
            onDismiss={() => {}}
            onUndo={() => {}}
            pending={null}
            reduceMotion={false}
          />
          <TaskDetailPanel
            applicationsById={applicationsById}
            essaysById={essaysById}
            onOpenChange={(open) => {
              if (!open) {
                closeTask();
              }
            }}
            open={Boolean(activeTask)}
            task={activeTask}
          />
        </>
      }
      subtitle={subtitle}
      title={VIEW_TITLES[view]}
      width="wide"
    >
      <div className="mb-4 flex h-8 items-center gap-6" role="tablist">
        <ViewTab active={view === "today"} count={todayCount} label="Today" to="/app/tasks/today" />
        <ViewTab active={view === "upcoming"} count={upcomingCount} label="Upcoming" to="/app/tasks/upcoming" />
        <ViewTab active={view === "anytime"} count={anytimeCount} label="Anytime" to="/app/tasks/anytime" />
      </div>

      {view !== "logbook" && (
        <div className="mb-2">
          <QuickAddBar
            applications={applications}
            defaults={quickAddDefaults}
            essays={essays}
          />
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-col gap-0" role="list">
          {[0, 1, 2, 3, 4].map((index) => (
            <div className="flex h-9 items-center px-2" key={index}>
              <Skeleton className="h-4 w-4 rounded-[4px]" />
              <Skeleton className="ml-3 h-4 w-48 rounded-sm" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-xl border bg-card p-6">
          <div className="max-w-md space-y-3">
            <h2 className="font-heading text-lg font-medium">Could not load tasks</h2>
            <p className="text-sm text-muted-foreground">
              The workspace could not reach your tasks list.
            </p>
            <Button onClick={() => void tasksQuery.refetch()}>Try again</Button>
          </div>
        </div>
      ) : (
        <Outlet context={outletContext} />
      )}
    </PageContainer>
  );
}
